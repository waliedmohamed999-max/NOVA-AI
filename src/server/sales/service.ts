import { Prisma } from "@/generated/prisma/client";
import type { ActorType, Channel, LeadStage, LeadEventType } from "@/generated/prisma/enums";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { audit } from "../audit";
import { notify } from "../notifications/service";
import { scoreLead } from "./scoring";
import { channelFor } from "./channels";

export type Actor = { type: ActorType; id?: string | null; label?: string };

export const LEAD_STAGES: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];

export async function addLeadEvent(
  scope: TenantScope,
  leadId: string,
  e: { type: LeadEventType; title: string; body?: string | null; data?: Record<string, unknown>; actor: Actor },
) {
  return db.leadEvent.create({
    data: {
      ...scope,
      leadId,
      type: e.type,
      title: e.title.slice(0, 300),
      body: e.body ?? null,
      data: (e.data ?? {}) as Prisma.InputJsonValue,
      actorType: e.actor.type,
      actorId: e.actor.id ?? null,
    },
  });
}

export type LeadAttribution = {
  medium?: string | null;
  utmSource?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  contentItemId?: string | null;
  socialPostId?: string | null;
  landingUrl?: string | null;
};

export type NewLead = {
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  channel?: Channel;
  source?: string | null;
  campaignId?: string | null;
  /** Attribution captured with the lead (UTM / tracked link). Only what was actually observed. */
  attribution?: LeadAttribution;
  interests?: string[];
  message?: string | null;
  estimatedValueCents?: number | null;
  tags?: string[];
  ownerId?: string | null;
  formFields?: Record<string, string>;
};

/**
 * Creates a lead with its timeline, an instant rules-based score, an optional
 * inbound conversation, and queues the Sales Agent to qualify it.
 */
export async function createLead(scope: TenantScope, input: NewLead, actor: Actor, opts: { qualify?: boolean } = {}) {
  const t = tenantDb(scope);
  const email = input.email?.trim().toLowerCase() || null;
  const rules = scoreLead({ ...input, email });

  const lead = await t.lead.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      name: input.name.trim().slice(0, 160),
      company: input.company?.trim() || null,
      email,
      phone: input.phone?.trim() || null,
      channel: input.channel ?? "MANUAL",
      source: input.source ?? null,
      campaignId: input.campaignId ?? null,
      medium: input.attribution?.medium ?? null,
      utmSource: input.attribution?.utmSource ?? null,
      utmCampaign: input.attribution?.utmCampaign ?? null,
      utmContent: input.attribution?.utmContent ?? null,
      contentItemId: input.attribution?.contentItemId ?? null,
      socialPostId: input.attribution?.socialPostId ?? null,
      landingUrl: input.attribution?.landingUrl ?? null,
      interests: input.interests ?? [],
      tags: input.tags ?? [],
      estimatedValueCents: input.estimatedValueCents ?? null,
      ownerId: input.ownerId ?? null,
      score: rules.score,
      temperature: rules.temperature,
    },
  });

  await addLeadEvent(scope, lead.id, { type: "CREATED", title: "Lead created", data: { source: input.source, channel: input.channel }, actor });
  if (input.formFields) await addLeadEvent(scope, lead.id, { type: "FORM_SUBMITTED", title: "Form submitted", data: input.formFields, actor });
  await db.leadScore.create({ data: { ...scope, leadId: lead.id, score: rules.score, temperature: rules.temperature, reasons: rules.reasons, method: "rules" } });

  if (input.message) {
    const conv = await db.conversation.create({
      data: {
        ...scope,
        leadId: lead.id,
        channel: input.channel ?? "MANUAL",
        subject: input.source ?? null,
        participants: { create: { organizationId: scope.organizationId, kind: "USER", name: lead.name, handle: email ?? lead.phone } },
      },
    });
    await db.message.create({
      data: { ...scope, conversationId: conv.id, direction: "INBOUND", authorType: "USER", body: input.message, status: "RECEIVED", sentAt: new Date() },
    });
    await addLeadEvent(scope, lead.id, { type: "MESSAGE_RECEIVED", title: "Message received", body: input.message.slice(0, 2000), actor });
  }

  await audit({ ...scope, actorType: actor.type, actorId: actor.id, actorLabel: actor.label, action: "lead.created", entityType: "Lead", entityId: lead.id, summary: `New lead: ${lead.name}${lead.company ? ` (${lead.company})` : ""}` });

  if (opts.qualify !== false) {
    const { startRun } = await import("../agents/runtime");
    await startRun(scope, { kind: "lead_qualify", agent: "SALES_AGENT", steps: ["reading_lead", "reviewing_business", "qualifying", "recommending_action"], params: { leadId: lead.id } });
  }
  return lead;
}

