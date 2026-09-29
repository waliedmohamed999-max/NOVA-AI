import { z } from "zod";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { audit } from "../audit";
import { aiAvailability, aiStructured } from "../ai";
import { brainMeta, compactContext } from "../knowledge/company-context";
import { salesContext } from "../knowledge/use-cases";
import { windowState } from "./policy";
import { whatsappConversation } from "./service";

/**
 * Sales follow-ups over WhatsApp. NOVA only prepares: every follow-up is a DRAFT reviewed in the inbox /
 * follow-up center (approve one, approve selected, send). Outside the 24h window no free text is drafted —
 * the contact is listed as "template required" instead.
 */

type Actor = { userId: string; label: string };
const followupSchema = z.object({ message: z.string().max(900) });

async function draftText(scope: TenantScope, lead: { name: string; interests: string[]; summary: string | null; nextAction: string | null; stage: string }, locale: "ar" | "en") {
  if (!aiAvailability().configured) return null;
  const ctx = await salesContext(scope, { query: [lead.interests.join(" "), lead.summary ?? ""].join(" "), relevantTo: lead.interests.join(" ") });
  const res = await aiStructured(
    { organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "SALES_AGENT" },
    {
      task: "SALES",
      schemaName: "whatsapp_followup",
      schema: followupSchema,
      maxTokens: 300,
      brain: brainMeta(ctx),
      system: [
        "Draft a short, friendly WhatsApp follow-up (max 3 sentences) with one clear next step.",
        "Never offer discounts, prices, refunds or contract terms that are not in the company knowledge.",
        `Write in ${locale === "ar" ? "Arabic" : "English"}.`,
        "",
        compactContext(ctx),
      ].join("\n"),
      prompt: JSON.stringify({ customer: lead.name.split(/\s+/)[0], stage: lead.stage, interests: lead.interests, summary: lead.summary, nextAction: lead.nextAction }),
      offline: () => ({ message: locale === "ar" ? `مرحبًا ${lead.name.split(/\s+/)[0]}، أردنا متابعة طلبك. هل يناسبك أن نكمل اليوم؟` : `Hi ${lead.name.split(/\s+/)[0]}, following up on your request — would today work to continue?` }),
    },
  );
  return res.data.message.trim() || null;
}

export type FollowupResult = { status: "drafted"; conversationId: string; messageId: string } | { status: "template_required"; conversationId: string } | { status: "ai_unavailable"; conversationId: string };

/** "Follow up on WhatsApp" for one customer: loads context → drafts → the draft waits for approval. */
export async function prepareFollowup(scope: TenantScope, leadId: string, actor: Actor): Promise<FollowupResult> {
  const t = tenantDb(scope);
  const lead = await t.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new NotFoundError("lead");
  if (!lead.phoneDigits) throw new UserFacingError("whatsapp_invalid_phone");
  if (lead.whatsappOptOut) throw new UserFacingError("whatsapp_opted_out");
  const conv = await whatsappConversation(scope, lead);
  if (!windowState(conv.lastInboundAt).open) return { status: "template_required", conversationId: conv.id };
  const org = await db.organization.findUniqueOrThrow({ where: { id: scope.organizationId }, select: { locale: true } });
  const text = await draftText(scope, lead, org.locale === "ar" ? "ar" : "en");
  if (!text) return { status: "ai_unavailable", conversationId: conv.id };
  await t.message.deleteMany({ where: { conversationId: conv.id, direction: "OUTBOUND", status: "DRAFT", aiDrafted: true } });
  const msg = await t.message.create({ data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, conversationId: conv.id, direction: "OUTBOUND", authorType: "AGENT", body: text, status: "DRAFT", aiDrafted: true, intent: "follow_up" } });
  await t.conversation.update({ where: { id: conv.id }, data: { needsHuman: true } });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.followup_drafted", entityType: "Lead", entityId: lead.id, summary: `WhatsApp follow-up drafted for ${lead.name}` });
  return { status: "drafted", conversationId: conv.id, messageId: msg.id };
}

