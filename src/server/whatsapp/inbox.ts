import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { audit } from "../audit";
import { addLeadEvent } from "../sales/service";
import { signedFileUrl } from "../storage";
import { renderTemplate, windowState } from "./policy";
import { sendWhatsApp } from "./service";
import { resolveVariables } from "./templates";

/**
 * The WhatsApp inbox reads the shared Conversation / Message / Lead records (no parallel inbox or CRM).
 * Lists use cursor pagination; message history loads lazily (newest page first).
 */

type Actor = { userId: string; label: string };
export type InboxFilter = "all" | "unread" | "needs_human" | "drafts";
const PAGE = 25;

export async function listConversations(scope: TenantScope, opts: { filter?: InboxFilter; cursor?: string | null; q?: string | null } = {}) {
  const t = tenantDb(scope);
  const where = {
    channel: "WHATSAPP" as const,
    ...(opts.filter === "unread" ? { unreadCount: { gt: 0 } } : {}),
    ...(opts.filter === "needs_human" ? { needsHuman: true } : {}),
    ...(opts.filter === "drafts" ? { messages: { some: { direction: "OUTBOUND" as const, status: "DRAFT" as const, aiDrafted: true } } } : {}),
    ...(opts.q?.trim() ? { lead: { OR: [{ name: { contains: opts.q.trim(), mode: "insensitive" as const } }, { phoneDigits: { contains: opts.q.replace(/\D/g, "") || "~" } }] } } : {}),
  };
  const rows = await t.conversation.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: {
      lead: { select: { id: true, name: true, phone: true, company: true, whatsappOptOut: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, direction: true, createdAt: true, messageType: true } },
      _count: { select: { messages: { where: { direction: "OUTBOUND", status: "DRAFT", aiDrafted: true } } } },
    },
  });
  const page = rows.slice(0, PAGE);
  return {
    items: page.map((c) => ({
      id: c.id,
      leadId: c.lead?.id ?? null,
      name: c.lead?.name ?? "—",
      phone: c.lead?.phone ?? (c.externalThreadId ? `+${c.externalThreadId}` : null),
      company: c.lead?.company ?? null,
      last: c.messages[0] ? { body: c.messages[0].body.slice(0, 120), direction: c.messages[0].direction, at: c.messages[0].createdAt.toISOString(), type: c.messages[0].messageType } : null,
      at: c.lastMessageAt.toISOString(),
      unread: c.unreadCount,
      needsHuman: c.needsHuman,
      hasDraft: c._count.messages > 0,
      optedOut: Boolean(c.lead?.whatsappOptOut),
    })),
    nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
  };
}
export type InboxItem = Awaited<ReturnType<typeof listConversations>>["items"][number];

/** One page of messages (newest first internally, returned oldest→newest). Opening the thread marks it read. */
export async function conversationPage(scope: TenantScope, conversationId: string, before?: string | null, markRead = true) {
  const t = tenantDb(scope);
  const conv = await t.conversation.findUnique({ where: { id: conversationId } });
  if (!conv || conv.channel !== "WHATSAPP") throw new NotFoundError("item");
  const rows = await t.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 31, ...(before ? { cursor: { id: before }, skip: 1 } : {}) });
  const page = rows.slice(0, 30);
  if (markRead && !before && conv.unreadCount > 0) await t.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });
  const w = windowState(conv.lastInboundAt);
  return {
    conversation: { id: conv.id, leadId: conv.leadId, window: { open: w.open, closesAt: w.closesAt?.toISOString() ?? null }, needsHuman: conv.needsHuman },
    messages: page.reverse().map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      status: m.status,
      delivery: m.deliveryStatus,
      type: m.messageType,
      template: m.templateName,
      media: m.mediaFileId ? { url: signedFileUrl(m.mediaFileId, 3600), mime: m.mediaMime } : null,
      aiDrafted: m.aiDrafted,
      author: m.authorType,
      at: (m.sentAt ?? m.createdAt).toISOString(),
      failedReason: m.failedReason,
    })),
    olderCursor: rows.length > 30 ? page[0]?.id ?? null : null,
  };
}
export type ThreadPage = Awaited<ReturnType<typeof conversationPage>>;

