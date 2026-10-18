import { z } from "zod";
import type { CampaignStatus } from "@/generated/prisma/enums";
import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { audit } from "../audit";
import { approveContent } from "../content/service";

type Actor = { userId: string; label?: string };

/** Approving a campaign activates it and approves its pending content in one step. */
export async function approveCampaign(scope: TenantScope, campaignId: string, actor: Actor) {
  const t = tenantDb(scope);
  const campaign = await t.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new NotFoundError();
  // WhatsApp campaigns: approval materializes recipients and starts the queued send.
  if (campaign.channel === "whatsapp") {
    const { approveWhatsAppCampaign } = await import("../whatsapp/campaigns");
    await approveWhatsAppCampaign(scope, campaignId, { userId: actor.userId, label: actor.label ?? "A user" });
    return;
  }
  if (!["DRAFT", "PENDING_APPROVAL", "PAUSED"].includes(campaign.status)) throw new UserFacingError("invalid_transition");
  await t.campaign.update({ where: { id: campaignId }, data: { status: "ACTIVE" } });
  await t.approval.updateMany({
    where: { entityType: "Campaign", entityId: campaignId, status: "PENDING" },
    data: { status: "APPROVED", decidedById: actor.userId, decidedAt: new Date() },
  });
  const pending = await t.contentItem.findMany({ where: { campaignId, status: { in: ["PENDING_APPROVAL", "DRAFT"] } }, select: { id: true } });
  await approveContent(scope, pending.map((p) => p.id), actor);
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "campaign.approved", entityType: "Campaign", entityId: campaignId, summary: `${actor.label ?? "A user"} approved campaign "${campaign.name}"` });
}

/**
 * Which status a campaign may move to from which. Going live always goes through approveCampaign (never
 * DRAFT → ACTIVE here); "resume" is PAUSED → ACTIVE. Pausing or archiving also holds its scheduled posts
 * (the publisher skips them, see social/publishing.ts).
 */
const TRANSITIONS: Partial<Record<CampaignStatus, CampaignStatus[]>> = {
  ACTIVE: ["PAUSED"],
  PAUSED: ["ACTIVE"],
  COMPLETED: ["ACTIVE", "PAUSED"],
  ARCHIVED: ["DRAFT", "PENDING_APPROVAL", "ACTIVE", "PAUSED", "COMPLETED"],
  DRAFT: ["DRAFT", "PENDING_APPROVAL"],
};
export const HELD_CAMPAIGN_STATUSES: CampaignStatus[] = ["PAUSED", "ARCHIVED"];

export async function setCampaignStatus(scope: TenantScope, campaignId: string, status: CampaignStatus, actor: Actor) {
  const t = tenantDb(scope);
  const campaign = await t.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new NotFoundError();
  if (campaign.channel === "whatsapp" && status === "DRAFT") {
    const { rejectWhatsAppCampaign } = await import("../whatsapp/campaigns");
    return rejectWhatsAppCampaign(scope, campaignId, { userId: actor.userId, label: actor.label ?? "A user" });
  }
  // WhatsApp sends have their own pause / resume / cancel (they control the send queue).
  if (campaign.channel === "whatsapp" && status !== "ARCHIVED") throw new UserFacingError("invalid_transition");
  if (!TRANSITIONS[status]?.includes(campaign.status)) throw new UserFacingError("invalid_transition");
  await t.campaign.update({ where: { id: campaignId }, data: { status } });
  if (status === "ARCHIVED" || status === "PAUSED") {
    await t.approval.updateMany({ where: { entityType: "Campaign", entityId: campaignId, status: "PENDING" }, data: { status: "REJECTED", decidedById: actor.userId, decidedAt: new Date() } });
  }
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "campaign.status", entityType: "Campaign", entityId: campaignId, summary: `Campaign "${campaign.name}" → ${status}` });
}