/** Due follow-ups (next action due, phone known, not opted out) → drafts only; nothing is sent in bulk. */
export async function prepareDueFollowups(scope: TenantScope, actor: Actor, limit = 20) {
  const t = tenantDb(scope);
  const due = await t.lead.findMany({ where: { nextActionAt: { lte: new Date() }, phoneDigits: { not: null }, whatsappOptOut: false, stage: { notIn: ["WON", "LOST"] }, isDemo: false }, orderBy: { nextActionAt: "asc" }, take: limit });
  const out = { drafted: 0, templateRequired: 0, skipped: 0, aiUnavailable: 0 };
  for (const lead of due) {
    try {
      const r = await prepareFollowup(scope, lead.id, actor);
      if (r.status === "drafted") out.drafted++;
      else if (r.status === "template_required") out.templateRequired++;
      else out.aiUnavailable++;
    } catch {
      out.skipped++;
    }
  }
  return { ...out, due: due.length };
}

/** The follow-up center: pending drafts, contacts that need a template, upcoming appointments. */
export async function followupCenter(scope: TenantScope) {
  const t = tenantDb(scope);
  const [drafts, due, meetings] = await Promise.all([
    t.message.findMany({ where: { direction: "OUTBOUND", status: "DRAFT", aiDrafted: true, conversation: { channel: "WHATSAPP" } }, orderBy: { createdAt: "desc" }, take: 50, include: { conversation: { include: { lead: { select: { id: true, name: true, phone: true } } } } } }),
    t.lead.findMany({ where: { nextActionAt: { lte: new Date() }, phoneDigits: { not: null }, whatsappOptOut: false, stage: { notIn: ["WON", "LOST"] }, isDemo: false }, orderBy: { nextActionAt: "asc" }, take: 30, select: { id: true, name: true, phone: true, nextAction: true, nextActionAt: true, conversations: { where: { channel: "WHATSAPP" }, select: { id: true, lastInboundAt: true }, take: 1 } } }),
    t.meeting.findMany({ where: { startAt: { gte: new Date(), lte: new Date(Date.now() + 3 * 86_400_000) } }, orderBy: { startAt: "asc" }, take: 20, select: { id: true, title: true, startAt: true, leadId: true } }),
  ]);
  const meetingLeads = await t.lead.findMany({ where: { id: { in: meetings.map((m) => m.leadId) } }, select: { id: true, name: true, phoneDigits: true, whatsappOptOut: true } });
  return {
    drafts: drafts.map((d) => ({ id: d.id, conversationId: d.conversationId, body: d.body, lead: d.conversation.lead, at: d.createdAt.toISOString(), windowOpen: windowState(d.conversation.lastInboundAt).open })),
    due: due.map((l) => ({ id: l.id, name: l.name, phone: l.phone, nextAction: l.nextAction, nextActionAt: l.nextActionAt?.toISOString() ?? null, conversationId: l.conversations[0]?.id ?? null, windowOpen: windowState(l.conversations[0]?.lastInboundAt).open })),
    meetings: meetings.map((m) => {
      const lead = meetingLeads.find((l) => l.id === m.leadId);
      return { id: m.id, title: m.title, at: m.startAt?.toISOString() ?? null, lead: lead ? { id: lead.id, name: lead.name, reachable: Boolean(lead.phoneDigits) && !lead.whatsappOptOut } : null };
    }),
  };
}
export type FollowupCenter = Awaited<ReturnType<typeof followupCenter>>;