async function convWithLead(scope: TenantScope, conversationId: string) {
  const conv = await tenantDb(scope).conversation.findUnique({ where: { id: conversationId }, include: { lead: true } });
  if (!conv || conv.channel !== "WHATSAPP" || !conv.lead) throw new NotFoundError("item");
  if (!conv.lead.phone) throw new UserFacingError("whatsapp_invalid_phone");
  return { conv, lead: conv.lead };
}

async function recordSent(scope: TenantScope, conversationId: string, leadId: string, data: { body: string; externalId: string | null; type: string; template?: string | null; mediaFileId?: string | null; mediaMime?: string | null; aiDrafted?: boolean; replaceId?: string }, actor: Actor) {
  const t = tenantDb(scope);
  const fields = { status: "SENT" as const, sentAt: new Date(), externalId: data.externalId, deliveryStatus: "accepted", messageType: data.type, templateName: data.template ?? null, mediaFileId: data.mediaFileId ?? null, mediaMime: data.mediaMime ?? null, authorId: actor.userId };
  const msg = data.replaceId
    ? await t.message.update({ where: { id: data.replaceId }, data: { ...fields, body: data.body } })
    : await t.message.create({ data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, conversationId, direction: "OUTBOUND", authorType: "USER", body: data.body, aiDrafted: Boolean(data.aiDrafted), ...fields } });
  await t.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), needsHuman: false, unreadCount: 0 } });
  await t.lead.update({ where: { id: leadId }, data: { lastContactAt: new Date() } });
  await t.lead.updateMany({ where: { id: leadId, stage: "NEW" }, data: { stage: "CONTACTED", stageChangedAt: new Date() } });
  await addLeadEvent(scope, leadId, { type: "HUMAN_REPLY", title: data.aiDrafted ? "WhatsApp reply sent (AI-assisted)" : "WhatsApp reply sent", body: data.body.slice(0, 2000), actor: { type: "USER", id: actor.userId, label: actor.label }, data: { channel: "WHATSAPP", template: data.template ?? null } });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: data.aiDrafted ? "whatsapp.ai_assisted_reply" : data.template ? "whatsapp.template_sent" : "whatsapp.human_reply", entityType: "Message", entityId: msg.id, summary: `${actor.label} sent a WhatsApp ${data.template ? `template (${data.template})` : "message"}` });
  return msg;
}

/** A human reply (free text) — inside the 24h window only. */
export async function sendReply(scope: TenantScope, conversationId: string, body: string, actor: Actor) {
  const text = body.trim().slice(0, 4096);
  if (!text) throw new UserFacingError("validation");
  const { conv, lead } = await convWithLead(scope, conversationId);
  if (!windowState(conv.lastInboundAt).open) throw new UserFacingError("whatsapp_window_closed");
  const r = await sendWhatsApp(scope, lead.phone!, { body: text });
  return recordSent(scope, conv.id, lead.id, { body: text, externalId: r.externalId, type: "text" }, actor);
}

/** Sends (optionally edited) an AI draft. Recorded as AI-assisted. */
export async function sendDraft(scope: TenantScope, messageId: string, actor: Actor, editedBody?: string) {
  const t = tenantDb(scope);
  const draft = await t.message.findUnique({ where: { id: messageId } });
  if (!draft || draft.direction !== "OUTBOUND" || draft.status !== "DRAFT") throw new UserFacingError("invalid_transition");
  const { conv, lead } = await convWithLead(scope, draft.conversationId);
  if (!windowState(conv.lastInboundAt).open) throw new UserFacingError("whatsapp_window_closed");
  const body = (editedBody ?? draft.body).trim().slice(0, 4096);
  if (!body) throw new UserFacingError("validation");
  // Claim the draft first so a double click can't send it twice.
  const claimed = await t.message.updateMany({ where: { id: messageId, status: "DRAFT" }, data: { status: "PENDING_APPROVAL" } });
  if (!claimed.count) throw new UserFacingError("invalid_transition");
  try {
    const r = await sendWhatsApp(scope, lead.phone!, { body });
    return await recordSent(scope, conv.id, lead.id, { body, externalId: r.externalId, type: "text", aiDrafted: draft.aiDrafted, replaceId: draft.id }, actor);
  } catch (err) {
    await t.message.update({ where: { id: messageId }, data: { status: "DRAFT" } });
    throw err;
  }
}

