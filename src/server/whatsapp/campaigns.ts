import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { audit } from "../audit";
import { logger } from "../logger";
import { enqueue } from "../jobs/queue";
import { requiresApproval } from "../sales/service";
import { segmentWhere, type SegmentCriteria } from "../brain/customers";
import { RATE_LIMIT_CODES, metaErrorCode, sendTemplate, validPhone } from "./cloud-api";
import { sendingNumber } from "./numbers";
import { renderTemplate } from "./policy";
import { resolveVariables } from "./templates";
import { whatsappConversation } from "./service";

/**
 * WhatsApp campaigns reuse Campaign (channel = "whatsapp"). The audience is a filter over the CRM (Lead) —
 * contacts are never copied. Flow: draft → audience preview (eligible / excluded with reasons) → approval
 * → recipients materialized → queue batches → provider sends → webhook status updates. Nothing is sent from
 * an HTTP request, nothing is sent before approval, paused / cancelled recipients are never counted as sent.
 */

type Actor = { userId: string; label: string };

export const OBJECTIVES = ["offer", "new_product", "reengagement", "follow_up", "appointment_reminder", "event", "lead_nurturing"] as const;

export const audienceSchema = z
  .object({
    stages: z.array(z.enum(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"])).max(7),
    temperatures: z.array(z.enum(["HOT", "WARM", "COLD"])).max(3),
    interests: z.array(z.string().max(80)).max(10),
    sources: z.array(z.string().max(80)).max(10),
    tags: z.array(z.string().max(60)).max(10),
    cities: z.array(z.string().max(80)).max(10),
    countries: z.array(z.string().max(80)).max(10),
    purchaseCategories: z.array(z.string().max(80)).max(10),
    segmentId: z.string().max(40).nullable(),
    opportunityStatus: z.enum(["OPEN", "WON", "LOST"]).nullable(),
    lastContactOlderThanDays: z.number().int().min(1).max(3650).nullable(),
    lastContactWithinDays: z.number().int().min(1).max(3650).nullable(),
    noPurchaseDays: z.number().int().min(1).max(3650).nullable(),
  })
  .partial();
export type Audience = z.infer<typeof audienceSchema>;

const DAY = 86_400_000;

export async function audienceWhere(scope: TenantScope, a: Audience): Promise<Prisma.LeadWhereInput> {
  const and: Prisma.LeadWhereInput[] = [{ isDemo: false }];
  if (a.stages?.length) and.push({ stage: { in: a.stages } });
  if (a.temperatures?.length) and.push({ temperature: { in: a.temperatures } });
  if (a.interests?.length) and.push({ interests: { hasSome: a.interests } });
  if (a.sources?.length) and.push({ OR: a.sources.map((s) => ({ source: { equals: s, mode: "insensitive" as const } })) });
  if (a.tags?.length) and.push({ tags: { hasSome: a.tags } });
  if (a.cities?.length) and.push({ OR: a.cities.map((c) => ({ city: { equals: c, mode: "insensitive" as const } })) });
  if (a.countries?.length) and.push({ OR: a.countries.map((c) => ({ country: { equals: c, mode: "insensitive" as const } })) });
  if (a.purchaseCategories?.length) and.push({ purchaseCategories: { hasSome: a.purchaseCategories } });
  if (a.opportunityStatus) and.push({ opportunities: { some: { status: a.opportunityStatus } } });
  if (a.lastContactOlderThanDays) and.push({ OR: [{ lastContactAt: { lt: new Date(Date.now() - a.lastContactOlderThanDays * DAY) } }, { lastContactAt: null }] });
  if (a.lastContactWithinDays) and.push({ lastContactAt: { gte: new Date(Date.now() - a.lastContactWithinDays * DAY) } });
  // "Haven't bought in N days": customers who did buy before, but not recently.
  if (a.noPurchaseDays) and.push({ lastOrderAt: { lt: new Date(Date.now() - a.noPurchaseDays * DAY) } });
  if (a.segmentId) {
    const seg = await tenantDb(scope).customerSegment.findUnique({ where: { id: a.segmentId } });
    and.push(seg ? segmentWhere((seg.criteria ?? {}) as SegmentCriteria) : { id: "__none__" });
  }
  return { AND: and };
}

export type Exclusion = "missing_phone" | "invalid_phone" | "opted_out" | "suppressed" | "duplicate" | "no_consent";

/**
 * Walks the audience server-side (pages of 1,000 — never all contacts in memory) and classifies each
 * contact as eligible or excluded with a reason.
 */
async function walkAudience(scope: TenantScope, a: Audience, onEligible?: (rows: { id: string; phoneDigits: string }[]) => Promise<void>, sampleSize = 0) {
  const where = await audienceWhere(scope, a);
  const settings = await db.workspaceSettings.findFirst({ where: scope, select: { whatsappConfig: true } });
  const requireConsent = Boolean(((settings?.whatsappConfig ?? {}) as { requireConsent?: boolean }).requireConsent);
  const excluded: Record<Exclusion, number> = { missing_phone: 0, invalid_phone: 0, opted_out: 0, suppressed: 0, duplicate: 0, no_consent: 0 };
  const seen = new Set<string>();
  const sample: { id: string; name: string; phone: string | null; reason: Exclusion | null }[] = [];
  let total = 0;
  let eligible = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await tenantDb(scope).lead.findMany({ where, orderBy: { id: "asc" }, take: 1000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, name: true, phone: true, phoneDigits: true, whatsappOptOut: true, whatsappConsent: true } });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    const digits = rows.map((r) => r.phoneDigits).filter((d): d is string => Boolean(d));
    const suppressed = new Set((await db.whatsAppSuppression.findMany({ where: { ...scope, phone: { in: digits } }, select: { phone: true } })).map((s) => s.phone));
    const ok: { id: string; phoneDigits: string }[] = [];
    for (const r of rows) {
      total++;
      let reason: Exclusion | null = null;
      if (!r.phone || !r.phoneDigits) reason = "missing_phone";
      else if (!validPhone(r.phoneDigits)) reason = "invalid_phone";
      else if (r.whatsappOptOut) reason = "opted_out";
      else if (suppressed.has(r.phoneDigits)) reason = "suppressed";
      else if (requireConsent && r.whatsappConsent !== true) reason = "no_consent";
      else if (seen.has(r.phoneDigits)) reason = "duplicate";
      if (reason) excluded[reason]++;
      else {
        seen.add(r.phoneDigits!);
        eligible++;
        ok.push({ id: r.id, phoneDigits: r.phoneDigits! });
      }
      if (sample.length < sampleSize) sample.push({ id: r.id, name: r.name, phone: r.phone, reason });
    }
    if (onEligible && ok.length) await onEligible(ok);
    if (rows.length < 1000) break;
  }
  return { total, eligible, excluded, excludedTotal: total - eligible, sample, requireConsent };
}

