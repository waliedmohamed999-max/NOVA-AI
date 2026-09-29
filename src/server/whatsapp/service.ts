import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { UserFacingError } from "../errors";
import { logger } from "../logger";
import { audit } from "../audit";
import { enqueue } from "../jobs/queue";
import { addLeadEvent, createLead } from "../sales/service";
import { saveUpload, signedFileUrl } from "../storage";
import { fetchMedia, normalizePhone, parseWebhook, sendMedia, sendTemplate, sendText, validPhone, type WaInbound, type WaStatus } from "./cloud-api";
import { classifyIntent, isOptOut, windowState, SERVICE_WINDOW_MS } from "./policy";
import { numberFor, sendingNumber, tokenFor } from "./numbers";

export { SERVICE_WINDOW_MS };
export { numberFor, linkNumber } from "./numbers";

/**
 * WhatsApp inbound pipeline (webhook → verified → deduplicated → routed by phone_number_id → contact →
 * Lead → Conversation → Message → intent → reply policy) and outbound sending. Every step is idempotent:
 * a redelivered webhook changes nothing. The organization always comes from our phone_number_id mapping,
 * never from the payload or the client.
 */

type Actor = { type: "USER" | "AGENT" | "SYSTEM"; id?: string | null; label: string };

export async function processWebhook(body: unknown) {
  const { messages, statuses } = parseWebhook(body);
  let received = 0;
  for (const m of messages) if (await handleInbound(m)) received++;
  for (const s of statuses) await handleStatus(s);
  return { received, statuses: statuses.length };
}

async function workspaceConfig(scope: TenantScope) {
  const s = await db.workspaceSettings.findFirst({ where: scope, select: { whatsappAutoReply: true, whatsappConfig: true } });
  const cfg = (s?.whatsappConfig ?? {}) as { optOutKeywords?: string[]; requireConsent?: boolean; safeIntents?: string[]; goals?: string[] };
  return { level: s?.whatsappAutoReply ?? "DRAFT", optOutKeywords: cfg.optOutKeywords ?? [], requireConsent: Boolean(cfg.requireConsent), safeIntents: cfg.safeIntents, goals: cfg.goals ?? [] };
}

/** Contact → Lead by digits-only phone (one lead per number per workspace — no duplicates). */
export async function resolveContact(scope: TenantScope, phoneDigits: string, profileName: string | null) {
  const existing = await db.lead.findFirst({ where: { ...scope, phoneDigits }, orderBy: { createdAt: "asc" } });
  if (existing) return { lead: existing, isNew: false };
  const created = await createLead(
    scope,
    { name: profileName?.trim() || `+${phoneDigits}`, phone: `+${phoneDigits}`, channel: "WHATSAPP", source: "WhatsApp", attribution: { medium: "whatsapp", utmSource: "whatsapp" } },
    { type: "SYSTEM", label: "WhatsApp" },
    { qualify: false },
  );
  return { lead: await db.lead.findUniqueOrThrow({ where: { id: created.id } }), isNew: true };
}

export async function whatsappConversation(scope: TenantScope, lead: { id: string; name: string; phoneDigits: string | null }, numberId?: string | null) {
  const found = await db.conversation.findFirst({ where: { ...scope, leadId: lead.id, channel: "WHATSAPP" }, orderBy: { lastMessageAt: "desc" } });
  if (found) return found;
  return db.conversation.create({
    data: {
      ...scope,
      leadId: lead.id,
      channel: "WHATSAPP",
      externalThreadId: lead.phoneDigits,
      subject: "WhatsApp",
      whatsappNumberId: numberId ?? null,
      participants: { create: { organizationId: scope.organizationId, kind: "USER", name: lead.name, handle: lead.phoneDigits ? `+${lead.phoneDigits}` : null } },
    },
  });
}