export async function moveLeadStage(scope: TenantScope, leadId: string, stage: LeadStage, actor: Actor, note?: string) {
  const t = tenantDb(scope);
  const lead = await t.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new NotFoundError("lead");
  if (lead.stage === stage) return lead;
  const updated = await t.lead.update({ where: { id: leadId }, data: { stage, stageChangedAt: new Date() } });
  await addLeadEvent(scope, leadId, { type: "STATUS_CHANGE", title: `${lead.stage} → ${stage}`, body: note ?? null, data: { from: lead.stage, to: stage }, actor });
  if (stage === "WON" || stage === "LOST") {
    await t.salesOpportunity.updateMany({ where: { leadId, status: "OPEN" }, data: { status: stage, closedAt: new Date() } });
  }
  await audit({ ...scope, actorType: actor.type, actorId: actor.id, actorLabel: actor.label, action: "lead.stage_changed", entityType: "Lead", entityId: leadId, summary: `${lead.name}: ${lead.stage} → ${stage}` });
  return updated;
}

export async function addLeadNote(scope: TenantScope, leadId: string, body: string, actor: Actor) {
  const t = tenantDb(scope);
  const lead = await t.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new NotFoundError("lead");
  await t.leadNote.create({ data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, leadId, body, authorId: actor.id ?? null } });
  await addLeadEvent(scope, leadId, { type: "NOTE", title: "Note added", body, actor });
}

export async function requiresApproval(scope: TenantScope, action: string) {
  const policy = await db.approvalPolicy.findFirst({ where: { ...scope, action } });
  return policy ? policy.requiresApproval : true;
}

/**
 * Decides what the AI may do with a drafted message given the workspace's
 * autonomy level, approval policies and any sensitive topics detected.
 */
export async function messageDisposition(scope: TenantScope, sensitive: string[], task = "send_follow_up"): Promise<"draft" | "approval" | "send"> {
  const settings = await db.workspaceSettings.findFirst({ where: scope });
  const autonomy = settings?.salesAutonomy ?? "COPILOT";
  if (autonomy === "ASSIST") return "draft";
  for (const topic of sensitive) if (await requiresApproval(scope, topic)) return "approval";
  if (autonomy === "AUTOPILOT") return settings?.autopilotAllowedTasks.includes(task) ? "send" : "approval";
  return (await requiresApproval(scope, "send_message")) ? "approval" : "send";
}

/** Stores an AI-drafted reply and sends / queues it according to the disposition. */
export async function draftLeadMessage(
  scope: TenantScope,
  leadId: string,
  draft: { subject?: string | null; body: string; sensitiveTopics: string[] },
  opts: { reason: string; locale: "en" | "ar" },
) {
  const t = tenantDb(scope);
  const lead = await t.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new NotFoundError("lead");
  const conv =
    (await t.conversation.findFirst({ where: { leadId }, orderBy: { lastMessageAt: "desc" } })) ??
    (await t.conversation.create({ data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, leadId, channel: lead.email ? "EMAIL" : lead.channel } }));

  let disposition = await messageDisposition(scope, draft.sensitiveTopics);
  const channel = channelFor(conv.channel);
  const recipientKnown = conv.channel === "WHATSAPP" ? Boolean(lead.phone) : conv.channel === "EMAIL" || conv.channel === "WEBSITE" ? Boolean(lead.email) : true;
  const canSend = Boolean(await channel?.isConfigured(scope)) && recipientKnown;
  if (disposition === "send" && !canSend) disposition = "draft";

  const message = await t.message.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      conversationId: conv.id,
      direction: "OUTBOUND",
      authorType: "AGENT",
      body: draft.body,
      status: disposition === "approval" ? "PENDING_APPROVAL" : "DRAFT",
      aiDrafted: true,
    },
  });

  if (disposition === "approval") {
    await t.approval.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        category: draft.sensitiveTopics.some((s) => ["discount", "custom_pricing", "refund"].includes(s)) ? "PRICING" : "SALES",
        action: "send_message",
        title: opts.locale === "ar" ? `رد على ${lead.name}` : `Reply to ${lead.name}`,
        summary: draft.body.slice(0, 500),
        reason: opts.reason,
        impact: draft.sensitiveTopics.length ? `Mentions: ${draft.sensitiveTopics.join(", ")}` : null,
        entityType: "Message",
        entityId: message.id,
        requestedByAgent: "SALES_AGENT",
        payload: { leadId, subject: draft.subject ?? null, sensitiveTopics: draft.sensitiveTopics },
      },
    });
  } else if (disposition === "send") {
    await sendMessage(scope, message.id, { type: "AGENT", label: "AI Sales Agent" }, draft.subject);
  }
  return { message, disposition };
}