export async function previewAudience(scope: TenantScope, a: Audience) {
  return walkAudience(scope, audienceSchema.parse(a), undefined, 8);
}
export type AudiencePreview = Awaited<ReturnType<typeof previewAudience>>;

export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  objective: z.enum(OBJECTIVES),
  templateId: z.string().max(40).nullable(),
  audience: audienceSchema,
  variables: z.record(z.string().regex(/^\d+$/), z.string().max(200)).default({}),
  scheduledAt: z.string().datetime().nullable().optional(),
});
export type CampaignInput = z.input<typeof campaignSchema>;

export async function saveCampaign(scope: TenantScope, input: CampaignInput, actor: Actor, id?: string) {
  const d = campaignSchema.parse(input);
  const t = tenantDb(scope);
  const data = { name: d.name, objective: d.objective, waTemplateId: d.templateId, waAudience: d.audience as Prisma.InputJsonValue, waVariables: d.variables as Prisma.InputJsonValue, scheduledAt: d.scheduledAt ? new Date(d.scheduledAt) : null };
  if (id) {
    const cur = await t.campaign.findUnique({ where: { id } });
    if (!cur || cur.channel !== "whatsapp") throw new NotFoundError("item");
    if (!["DRAFT", null].includes(cur.waState)) throw new UserFacingError("whatsapp_campaign_locked");
    return t.campaign.update({ where: { id }, data });
  }
  const row = await t.campaign.create({ data: { ...data, organizationId: scope.organizationId, workspaceId: scope.workspaceId, channel: "whatsapp", waState: "DRAFT", status: "DRAFT", createdById: actor.userId } });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.campaign_created", entityType: "Campaign", entityId: row.id, summary: `WhatsApp campaign "${row.name}" created` });
  return row;
}