export async function rejectDraft(scope: TenantScope, messageId: string, actor: Actor) {
  const t = tenantDb(scope);
  const draft = await t.message.findUnique({ where: { id: messageId } });
  if (!draft || draft.status !== "DRAFT") throw new UserFacingError("invalid_transition");
  await t.message.delete({ where: { id: messageId } });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.draft_rejected", entityType: "Conversation", entityId: draft.conversationId, summary: `${actor.label} rejected a NOVA draft` });
}

/** An approved template (the only option outside the 24h window) with values resolved from the CRM. */
export async function sendTemplateMessage(scope: TenantScope, conversationId: string, templateId: string, actor: Actor, overrides: Record<string, string> = {}) {
  const t = tenantDb(scope);
  const tpl = await t.whatsAppTemplate.findUnique({ where: { id: templateId } });
  if (!tpl || tpl.status !== "APPROVED") throw new UserFacingError("whatsapp_template_not_approved");
  const { conv, lead } = await convWithLead(scope, conversationId);
  const values = await resolveVariables(scope, lead, (tpl.variables ?? {}) as Record<string, string>, overrides, actor.label);
  if (values.missing.length) throw new UserFacingError("whatsapp_template_missing_values");
  const r = await sendWhatsApp(scope, lead.phone!, { template: { name: tpl.name, language: tpl.language, bodyParams: values.values } });
  return recordSent(scope, conv.id, lead.id, { body: renderTemplate(tpl.body, values.values), externalId: r.externalId, type: "template", template: tpl.name }, actor);
}

/** An uploaded file (image / document / audio / video) — inside the 24h window only. */
export async function sendAttachment(scope: TenantScope, conversationId: string, fileId: string, caption: string | undefined, actor: Actor) {
  const file = await tenantDb(scope).fileObject.findFirst({ where: { id: fileId, deletedAt: null } });
  if (!file) throw new NotFoundError("item");
  const kind = file.mimeType.startsWith("image/") ? "image" : file.mimeType.startsWith("video/") ? "video" : file.mimeType.startsWith("audio/") ? "audio" : "document";
  const { conv, lead } = await convWithLead(scope, conversationId);
  if (!windowState(conv.lastInboundAt).open) throw new UserFacingError("whatsapp_window_closed");
  const r = await sendWhatsApp(scope, lead.phone!, { media: { fileId, kind, caption, filename: file.fileName } });
  return recordSent(scope, conv.id, lead.id, { body: caption?.trim() || `[${kind}] ${file.fileName}`, externalId: r.externalId, type: kind, mediaFileId: file.id, mediaMime: file.mimeType }, actor);
}

/** Customer context beside a conversation — the same Lead record the CRM uses. */
export async function customerContext(scope: TenantScope, leadId: string) {
  const t = tenantDb(scope);
  const lead = await t.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new NotFoundError("lead");
  const [opp, owner, meeting, quote] = await Promise.all([
    t.salesOpportunity.findFirst({ where: { leadId, status: "OPEN" }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, valueCents: true, currency: true, status: true } }),
    lead.ownerId ? db.user.findUnique({ where: { id: lead.ownerId }, select: { name: true, email: true } }) : Promise.resolve(null),
    t.meeting.findFirst({ where: { leadId, startAt: { gte: new Date() } }, orderBy: { startAt: "asc" }, select: { id: true, title: true, startAt: true } }),
    t.quote.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, totalCents: true, currency: true } }),
  ]);
  return {
    id: lead.id,
    name: lead.name,
    company: lead.company,
    phone: lead.phone,
    email: lead.email,
    stage: lead.stage,
    temperature: lead.temperature,
    interests: lead.interests,
    tags: lead.tags,
    source: lead.source,
    lastContactAt: lead.lastContactAt?.toISOString() ?? null,
    optedOut: lead.whatsappOptOut,
    owner: owner?.name ?? owner?.email ?? null,
    opportunity: opp ? { id: opp.id, title: opp.title, value: opp.valueCents, currency: opp.currency, status: opp.status } : null,
    meeting: meeting ? { id: meeting.id, title: meeting.title, at: meeting.startAt?.toISOString() ?? null } : null,
    quote: quote ? { id: quote.id, status: quote.status, total: quote.totalCents, currency: quote.currency } : null,
  };
}
export type CustomerContext = Awaited<ReturnType<typeof customerContext>>;
