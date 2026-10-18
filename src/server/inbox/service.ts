import type { Channel, Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { audit } from "../audit";
import { channelFor } from "../sales/channels";
import { sendMessage } from "../sales/service";
import { sendReply as sendWhatsAppReply } from "../whatsapp/inbox";
import { windowState } from "../whatsapp/policy";

/**
 * The unified inbox: every conversation on every channel (website forms, email, WhatsApp, social DMs, manual),
 * read from the shared Conversation / Message / Lead records. WhatsApp keeps its own specialised inbox
 * (templates, media, 24h window tools); here it is listed alongside the rest and plain replies work too.
 */

export type InboxFilter = "all" | "needs_reply" | "unread" | "closed";
type Actor = { userId: string; label: string };
const PAGE = 30;

/** "Needs reply": still open and the customer spoke last (or a person was explicitly asked to step in). */
function needsReplyWhere(): Prisma.ConversationWhereInput {
  return {
    status: { not: "CLOSED" },
    OR: [{ needsHuman: true }, { unreadCount: { gt: 0 } }, { lastInboundAt: { gte: db.conversation.fields.lastMessageAt } }],
  };
}

export async function listInbox(scope: TenantScope, opts: { filter?: InboxFilter; channel?: Channel | null; q?: string | null; cursor?: string | null } = {}) {
  const t = tenantDb(scope);
  const q = opts.q?.trim();
  const and: Prisma.ConversationWhereInput[] = [];
  if (opts.channel) and.push({ channel: opts.channel });
  if (opts.filter === "needs_reply") and.push(needsReplyWhere());
  else if (opts.filter === "unread") and.push({ unreadCount: { gt: 0 } });
  else if (opts.filter === "closed") and.push({ status: "CLOSED" });
  else and.push({ status: { not: "CLOSED" } });
  if (q) {
    const digits = q.replace(/\D/g, "");
    and.push({
      OR: [
        { subject: { contains: q, mode: "insensitive" } },
        { lead: { OR: [{ name: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ phoneDigits: { contains: digits } }] : [])] } },
        { messages: { some: { body: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  const rows = await t.conversation.findMany({
    where: { AND: and },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: {
      lead: { select: { id: true, name: true, company: true, email: true, phone: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, direction: true, messageType: true } },
    },
  });
  const page = rows.slice(0, PAGE);
  return {
    items: page.map((c) => {
      const last = c.messages[0] ?? null;
      return {
        id: c.id,
        channel: c.channel,
        status: c.status,
        name: c.lead?.name ?? c.lead?.email ?? c.lead?.phone ?? null,
        company: c.lead?.company ?? null,
        subject: c.subject,
        last: last ? { body: last.body.slice(0, 140), inbound: last.direction === "INBOUND", type: last.messageType } : null,
        at: c.lastMessageAt,
        unread: c.unreadCount,
        needsReply: c.status !== "CLOSED" && (c.needsHuman || c.unreadCount > 0 || last?.direction === "INBOUND"),
      };
    }),
    nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
  };
}
export type InboxListItem = Awaited<ReturnType<typeof listInbox>>["items"][number];

/** Counters for the filter chips. */
export async function inboxCounts(scope: TenantScope) {
  const t = tenantDb(scope);
  const [open, needsReply, unread] = await Promise.all([
    t.conversation.count({ where: { status: { not: "CLOSED" } } }),
    t.conversation.count({ where: needsReplyWhere() }),
    t.conversation.count({ where: { unreadCount: { gt: 0 } } }),
  ]);
  return { open, needsReply, unread };
}

/** One conversation with its latest messages (oldest → newest). Opening it marks it read. */
export async function getThread(scope: TenantScope, conversationId: string, opts: { markRead?: boolean } = {}) {
  const t = tenantDb(scope);
  const conv = await t.conversation.findUnique({
    where: { id: conversationId },
    include: { lead: { select: { id: true, name: true, company: true, email: true, phone: true, stage: true, temperature: true } } },
  });
  if (!conv) throw new NotFoundError("item");
  const rows = await t.message.findMany({ where: { conversationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 60 });
  if (opts.markRead !== false && conv.unreadCount > 0) await t.conversation.update({ where: { id: conversationId }, data: { unreadCount: 0 } });

  const channel = channelFor(conv.channel);
  const configured = Boolean(await channel?.isConfigured(scope));
  const via = configured ? await channel!.describe(scope) : null;
  const recipient = conv.channel === "WHATSAPP" ? conv.lead?.phone : conv.channel === "EMAIL" || conv.channel === "WEBSITE" ? conv.lead?.email : null;
  const window = conv.channel === "WHATSAPP" ? windowState(conv.lastInboundAt) : null;
  // Why a reply can't go out from here (null = it can).
  const blocked: string | null = !configured
    ? "integration_not_configured"
    : !recipient
      ? "no_recipient"
      : window && !window.open
        ? "whatsapp_window_closed"
        : null;

  return {
    conversation: { id: conv.id, channel: conv.channel, status: conv.status, subject: conv.subject, lead: conv.lead },
    messages: rows.reverse().map((m) => ({
      id: m.id,
      inbound: m.direction === "INBOUND",
      body: m.body,
      status: m.status,
      type: m.messageType,
      aiDrafted: m.aiDrafted,
      author: m.authorType,
      at: m.sentAt ?? m.createdAt,
    })),
    reply: { blocked, via },
  };
}
export type InboxThread = Awaited<ReturnType<typeof getThread>>;

/** A person's reply from the inbox, through the conversation's own channel. */
export async function replyToConversation(scope: TenantScope, conversationId: string, body: string, actor: Actor) {
  const text = body.trim().slice(0, 8000);
  if (!text) throw new UserFacingError("validation");
  const t = tenantDb(scope);
  const conv = await t.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) throw new NotFoundError("item");
  // WhatsApp has its own rules (24h window, opt-out, number) — reuse that path.
  if (conv.channel === "WHATSAPP") {
    const msg = await sendWhatsAppReply(scope, conversationId, text, actor);
    await reopenIfClosed(scope, conv.id, conv.status);
    return msg;
  }
  const channel = channelFor(conv.channel);
  if (!channel || !(await channel.isConfigured(scope))) throw new UserFacingError("integration_not_configured");
  const draft = await t.message.create({
    data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, conversationId, direction: "OUTBOUND", authorType: "USER", authorId: actor.userId, body: text, status: "DRAFT" },
  });
  const subject = conv.subject ? (/^re:/i.test(conv.subject) ? conv.subject : `Re: ${conv.subject}`) : null;
  const sent = await sendMessage(scope, draft.id, { type: "USER", id: actor.userId, label: actor.label }, subject);
  await t.conversation.update({ where: { id: conv.id }, data: { needsHuman: false, unreadCount: 0 } });
  await reopenIfClosed(scope, conv.id, conv.status);
  return sent;
}

async function reopenIfClosed(scope: TenantScope, id: string, status: string) {
  if (status === "CLOSED") await tenantDb(scope).conversation.update({ where: { id }, data: { status: "OPEN" } });
}

/** Close a handled conversation (it leaves the open list) or reopen it. */
export async function setConversationStatus(scope: TenantScope, conversationId: string, status: "OPEN" | "CLOSED", actor: Actor) {
  const t = tenantDb(scope);
  const conv = await t.conversation.findUnique({ where: { id: conversationId } });
  if (!conv) throw new NotFoundError("item");
  if (conv.status === status) return conv;
  const updated = await t.conversation.update({ where: { id: conversationId }, data: { status, ...(status === "CLOSED" ? { needsHuman: false, unreadCount: 0 } : {}) } });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: status === "CLOSED" ? "conversation.closed" : "conversation.reopened", entityType: "Conversation", entityId: conversationId, summary: `${actor.label} ${status === "CLOSED" ? "closed" : "reopened"} a conversation` });
  return updated;
}