async function loadCampaign(scope: TenantScope, id: string) {
  const c = await tenantDb(scope).campaign.findUnique({ where: { id } });
  if (!c || c.channel !== "whatsapp") throw new NotFoundError("item");
  return c;
}

/** Everything that must be true before a campaign can be approved (template approved, number connected, audience). */
async function readiness(scope: TenantScope, c: Awaited<ReturnType<typeof loadCampaign>>) {
  const problems: string[] = [];
  const tpl = c.waTemplateId ? await tenantDb(scope).whatsAppTemplate.findUnique({ where: { id: c.waTemplateId } }) : null;
  if (!tpl) problems.push("template_missing");
  else if (tpl.status !== "APPROVED") problems.push("template_not_approved");
  if (!(await sendingNumber(scope))) problems.push("not_connected");
  const audience = await walkAudience(scope, audienceSchema.parse(c.waAudience ?? {}));
  if (!audience.eligible) problems.push("no_eligible_recipients");
  return { problems, template: tpl, audience };
}

/** Submit for approval (or approve directly when the workspace policy doesn't require it). */
export async function submitCampaign(scope: TenantScope, id: string, actor: Actor, opts: { sendNow?: boolean } = {}) {
  const c = await loadCampaign(scope, id);
  if (c.waState !== "DRAFT") throw new UserFacingError("invalid_transition");
  const r = await readiness(scope, c);
  if (r.problems.length) throw new UserFacingError(`whatsapp_campaign_${r.problems[0]}`);
  const t = tenantDb(scope);
  if (!(await requiresApproval(scope, "whatsapp_campaign"))) return approveWhatsAppCampaign(scope, id, actor, opts);
  await t.campaign.update({ where: { id }, data: { waState: "NEEDS_APPROVAL", status: "PENDING_APPROVAL" } });
  await t.approval.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      category: "CAMPAIGNS",
      action: "whatsapp_campaign",
      title: `WhatsApp: ${c.name}`,
      summary: `${r.template!.name} → ${r.audience.eligible} recipients${c.scheduledAt ? ` · ${c.scheduledAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}`,
      reason: c.objective,
      impact: `${r.audience.eligible} messages · ${r.audience.excludedTotal} excluded`,
      entityType: "Campaign",
      entityId: id,
      requestedById: actor.userId,
      payload: { channel: "whatsapp", templateId: r.template!.id, eligible: r.audience.eligible, excluded: r.audience.excluded },
    },
  });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.campaign_submitted", entityType: "Campaign", entityId: id, summary: `WhatsApp campaign "${c.name}" submitted for approval (${r.audience.eligible} recipients)` });
  return { state: "NEEDS_APPROVAL", eligible: r.audience.eligible };
}

/**
 * Approve → materialize eligible recipients (skipDuplicates; idempotent) → schedule or start the first batch.
 * Called by the approvals center (decideApproval → approveCampaign) or directly when no approval is required.
 */
export async function approveWhatsAppCampaign(scope: TenantScope, id: string, actor: Actor, opts: { sendNow?: boolean } = {}) {
  const c = await loadCampaign(scope, id);
  if (!["DRAFT", "NEEDS_APPROVAL"].includes(c.waState ?? "")) throw new UserFacingError("invalid_transition");
  const r = await readiness(scope, c);
  if (r.problems.length) throw new UserFacingError(`whatsapp_campaign_${r.problems[0]}`);
  const t = tenantDb(scope);
  await walkAudience(scope, audienceSchema.parse(c.waAudience ?? {}), async (rows) => {
    await t.campaignRecipient.createMany({ data: rows.map((x) => ({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, campaignId: id, leadId: x.id, phone: x.phoneDigits, status: "QUEUED" })), skipDuplicates: true });
  });
  const later = !opts.sendNow && c.scheduledAt && c.scheduledAt.getTime() > Date.now();
  const s = await sendingNumber(scope);
  await t.campaign.update({ where: { id }, data: { waState: later ? "SCHEDULED" : "SENDING", status: "ACTIVE", waNumberId: s?.number.id ?? null, ...(later ? {} : { sendStartedAt: new Date() }) } });
  await t.approval.updateMany({ where: { entityType: "Campaign", entityId: id, status: "PENDING" }, data: { status: "APPROVED", decidedById: actor.userId, decidedAt: new Date() } });
  await enqueue("whatsapp.campaign_batch", { ...scope, campaignId: id }, { ...scope, runAt: later ? c.scheduledAt! : new Date(), dedupeKey: `whatsapp.campaign:${id}:${Date.now()}` });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.campaign_approved", entityType: "Campaign", entityId: id, summary: `WhatsApp campaign "${c.name}" approved (${later ? "scheduled" : "sending"})` });
  return { state: later ? "SCHEDULED" : "SENDING", eligible: r.audience.eligible };
}

export async function rejectWhatsAppCampaign(scope: TenantScope, id: string, actor: Actor) {
  const c = await loadCampaign(scope, id);
  await tenantDb(scope).campaign.update({ where: { id }, data: { waState: "DRAFT", status: "DRAFT" } });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.campaign_rejected", entityType: "Campaign", entityId: id, summary: `WhatsApp campaign "${c.name}" sent back to draft` });
}

export async function pauseCampaign(scope: TenantScope, id: string, actor: Actor) {
  const c = await loadCampaign(scope, id);
  if (!["SENDING", "SCHEDULED"].includes(c.waState ?? "")) throw new UserFacingError("invalid_transition");
  await tenantDb(scope).campaign.update({ where: { id }, data: { waState: "PAUSED", status: "PAUSED" } });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.campaign_paused", entityType: "Campaign", entityId: id, summary: `WhatsApp campaign "${c.name}" paused` });
}

export async function resumeCampaign(scope: TenantScope, id: string, actor: Actor) {
  const c = await loadCampaign(scope, id);
  if (c.waState !== "PAUSED") throw new UserFacingError("invalid_transition");
  const t = tenantDb(scope);
  await t.campaign.update({ where: { id }, data: { waState: "SENDING", status: "ACTIVE", sendStartedAt: c.sendStartedAt ?? new Date() } });
  // Recipients left mid-send by the pause go back to the queue.
  await t.campaignRecipient.updateMany({ where: { campaignId: id, status: "SENDING" }, data: { status: "QUEUED" } });
  await enqueue("whatsapp.campaign_batch", { ...scope, campaignId: id }, { ...scope, dedupeKey: `whatsapp.campaign:${id}:${Date.now()}` });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.campaign_resumed", entityType: "Campaign", entityId: id, summary: `WhatsApp campaign "${c.name}" resumed` });
}

export async function cancelCampaign(scope: TenantScope, id: string, actor: Actor) {
  const c = await loadCampaign(scope, id);
  if (["COMPLETED", "CANCELLED"].includes(c.waState ?? "")) throw new UserFacingError("invalid_transition");
  const t = tenantDb(scope);
  await t.campaign.update({ where: { id }, data: { waState: "CANCELLED", status: "ARCHIVED", completedAt: new Date() } });
  await t.campaignRecipient.updateMany({ where: { campaignId: id, status: { in: ["QUEUED", "SENDING"] } }, data: { status: "CANCELLED" } });
  await t.approval.updateMany({ where: { entityType: "Campaign", entityId: id, status: "PENDING" }, data: { status: "REJECTED", decidedById: actor.userId, decidedAt: new Date() } });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.campaign_cancelled", entityType: "Campaign", entityId: id, summary: `WhatsApp campaign "${c.name}" cancelled` });
}

// ── Sending (queue job) ──

/** Messages per day allowed by the number's Meta messaging tier (unknown → the lowest tier). */
export function dailyCap(tier: string | null | undefined) {
  const m = /TIER_(\d+)(K)?/i.exec(tier ?? "");
  if (/UNLIMITED/i.test(tier ?? "")) return 1_000_000;
  if (!m) return 250;
  return Number(m[1]) * (m[2] ? 1000 : 1);
}

export const BATCH = { size: 20, gapMs: 3_000 };

/**
 * One batch: re-checks state, quality and the daily cap, then claims up to BATCH.size recipients atomically
 * and sends each (opt-out / suppression re-checked at send time). Re-enqueues itself until done.
 * Throughput errors put the recipient back in the queue with a growing delay (dynamic throttling).
 */
export async function runCampaignBatch(scope: TenantScope, campaignId: string) {
  const t = tenantDb(scope);
  const c = await t.campaign.findUnique({ where: { id: campaignId } });
  if (!c || c.channel !== "whatsapp") return { skipped: "missing" };
  if (c.waState === "SCHEDULED") {
    if (c.scheduledAt && c.scheduledAt.getTime() > Date.now() + 1000) return { skipped: "not_yet" };
    await t.campaign.update({ where: { id: campaignId }, data: { waState: "SENDING", sendStartedAt: new Date() } });
  } else if (c.waState !== "SENDING") return { skipped: c.waState };

  const s = await sendingNumber(scope);
  if (!s) {
    await t.campaign.update({ where: { id: campaignId }, data: { waState: "PAUSED", status: "PAUSED" } });
    return { paused: "not_connected" };
  }
  // Meta lowers the tier / blocks on RED quality: stop and let a human decide.
  if ((s.number.qualityRating ?? "").toUpperCase() === "RED") {
    await t.campaign.update({ where: { id: campaignId }, data: { waState: "PAUSED", status: "PAUSED" } });
    await audit({ ...scope, actorType: "SYSTEM", actorLabel: "WhatsApp", action: "whatsapp.campaign_paused", entityType: "Campaign", entityId: campaignId, summary: `Campaign "${c.name}" paused: number quality is RED` });
    return { paused: "quality_red" };
  }
  const sentToday = await db.campaignRecipient.count({ where: { organizationId: scope.organizationId, sentAt: { gte: new Date(Date.now() - DAY) }, status: { in: ["SENT", "DELIVERED", "READ", "FAILED"] } } });
  const room = dailyCap(s.number.messagingLimit) - sentToday;
  if (room <= 0) {
    await enqueue("whatsapp.campaign_batch", { ...scope, campaignId }, { ...scope, runAt: new Date(Date.now() + 60 * 60_000), dedupeKey: `whatsapp.campaign:${campaignId}:${Date.now()}` });
    return { deferred: "daily_cap" };
  }

  const tpl = c.waTemplateId ? await t.whatsAppTemplate.findUnique({ where: { id: c.waTemplateId } }) : null;
  if (!tpl || tpl.status !== "APPROVED") {
    await t.campaign.update({ where: { id: campaignId }, data: { waState: "FAILED", status: "PAUSED" } });
    return { failed: "template_not_approved" };
  }
  const mapping = { ...((tpl.variables ?? {}) as Record<string, string>), ...((c.waVariables ?? {}) as Record<string, string>) };
  const batch = await t.campaignRecipient.findMany({ where: { campaignId, status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: Math.min(BATCH.size, room) });
  let throttled = false;
  let sent = 0;
  for (const r of batch) {
    // Pause / cancel between messages takes effect immediately.
    const fresh = await t.campaign.findUnique({ where: { id: campaignId }, select: { waState: true } });
    if (fresh?.waState !== "SENDING") break;
    const claimed = await t.campaignRecipient.updateMany({ where: { id: r.id, status: "QUEUED" }, data: { status: "SENDING", attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    const lead = await t.lead.findUnique({ where: { id: r.leadId } });
    const suppressed = lead?.phoneDigits ? await db.whatsAppSuppression.findUnique({ where: { workspaceId_phone: { workspaceId: scope.workspaceId, phone: lead.phoneDigits } } }) : null;
    if (!lead || lead.whatsappOptOut || suppressed || lead.phoneDigits !== r.phone) {
      await t.campaignRecipient.update({ where: { id: r.id }, data: { status: "SKIPPED", error: !lead ? "contact_removed" : lead.whatsappOptOut ? "opted_out" : suppressed ? "suppressed" : "phone_changed" } });
      continue;
    }
    const vars = await resolveVariables(scope, lead, mapping);
    if (vars.missing.length) {
      await t.campaignRecipient.update({ where: { id: r.id }, data: { status: "SKIPPED", error: "missing_variable" } });
      continue;
    }
    try {
      const res = await sendTemplate(s.number.phoneNumberId, r.phone, { name: tpl.name, language: tpl.language, bodyParams: vars.values }, s.token);
      const conv = await whatsappConversation(scope, lead, s.number.id);
      const msg = await t.message.create({ data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, conversationId: conv.id, direction: "OUTBOUND", authorType: "SYSTEM", body: renderTemplate(tpl.body, vars.values), status: "SENT", sentAt: new Date(), externalId: res.externalId, deliveryStatus: "accepted", messageType: "template", templateName: tpl.name, campaignId } });
      await t.campaignRecipient.update({ where: { id: r.id }, data: { status: "SENT", sentAt: new Date(), externalId: res.externalId, messageId: msg.id, variables: vars.values as Prisma.InputJsonValue, error: null } });
      await t.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
      sent++;
    } catch (err) {
      const code = metaErrorCode(err);
      if (code != null && RATE_LIMIT_CODES.has(code)) {
        await t.campaignRecipient.update({ where: { id: r.id }, data: { status: "QUEUED", error: `throttled:${code}` } });
        throttled = true;
        break;
      }
      await t.campaignRecipient.update({ where: { id: r.id }, data: { status: "FAILED", error: code ? `meta:${code}` : "send_failed" } });
      logger.warn({ campaignId, code }, "whatsapp campaign recipient failed");
    }
  }
  if (sent) await db.whatsAppNumber.update({ where: { id: s.number.id }, data: { lastSendAt: new Date() } });

  const [queued, state] = await Promise.all([t.campaignRecipient.count({ where: { campaignId, status: { in: ["QUEUED", "SENDING"] } } }), t.campaign.findUnique({ where: { id: campaignId }, select: { waState: true } })]);
  if (state?.waState !== "SENDING") return { sent, stopped: state?.waState };
  if (!queued) {
    const ok = await t.campaignRecipient.count({ where: { campaignId, status: { in: ["SENT", "DELIVERED", "READ"] } } });
    await t.campaign.update({ where: { id: campaignId }, data: { waState: ok ? "COMPLETED" : "FAILED", status: "COMPLETED", completedAt: new Date() } });
    await audit({ ...scope, actorType: "SYSTEM", actorLabel: "WhatsApp", action: "whatsapp.campaign_completed", entityType: "Campaign", entityId: campaignId, summary: `WhatsApp campaign "${c.name}" finished (${ok} sent)` });
    return { sent, completed: true };
  }
  const attempts = Number(((await t.campaignRecipient.aggregate({ where: { campaignId, status: "QUEUED" }, _max: { attempts: true } }))._max.attempts ?? 0));
  const delay = throttled ? Math.min(15 * 60_000, 30_000 * 2 ** Math.min(attempts, 5)) : BATCH.gapMs;
  await enqueue("whatsapp.campaign_batch", { ...scope, campaignId }, { ...scope, runAt: new Date(Date.now() + delay), dedupeKey: `whatsapp.campaign:${campaignId}:${Date.now()}` });
  return { sent, next: delay };
}

// ── Analytics & attribution (only what the provider / CRM really reports) ──

export async function campaignAnalytics(scope: TenantScope, id: string) {
  const c = await loadCampaign(scope, id);
  const t = tenantDb(scope);
  const grouped = await t.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: id }, _count: true });
  const by = Object.fromEntries(grouped.map((g) => [g.status, g._count])) as Record<string, number>;
  const sentStates = (by.SENT ?? 0) + (by.DELIVERED ?? 0) + (by.READ ?? 0);
  const [replies, readCount, deliveredCount, leadIds] = await Promise.all([
    t.campaignRecipient.count({ where: { campaignId: id, repliedAt: { not: null } } }),
    t.campaignRecipient.count({ where: { campaignId: id, readAt: { not: null } } }),
    t.campaignRecipient.count({ where: { campaignId: id, deliveredAt: { not: null } } }),
    t.campaignRecipient.findMany({ where: { campaignId: id, status: { in: ["SENT", "DELIVERED", "READ"] } }, select: { leadId: true } }),
  ]);
  const since = c.sendStartedAt ?? c.createdAt;
  const ids = leadIds.map((l) => l.leadId);
  const [optOuts, attributedLeads, opps, won] = await Promise.all([
    t.lead.count({ where: { id: { in: ids }, whatsappOptOut: true, whatsappOptOutAt: { gte: since } } }),
    t.lead.count({ where: { campaignId: id } }),
    t.salesOpportunity.count({ where: { leadId: { in: ids }, createdAt: { gte: since } } }),
    t.salesOpportunity.findMany({ where: { leadId: { in: ids }, status: "WON", closedAt: { gte: since } }, select: { valueCents: true, currency: true } }),
  ]);
  const valued = won.filter((w) => w.valueCents != null);
  const currencies = [...new Set(valued.map((w) => w.currency))];
  return {
    id: c.id,
    name: c.name,
    state: c.waState,
    recipients: Object.values(by).reduce((a, b) => a + b, 0),
    queued: (by.QUEUED ?? 0) + (by.SENDING ?? 0),
    sent: sentStates,
    delivered: deliveredCount,
    read: readCount,
    failed: by.FAILED ?? 0,
    skipped: by.SKIPPED ?? 0,
    cancelled: by.CANCELLED ?? 0,
    replies,
    optOuts,
    leads: attributedLeads,
    opportunities: opps,
    wonDeals: won.length,
    // Revenue only from deals that have a real value, and only when they share one currency.
    revenue: valued.length && currencies.length === 1 ? { cents: valued.reduce((a, w) => a + (w.valueCents ?? 0), 0), currency: currencies[0] } : null,
  };
}
export type CampaignAnalytics = Awaited<ReturnType<typeof campaignAnalytics>>;

export async function listWhatsAppCampaigns(scope: TenantScope) {
  const rows = await tenantDb(scope).campaign.findMany({ where: { channel: "whatsapp" }, orderBy: { updatedAt: "desc" }, take: 100 });
  const counts = rows.length ? await db.campaignRecipient.groupBy({ by: ["campaignId", "status"], where: { ...scope, campaignId: { in: rows.map((r) => r.id) } }, _count: true }) : [];
  return rows.map((r) => {
    const mine = counts.filter((x) => x.campaignId === r.id);
    const n = (s: string[]) => mine.filter((x) => s.includes(x.status)).reduce((a, x) => a + x._count, 0);
    return { id: r.id, name: r.name, objective: r.objective, state: r.waState ?? "DRAFT", scheduledAt: r.scheduledAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString(), recipients: mine.reduce((a, x) => a + x._count, 0), sent: n(["SENT", "DELIVERED", "READ"]), failed: n(["FAILED"]) };
  });
}