/** Sends a stored outbound message through its channel adapter. */
export async function sendMessage(scope: TenantScope, messageId: string, actor: Actor, subject?: string | null) {
  const t = tenantDb(scope);
  const message = await t.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { lead: true } } } });
  if (!message || message.direction !== "OUTBOUND") throw new NotFoundError("item");
  if (message.status === "SENT") return message;
  const lead = message.conversation.lead;
  const channel = channelFor(message.conversation.channel);
  if (!channel || !(await channel.isConfigured(scope))) throw new UserFacingError("integration_not_configured");
  const org = await db.organization.findUniqueOrThrow({ where: { id: scope.organizationId } });
  let result: { externalId?: string | null; via: string };
  try {
    result = await channel.send(scope, { email: lead?.email, phone: lead?.phone }, { subject: subject ?? org.name, body: message.body, locale: org.locale });
  } catch (err) {
    await t.message.update({ where: { id: messageId }, data: { status: "FAILED" } });
    if (err instanceof UserFacingError) throw err;
    throw new UserFacingError("integration_error", { cause: err });
  }
  const sent = await t.message.update({ where: { id: messageId }, data: { status: "SENT", sentAt: new Date(), externalId: result.externalId ?? null, deliveryStatus: "accepted" } });
  await t.conversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: new Date() } });
  if (lead) {
    await t.lead.update({ where: { id: lead.id }, data: { lastContactAt: new Date(), stage: lead.stage === "NEW" ? "CONTACTED" : lead.stage } });
    await addLeadEvent(scope, lead.id, { type: actor.type === "AGENT" ? "MESSAGE_SENT" : "HUMAN_REPLY", title: actor.type === "AGENT" ? "AI sent a reply" : "Reply sent", body: message.body.slice(0, 2000), actor });
    if (lead.stage === "NEW") await addLeadEvent(scope, lead.id, { type: "STATUS_CHANGE", title: "NEW → CONTACTED", data: { from: "NEW", to: "CONTACTED" }, actor });
  }
  await audit({ ...scope, actorType: actor.type, actorId: actor.id, actorLabel: actor.label, action: "message.sent", entityType: "Message", entityId: messageId, summary: `Message sent to ${lead?.name ?? "contact"} via ${result.via}` });
  return sent;
}

export async function scheduleFollowUp(scope: TenantScope, leadId: string, f: { title: string; body?: string; dueAt: Date; agent?: boolean; createdById?: string | null }) {
  const activity = await db.salesActivity.create({
    data: { ...scope, leadId, type: "FOLLOW_UP", title: f.title.slice(0, 200), body: f.body ?? null, dueAt: f.dueAt, createdByAgent: f.agent ? "SALES_ASSISTANT" : null, createdById: f.createdById ?? null },
  });
  await db.lead.updateMany({ where: { ...scope, id: leadId }, data: { nextAction: f.title.slice(0, 200), nextActionAt: f.dueAt } });
  await addLeadEvent(scope, leadId, { type: "FOLLOW_UP", title: `Follow-up scheduled: ${f.title}`, data: { dueAt: f.dueAt.toISOString() }, actor: f.agent ? { type: "AGENT", label: "Sales Assistant" } : { type: "USER", id: f.createdById } });
  return activity;
}

export async function notifyHotLead(scope: TenantScope, lead: { id: string; name: string; company: string | null }, locale: "en" | "ar") {
  await notify({
    ...scope,
    type: "HOT_OPPORTUNITY",
    title: locale === "ar" ? `عميل مهتم جدًا: ${lead.name}` : `Hot lead: ${lead.name}${lead.company ? ` from ${lead.company}` : ""}`,
    body: locale === "ar" ? "يوصي وكيل المبيعات بالتواصل اليوم." : "The Sales Agent recommends reaching out today.",
    link: `/leads/${lead.id}`,
  });
}