export const campaignEditSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    objective: z.string().trim().min(1).max(2000),
    audience: z.string().trim().max(2000).nullable().optional(),
    offer: z.string().trim().max(1000).nullable().optional(),
    startDate: z.coerce.date().nullable().optional(),
    endDate: z.coerce.date().nullable().optional(),
    budget: z.number().min(0).max(100_000_000).nullable().optional(),
    currency: z.string().trim().length(3).toUpperCase().nullable().optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { message: "end_before_start", path: ["endDate"] });

/** Edits a campaign's brief (not its content or status). Archived campaigns are read-only. */
export async function updateCampaign(scope: TenantScope, campaignId: string, input: z.input<typeof campaignEditSchema>, actor: Actor) {
  const data = campaignEditSchema.parse(input);
  const t = tenantDb(scope);
  const campaign = await t.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new NotFoundError();
  if (campaign.status === "ARCHIVED") throw new UserFacingError("invalid_transition");
  const updated = await t.campaign.update({
    where: { id: campaignId },
    data: {
      name: data.name,
      objective: data.objective,
      audience: data.audience || null,
      offer: data.offer || null,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      budgetCents: data.budget == null ? null : Math.round(data.budget * 100),
      currency: data.budget == null ? campaign.currency : (data.currency ?? campaign.currency ?? "USD"),
    },
  });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "campaign.updated", entityType: "Campaign", entityId: campaignId, summary: `${actor.label ?? "A user"} edited campaign "${updated.name}"` });
  return updated;
}

const WEEK = 7 * 86_400_000;
const startOfWeek = (d: Date) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); // Monday
  return x;
};

/**
 * Week-by-week results of a campaign: reach and engagement of its published posts, and the leads it brought
 * in. Up to the last 12 weeks, from the campaign's first activity.
 */
export async function campaignPerformance(scope: TenantScope, campaignId: string, now = new Date()) {
  const t = tenantDb(scope);
  const campaign = await t.campaign.findUnique({ where: { id: campaignId }, select: { id: true, startDate: true, createdAt: true } });
  if (!campaign) throw new NotFoundError();
  const items = await t.contentItem.findMany({ where: { campaignId }, select: { id: true } });
  const [posts, leads] = await Promise.all([
    items.length ? t.socialPost.findMany({ where: { contentItemId: { in: items.map((i) => i.id) } }, select: { publishedAt: true, metric: { select: { reach: true, engagementRate: true } } } }) : [],
    t.lead.findMany({ where: { campaignId }, select: { createdAt: true } }),
  ]);
  const firstActivity = [campaign.startDate, ...posts.map((p) => p.publishedAt), ...leads.map((l) => l.createdAt)].filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? campaign.createdAt;
  const end = startOfWeek(now);
  let start = startOfWeek(firstActivity > now ? now : firstActivity);
  if ((end.getTime() - start.getTime()) / WEEK > 11) start = new Date(end.getTime() - 11 * WEEK);
  const weeks: { start: Date; reach: number; posts: number; engagement: number | null; leads: number }[] = [];
  for (let w = start.getTime(); w <= end.getTime(); w += WEEK) weeks.push({ start: new Date(w), reach: 0, posts: 0, engagement: null, leads: 0 });
  const bucket = (d: Date) => weeks.find((w) => d.getTime() >= w.start.getTime() && d.getTime() < w.start.getTime() + WEEK);
  const rates = new Map<Date, number[]>();
  for (const p of posts) {
    const b = bucket(p.publishedAt);
    if (!b) continue;
    b.posts++;
    b.reach += p.metric?.reach ?? 0;
    if (p.metric?.engagementRate != null) rates.set(b.start, [...(rates.get(b.start) ?? []), p.metric.engagementRate]);
  }
  for (const [k, v] of rates) {
    const b = weeks.find((w) => w.start === k);
    if (b) b.engagement = v.reduce((a, x) => a + x, 0) / v.length;
  }
  for (const l of leads) {
    const b = bucket(l.createdAt);
    if (b) b.leads++;
  }
  return { weeks, hasData: posts.length > 0 || leads.length > 0 };
}