async function handleInbound(m: WaInbound) {
  const number = await db.whatsAppNumber.findUnique({ where: { phoneNumberId: m.phoneNumberId } });
  if (!number?.isActive) {
    logger.warn({ phoneNumberId: m.phoneNumberId }, "whatsapp: message for an unlinked number ignored");
    return false;
  }
  const scope = { organizationId: number.organizationId, workspaceId: number.workspaceId };
  await db.whatsAppNumber.update({ where: { id: number.id }, data: { lastWebhookAt: new Date() } });
  if (await db.message.findFirst({ where: { organizationId: scope.organizationId, externalId: m.id }, select: { id: true } })) return false;

  const phone = normalizePhone(m.from);
  if (!validPhone(phone)) return false;
  const cfg = await workspaceConfig(scope);
  const { lead, isNew } = await resolveContact(scope, phone, m.profileName);
  const conv = await whatsappConversation(scope, lead, number.id);
  const intent = classifyIntent(m.text);
  const text = m.text ?? `[${m.type}]`;

  let message;
  try {
    message = await db.message.create({
      data: { ...scope, conversationId: conv.id, direction: "INBOUND", authorType: "USER", body: text.slice(0, 8000), status: "RECEIVED", externalId: m.id, sentAt: m.timestamp, messageType: m.media ? m.type : m.type === "text" ? "text" : m.type, mediaMime: m.media?.mime ?? null, intent },
    });
  } catch (err) {
    // A concurrent redelivery won the race: nothing else to do.
    logger.warn({ err }, "whatsapp: inbound insert raced");
    return false;
  }
  const at = m.timestamp.getTime() > Date.now() ? new Date() : m.timestamp;
  await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: at, lastInboundAt: at, status: "OPEN", unreadCount: { increment: 1 }, whatsappNumberId: number.id } });
  await db.lead.update({ where: { id: lead.id }, data: { lastContactAt: at } });
  await addLeadEvent(scope, lead.id, { type: "MESSAGE_RECEIVED", title: isNew ? "Started a conversation on WhatsApp" : "WhatsApp message received", body: text.slice(0, 2000), actor: { type: "SYSTEM", label: "WhatsApp" }, data: { channel: "WHATSAPP", messageId: message.id } });

  // Opt-out / opt-in are honored immediately (campaigns re-check at send time too).
  if (isOptOut(m.text, cfg.optOutKeywords)) await setOptOut(scope, lead.id, true, { type: "SYSTEM", label: "WhatsApp" }, "opt_out");
  else if (intent === "opt_in" && lead.whatsappOptOut) await setOptOut(scope, lead.id, false, { type: "SYSTEM", label: "WhatsApp" }, "opt_in");

  await attributeReply(scope, lead.id, at);
  if (m.media) await enqueue("whatsapp.media", { ...scope, messageId: message.id, mediaId: m.media.id, filename: m.media.filename }, { ...scope, dedupeKey: `whatsapp.media:${message.id}` });
  await enqueue("whatsapp.reply", { ...scope, messageId: message.id }, { ...scope, priority: 5, dedupeKey: `whatsapp.reply:${message.id}` });

  if (!isNew) {
    const { notify } = await import("../notifications/service");
    await notify({ ...scope, type: "HOT_OPPORTUNITY", title: `${lead.name} · WhatsApp`, body: text.slice(0, 140), link: `/whatsapp/inbox?c=${conv.id}`, ...(lead.ownerId ? { userIds: [lead.ownerId] } : {}) });
  }
  return true;
}

/** A reply from someone who got a campaign message in the last 7 days is attributed to that campaign. */
async function attributeReply(scope: TenantScope, leadId: string, at: Date) {
  const since = new Date(at.getTime() - 7 * 86_400_000);
  const r = await db.campaignRecipient.findFirst({ where: { ...scope, leadId, status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gte: since }, repliedAt: null }, orderBy: { sentAt: "desc" } });
  if (!r) return;
  await db.campaignRecipient.update({ where: { id: r.id }, data: { repliedAt: at } });
  await db.lead.updateMany({ where: { id: leadId, campaignId: null }, data: { campaignId: r.campaignId, utmCampaign: `whatsapp:${r.campaignId}` } });
}

const RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3 };

/** Delivery states update the same message (and campaign recipient); they never go backwards or duplicate. */
async function handleStatus(s: WaStatus) {
  const number = await db.whatsAppNumber.findUnique({ where: { phoneNumberId: s.phoneNumberId }, select: { id: true, organizationId: true } });
  if (!number) return;
  await db.whatsAppNumber.update({ where: { id: number.id }, data: { lastWebhookAt: new Date() } });
  const failed = s.status === "failed";
  const msg = await db.message.findFirst({ where: { organizationId: number.organizationId, externalId: s.id, direction: "OUTBOUND" } });
  if (msg) {
    const cur = RANK[msg.deliveryStatus ?? ""] ?? -1;
    if (failed || (RANK[s.status] ?? -1) > cur) {
      await db.message.update({
        where: { id: msg.id },
        data: {
          deliveryStatus: s.status,
          ...(s.status === "delivered" ? { deliveredAt: s.timestamp } : {}),
          ...(s.status === "read" ? { readAt: s.timestamp, deliveredAt: msg.deliveredAt ?? s.timestamp } : {}),
          ...(failed ? { status: "FAILED" as const, failedReason: s.error?.slice(0, 200) ?? "failed" } : {}),
        },
      });
    }
  }
  const rec = await db.campaignRecipient.findFirst({ where: { organizationId: number.organizationId, externalId: s.id } });
  if (rec) {
    const order: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3 };
    const next = failed ? "FAILED" : s.status.toUpperCase();
    if (failed || (order[next] ?? 0) > (order[rec.status] ?? 0)) {
      await db.campaignRecipient.update({
        where: { id: rec.id },
        data: { status: next, ...(s.status === "delivered" ? { deliveredAt: s.timestamp } : {}), ...(s.status === "read" ? { readAt: s.timestamp, deliveredAt: rec.deliveredAt ?? s.timestamp } : {}), ...(failed ? { error: s.error?.slice(0, 200) ?? "failed" } : {}) },
      });
    }
  }
}

/** Downloads an inbound media file into our StorageProvider (type/size validated by saveUpload). */
export async function storeInboundMedia(scope: TenantScope, messageId: string, mediaId: string, filename?: string | null) {
  const msg = await tenantDb(scope).message.findUnique({ where: { id: messageId }, include: { conversation: true } });
  if (!msg || msg.mediaFileId) return { skipped: true };
  const number = msg.conversation.whatsappNumberId ? await db.whatsAppNumber.findUnique({ where: { id: msg.conversation.whatsappNumberId } }) : await numberFor(scope);
  const token = number ? await tokenFor(number) : null;
  if (!token) return { skipped: true };
  const file = await fetchMedia(mediaId, token);
  const ext = file.mime.split("/")[1]?.split(";")[0] ?? "bin";
  try {
    const saved = await saveUpload({ ...scope, fileName: filename || `whatsapp-${messageId}.${ext}`, data: file.data, purpose: "whatsapp_media" });
    await db.message.update({ where: { id: messageId }, data: { mediaFileId: saved.id, mediaMime: saved.mimeType } });
    return { fileId: saved.id };
  } catch (err) {
    // Unsupported type or too large: keep the message, note why the file isn't attached.
    await db.message.update({ where: { id: messageId }, data: { failedReason: err instanceof UserFacingError ? err.code : "media_failed" } });
    return { skipped: true };
  }
}

// ── Opt-out / suppression ──