/** Overview metrics — only counts that exist in our records (no invented rates). */
export async function overviewMetrics(scope: TenantScope) {
  const t = tenantDb(scope);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [conversationsToday, unread, needsHuman, newLeads, activeCampaigns, sent, delivered, replies] = await Promise.all([
    t.conversation.count({ where: { channel: "WHATSAPP", lastMessageAt: { gte: dayStart } } }),
    t.conversation.aggregate({ where: { channel: "WHATSAPP" }, _sum: { unreadCount: true } }),
    t.conversation.count({ where: { channel: "WHATSAPP", needsHuman: true } }),
    t.lead.count({ where: { channel: "WHATSAPP", createdAt: { gte: dayStart } } }),
    t.campaign.count({ where: { channel: "whatsapp", waState: { in: ["SENDING", "SCHEDULED"] } } }),
    t.message.count({ where: { direction: "OUTBOUND", status: "SENT", sentAt: { gte: dayStart }, conversation: { channel: "WHATSAPP" } } }),
    t.message.count({ where: { direction: "OUTBOUND", deliveredAt: { gte: dayStart }, conversation: { channel: "WHATSAPP" } } }),
    t.message.count({ where: { direction: "INBOUND", createdAt: { gte: dayStart }, conversation: { channel: "WHATSAPP" } } }),
  ]);
  return { conversationsToday, unread: unread._sum.unreadCount ?? 0, needsHuman, newLeads, activeCampaigns, sent, delivered, replies };
}

/** First-run checklist from real state. */
export async function setupChecklist(scope: TenantScope) {
  const t = tenantDb(scope);
  const [number, approvedTemplates, contacts, campaigns, settings] = await Promise.all([
    t.whatsAppNumber.findFirst({ where: { isActive: true }, select: { status: true } }),
    t.whatsAppTemplate.count({ where: { status: "APPROVED" } }),
    t.lead.count({ where: { phoneDigits: { not: null }, isDemo: false } }),
    t.campaign.count({ where: { channel: "whatsapp" } }),
    db.workspaceSettings.findFirst({ where: scope, select: { whatsappAutoReply: true, whatsappConfig: true } }),
  ]);
  const cfg = (settings?.whatsappConfig ?? {}) as { safeRepliesReviewed?: boolean };
  return [
    { key: "connected", done: Boolean(number && number.status === "connected"), href: "/whatsapp/numbers" },
    { key: "template", done: approvedTemplates > 0, href: "/whatsapp/templates" },
    { key: "contacts", done: contacts > 0, href: "/knowledge?tab=imports" },
    { key: "campaign", done: campaigns > 0, href: "/whatsapp/campaigns/new" },
    { key: "safeReplies", done: Boolean(cfg.safeRepliesReviewed), href: "/whatsapp/settings" },
  ];
}

/** Last-30-days WhatsApp analytics: our records + provider-reported delivery states only (no open rates). */
export async function periodAnalytics(scope: TenantScope, days = 30) {
  const t = tenantDb(scope);
  const since = new Date(Date.now() - days * 86_400_000);
  const wa = { conversation: { channel: "WHATSAPP" as const } };
  const [conversations, inbound, outbound, delivered, read, failed, campaigns] = await Promise.all([
    t.conversation.count({ where: { channel: "WHATSAPP", lastMessageAt: { gte: since } } }),
    t.message.count({ where: { ...wa, direction: "INBOUND", createdAt: { gte: since } } }),
    t.message.count({ where: { ...wa, direction: "OUTBOUND", status: "SENT", sentAt: { gte: since } } }),
    t.message.count({ where: { ...wa, direction: "OUTBOUND", deliveredAt: { gte: since } } }),
    t.message.count({ where: { ...wa, direction: "OUTBOUND", readAt: { gte: since } } }),
    t.message.count({ where: { ...wa, direction: "OUTBOUND", status: "FAILED", createdAt: { gte: since } } }),
    t.campaign.findMany({ where: { channel: "whatsapp", waState: { notIn: ["DRAFT"] } }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true } }),
  ]);
  return { conversations, inbound, outbound, delivered, read, failed, campaignIds: campaigns.map((c) => c.id) };
}
