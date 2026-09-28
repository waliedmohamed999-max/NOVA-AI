import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { UserFacingError } from "../errors";
import { logger } from "../logger";
import { addLeadEvent, createLead } from "../sales/service";
import { aiAvailability } from "../ai";
import { getPhoneNumber, normalizePhone, parseWebhook, sendTemplate, sendText, whatsappStatus, type WaInbound, type WaStatus } from "./cloud-api";

/** Meta only delivers free-form messages within 24h of the customer's last message. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function numberFor(scope: TenantScope) {
  return db.whatsAppNumber.findFirst({ where: { ...scope, isActive: true }, orderBy: { createdAt: "asc" } });
}

/** Admin: link a Cloud API phone_number_id to a workspace after verifying it with Meta. */
export async function linkNumber(scope: TenantScope, phoneNumberId: string, wabaId?: string | null) {
  if (!whatsappStatus().configured) throw new UserFacingError("integration_not_configured");
  const info = await getPhoneNumber(phoneNumberId.trim());
  return db.whatsAppNumber.upsert({
    where: { phoneNumberId: info.id },
    create: { ...scope, phoneNumberId: info.id, wabaId: wabaId ?? null, displayPhone: info.display_phone_number ?? null, verifiedName: info.verified_name ?? null, lastCheckedAt: new Date() },
    update: { ...scope, wabaId: wabaId ?? undefined, displayPhone: info.display_phone_number ?? null, verifiedName: info.verified_name ?? null, isActive: true, lastCheckedAt: new Date(), lastError: null },
  });
}

/** Processes a signature-verified webhook body. Idempotent: redelivered message ids are ignored. */
export async function processWebhook(body: unknown) {
  const { messages, statuses } = parseWebhook(body);
  let received = 0;
  for (const m of messages) if (await handleInbound(m)) received++;
  for (const s of statuses) await handleStatus(s);
  return { received, statuses: statuses.length };
}

async function handleInbound(m: WaInbound) {
  const number = await db.whatsAppNumber.findUnique({ where: { phoneNumberId: m.phoneNumberId } });
  if (!number?.isActive) {
    logger.warn({ phoneNumberId: m.phoneNumberId }, "whatsapp: message for an unlinked number ignored");
    return false;
  }
  const scope = { organizationId: number.organizationId, workspaceId: number.workspaceId };
  if (await db.message.findFirst({ where: { organizationId: scope.organizationId, externalId: m.id }, select: { id: true } })) return false;

  const phone = normalizePhone(m.from);
  const text = m.text ?? `[${m.type}]`;
  const candidates = await db.lead.findMany({ where: { ...scope, phone: { not: null } }, select: { id: true, phone: true, name: true }, orderBy: { createdAt: "desc" }, take: 500 });
  let lead = candidates.find((l) => normalizePhone(l.phone!) === phone) ?? null;
  const isNew = !lead;
  if (!lead) {
    const created = await createLead(
      scope,
      { name: m.profileName || `+${phone}`, phone: `+${phone}`, channel: "WHATSAPP", source: "WhatsApp", attribution: { medium: "whatsapp", utmSource: "whatsapp" } },
      { type: "SYSTEM", label: "WhatsApp" },
      { qualify: false },
    );
    lead = { id: created.id, phone: created.phone, name: created.name };
  }

  const conv =
    (await db.conversation.findFirst({ where: { ...scope, leadId: lead.id, channel: "WHATSAPP" }, orderBy: { lastMessageAt: "desc" } })) ??
    (await db.conversation.create({
      data: { ...scope, leadId: lead.id, channel: "WHATSAPP", externalThreadId: phone, subject: "WhatsApp", participants: { create: { organizationId: scope.organizationId, kind: "USER", name: lead.name, handle: `+${phone}` } } },
    }));
  await db.message.create({ data: { ...scope, conversationId: conv.id, direction: "INBOUND", authorType: "USER", body: text.slice(0, 8000), status: "RECEIVED", externalId: m.id, sentAt: m.timestamp } });
  await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: m.timestamp, status: "OPEN" } });
  await addLeadEvent(scope, lead.id, { type: "MESSAGE_RECEIVED", title: "WhatsApp message received", body: text.slice(0, 2000), actor: { type: "SYSTEM", label: "WhatsApp" } });

  // Existing customer replied: tell the owner (new leads are announced by qualification instead).
  if (!isNew) {
    const { notify } = await import("../notifications/service");
    const owner = await db.lead.findUnique({ where: { id: lead.id }, select: { ownerId: true } });
    await notify({ ...scope, type: "HOT_OPPORTUNITY", title: `${lead.name} replied on WhatsApp`, body: text.slice(0, 140), link: `/leads/${lead.id}`, ...(owner?.ownerId ? { userIds: [owner.ownerId] } : {}) });
  }
  // The Sales Agent qualifies new leads (draft reply → approval policy decides whether it goes out).
  if (isNew && aiAvailability().configured) {
    const { startRun } = await import("../agents/runtime");
    await startRun(scope, { kind: "lead_qualify", agent: "SALES_AGENT", steps: ["reading_lead", "reviewing_business", "qualifying", "recommending_action"], params: { leadId: lead.id } });
  }
  return true;
}

async function handleStatus(s: WaStatus) {
  const number = await db.whatsAppNumber.findUnique({ where: { phoneNumberId: s.phoneNumberId }, select: { organizationId: true } });
  if (!number) return;
  await db.message.updateMany({
    where: { organizationId: number.organizationId, externalId: s.id, direction: "OUTBOUND" },
    data: { deliveryStatus: s.error ? `${s.status}: ${s.error}`.slice(0, 200) : s.status, ...(s.status === "failed" ? { status: "FAILED" as const } : {}) },
  });
}

/** Is the 24h customer-service window open for this contact? */
export async function windowOpen(scope: TenantScope, phone: string, now = new Date()) {
  const p = normalizePhone(phone);
  const last = await db.message.findFirst({
    where: { ...scope, direction: "INBOUND", conversation: { channel: "WHATSAPP", externalThreadId: p } },
    orderBy: { createdAt: "desc" },
    select: { sentAt: true, createdAt: true },
  });
  const at = last?.sentAt ?? last?.createdAt;
  return Boolean(at && now.getTime() - at.getTime() < SERVICE_WINDOW_MS);
}

/**
 * Sends through the workspace's linked number. Free text only inside the 24h window; outside it the caller
 * must use an approved template (never silently "sent").
 */
export async function sendWhatsApp(scope: TenantScope, to: string, message: { body: string } | { template: { name: string; language: string; bodyParams?: string[] } }) {
  const number = await numberFor(scope);
  if (!number || !whatsappStatus().configured) throw new UserFacingError("integration_not_configured");
  if ("template" in message) return sendTemplate(number.phoneNumberId, to, message.template);
  if (!(await windowOpen(scope, to))) throw new UserFacingError("whatsapp_window_closed");
  return sendText(number.phoneNumberId, to, message.body);
}
