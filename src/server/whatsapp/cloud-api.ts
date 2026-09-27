import { createHmac } from "node:crypto";
import { providerFetch } from "../integrations/http";
import { safeEqual } from "../crypto";

/**
 * WhatsApp Business Platform (Cloud API) — the official Meta API only. No WhatsApp Web automation, no
 * personal numbers. Credentials (env):
 *   WHATSAPP_ACCESS_TOKEN   system-user token with whatsapp_business_messaging (+ _management for templates)
 *   WHATSAPP_APP_SECRET     Meta app secret — verifies X-Hub-Signature-256 on webhooks
 *   WHATSAPP_VERIFY_TOKEN   random string you enter in the Meta webhook setup (GET challenge)
 *   WHATSAPP_API_VERSION    optional, default v21.0
 */
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "") ?? "";
const version = () => clean(process.env.WHATSAPP_API_VERSION) || "v21.0";
const graph = (path: string) => `https://graph.facebook.com/${version()}/${path}`;

export function whatsappStatus() {
  const token = Boolean(clean(process.env.WHATSAPP_ACCESS_TOKEN));
  const secret = Boolean(clean(process.env.WHATSAPP_APP_SECRET));
  const verify = Boolean(clean(process.env.WHATSAPP_VERIFY_TOKEN));
  const missing = [!token && "WHATSAPP_ACCESS_TOKEN", !secret && "WHATSAPP_APP_SECRET", !verify && "WHATSAPP_VERIFY_TOKEN"].filter(Boolean) as string[];
  return { configured: token, webhookReady: secret && verify, missing };
}

/** Meta's webhook subscription handshake. Returns the challenge to echo, or null (→ 403). */
export function verifyWebhookChallenge(params: URLSearchParams): string | null {
  const expected = clean(process.env.WHATSAPP_VERIFY_TOKEN);
  if (!expected) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  const token = params.get("hub.verify_token") ?? "";
  if (!safeEqual(token, expected)) return null;
  return params.get("hub.challenge");
}

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, raw body). Constant-time compare. */
export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = clean(process.env.WHATSAPP_APP_SECRET);
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  return safeEqual(header, expected);
}

const auth = () => ({ authorization: `Bearer ${clean(process.env.WHATSAPP_ACCESS_TOKEN)}`, "content-type": "application/json" });

export type PhoneNumberInfo = { id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string; code_verification_status?: string };

export async function getPhoneNumber(phoneNumberId: string) {
  return providerFetch<PhoneNumberInfo>(graph(`${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`), { headers: auth() });
}

/** Free-form text — Meta only delivers it inside the 24h customer-service window. */
export async function sendText(phoneNumberId: string, to: string, body: string) {
  const r = await providerFetch<{ messages?: { id: string }[] }>(graph(`${encodeURIComponent(phoneNumberId)}/messages`), {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: normalizePhone(to), type: "text", text: { preview_url: false, body: body.slice(0, 4096) } }),
  });
  return { externalId: r.messages?.[0]?.id ?? null };
}

/** Pre-approved template — the only way to start a conversation (outside the 24h window). */
export async function sendTemplate(phoneNumberId: string, to: string, template: { name: string; language: string; bodyParams?: string[] }) {
  const components = template.bodyParams?.length ? [{ type: "body", parameters: template.bodyParams.map((text) => ({ type: "text", text })) }] : undefined;
  const r = await providerFetch<{ messages?: { id: string }[] }>(graph(`${encodeURIComponent(phoneNumberId)}/messages`), {
    method: "POST",
    headers: auth(),
    body: JSON.stringify({ messaging_product: "whatsapp", to: normalizePhone(to), type: "template", template: { name: template.name, language: { code: template.language }, ...(components ? { components } : {}) } }),
  });
  return { externalId: r.messages?.[0]?.id ?? null };
}

export type TemplateInfo = { name: string; language: string; status: string; category: string };

/** Approved templates of the WhatsApp Business Account (needs whatsapp_business_management). */
export async function listTemplates(wabaId: string): Promise<TemplateInfo[]> {
  const r = await providerFetch<{ data: TemplateInfo[] }>(graph(`${encodeURIComponent(wabaId)}/message_templates?fields=name,language,status,category&limit=100`), { headers: auth() });
  return r.data ?? [];
}

/** E.164 digits only (Cloud API accepts "+" too, but digits keep matching consistent). */
export function normalizePhone(p: string) {
  return p.replace(/[^\d]/g, "");
}

// ── Webhook payload (subset we use) ──
export type WaInbound = { phoneNumberId: string; from: string; profileName: string | null; id: string; timestamp: Date; type: string; text: string | null };
export type WaStatus = { phoneNumberId: string; id: string; status: string; recipient: string; timestamp: Date; error: string | null };

type WebhookBody = {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: { from: string; id: string; timestamp: string; type: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }[];
        statuses?: { id: string; status: string; recipient_id: string; timestamp: string; errors?: { code?: number; title?: string }[] }[];
      };
    }[];
  }[];
};

export function parseWebhook(body: unknown): { messages: WaInbound[]; statuses: WaStatus[] } {
  const b = body as WebhookBody;
  const messages: WaInbound[] = [];
  const statuses: WaStatus[] = [];
  if (b?.object !== "whatsapp_business_account") return { messages, statuses };
  for (const entry of b.entry ?? [])
    for (const change of entry.changes ?? []) {
      const v = change.value;
      const phoneNumberId = v?.metadata?.phone_number_id;
      if (!v || !phoneNumberId) continue;
      for (const m of v.messages ?? []) {
        const contact = v.contacts?.find((c) => c.wa_id === m.from) ?? v.contacts?.[0];
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
        messages.push({ phoneNumberId, from: m.from, profileName: contact?.profile?.name ?? null, id: m.id, timestamp: new Date(Number(m.timestamp) * 1000), type: m.type, text });
      }
      for (const s of v.statuses ?? [])
        statuses.push({ phoneNumberId, id: s.id, status: s.status, recipient: s.recipient_id, timestamp: new Date(Number(s.timestamp) * 1000), error: s.errors?.[0] ? `${s.errors[0].code ?? ""} ${s.errors[0].title ?? ""}`.trim() : null });
    }
  return { messages, statuses };
}