export async function setOptOut(scope: TenantScope, leadId: string, optOut: boolean, actor: Actor, reason: "opt_out" | "opt_in" | "manual" = "manual") {
  const lead = await tenantDb(scope).lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new UserFacingError("item_not_found");
  await db.lead.update({ where: { id: leadId }, data: { whatsappOptOut: optOut, whatsappOptOutAt: optOut ? new Date() : null } });
  if (lead.phoneDigits) {
    if (optOut) await db.whatsAppSuppression.upsert({ where: { workspaceId_phone: { workspaceId: scope.workspaceId, phone: lead.phoneDigits } }, create: { ...scope, phone: lead.phoneDigits, reason: reason === "manual" ? "manual" : "opt_out", createdById: actor.type === "USER" ? (actor.id ?? null) : null }, update: {} });
    else await db.whatsAppSuppression.deleteMany({ where: { ...scope, phone: lead.phoneDigits, reason: { in: ["opt_out", "manual"] } } });
  }
  await addLeadEvent(scope, leadId, { type: "NOTE", title: optOut ? "Opted out of WhatsApp messages" : "Opted back in to WhatsApp messages", actor });
  await audit({ ...scope, actorType: actor.type, actorId: actor.id ?? undefined, actorLabel: actor.label, action: optOut ? "whatsapp.opt_out" : "whatsapp.opt_in", entityType: "Lead", entityId: leadId, summary: `${lead.name}: WhatsApp ${optOut ? "opt-out" : "opt-in"} (${reason})` });
}

export async function isSuppressed(scope: TenantScope, phoneDigits: string) {
  return Boolean(await db.whatsAppSuppression.findUnique({ where: { workspaceId_phone: { workspaceId: scope.workspaceId, phone: phoneDigits } } }));
}

// ── Sending ──

/** Is the 24h customer-service window open for this contact? (Measured from their last message.) */
export async function windowOpen(scope: TenantScope, phone: string, now = new Date()) {
  const p = normalizePhone(phone);
  const conv = await db.conversation.findFirst({ where: { ...scope, channel: "WHATSAPP", externalThreadId: p }, orderBy: { lastInboundAt: "desc" }, select: { lastInboundAt: true } });
  return windowState(conv?.lastInboundAt, now).open;
}

export type OutboundContent =
  | { body: string }
  | { template: { name: string; language: string; bodyParams?: string[] } }
  | { media: { fileId: string; kind: "image" | "document" | "audio" | "video"; caption?: string; filename?: string } };

/**
 * Sends through the workspace's number. Free text and media only inside the 24h window; outside it only an
 * approved template (never silently "sent"). Opted-out contacts receive nothing.
 */
export async function sendWhatsApp(scope: TenantScope, to: string, message: OutboundContent) {
  const s = await sendingNumber(scope);
  if (!s) throw new UserFacingError("integration_not_configured");
  const digits = normalizePhone(to);
  if (!validPhone(digits)) throw new UserFacingError("whatsapp_invalid_phone");
  const lead = await db.lead.findFirst({ where: { ...scope, phoneDigits: digits }, select: { whatsappOptOut: true } });
  if (lead?.whatsappOptOut) throw new UserFacingError("whatsapp_opted_out");
  let r: { externalId: string | null };
  if ("template" in message) r = await sendTemplate(s.number.phoneNumberId, digits, message.template, s.token);
  else {
    if (!(await windowOpen(scope, digits))) throw new UserFacingError("whatsapp_window_closed");
    if ("media" in message) {
      const file = await tenantDb(scope).fileObject.findFirst({ where: { id: message.media.fileId, deletedAt: null } });
      if (!file) throw new UserFacingError("item_not_found");
      const link = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}${signedFileUrl(file.id, 3600)}`;
      r = await sendMedia(s.number.phoneNumberId, digits, { kind: message.media.kind, link, caption: message.media.caption, filename: message.media.filename ?? file.fileName }, s.token);
    } else r = await sendText(s.number.phoneNumberId, digits, message.body, s.token);
  }
  await db.whatsAppNumber.update({ where: { id: s.number.id }, data: { lastSendAt: new Date() } });
  return r;
}
