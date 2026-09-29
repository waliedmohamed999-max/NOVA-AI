import { createHmac, randomBytes } from "node:crypto";
import { providerFetch } from "../integrations/http";
import { ProviderError } from "../integrations/types";
import { safeEqual } from "../crypto";

/**
 * WhatsApp Business Platform (Cloud API) — the official Meta API only. No WhatsApp Web automation, no
 * personal numbers, no passwords. Credentials (env, platform admin only):
 *   WHATSAPP_ACCESS_TOKEN        system-user token (platform-linked numbers)
 *   WHATSAPP_APP_ID              Meta app id (Embedded Signup code exchange)
 *   WHATSAPP_APP_SECRET          Meta app secret — verifies X-Hub-Signature-256 and exchanges signup codes
 *   WHATSAPP_VERIFY_TOKEN        random string entered in the Meta webhook setup (GET challenge)
 *   WHATSAPP_EMBEDDED_CONFIG_ID  Embedded Signup configuration id (Facebook Login for Business)
 *   WHATSAPP_API_VERSION         optional, default v21.0
 * Businesses connected through Embedded Signup get their own token, stored encrypted (IntegrationCredential).
 */
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "") ?? "";
const version = () => clean(process.env.WHATSAPP_API_VERSION) || "v21.0";
const graph = (path: string) => `https://graph.facebook.com/${version()}/${path}`;

export function whatsappStatus() {
  const token = Boolean(clean(process.env.WHATSAPP_ACCESS_TOKEN));
  const secret = Boolean(clean(process.env.WHATSAPP_APP_SECRET));
  const verify = Boolean(clean(process.env.WHATSAPP_VERIFY_TOKEN));
  const missing = [!token && "WHATSAPP_ACCESS_TOKEN", !secret && "WHATSAPP_APP_SECRET", !verify && "WHATSAPP_VERIFY_TOKEN"].filter(Boolean) as string[];
  return { configured: token || fakeTransportEnabled(), webhookReady: (secret && verify) || fakeTransportEnabled(), missing };
}

/** Embedded Signup ("Connect WhatsApp" for customers) needs the app id/secret and a signup configuration. */
export function embeddedSignupStatus() {
  const appId = clean(process.env.WHATSAPP_APP_ID) || clean(process.env.META_APP_ID);
  const configId = clean(process.env.WHATSAPP_EMBEDDED_CONFIG_ID);
  const secret = clean(process.env.WHATSAPP_APP_SECRET);
  return { available: Boolean(appId && configId && secret), appId: appId || null, configId: configId || null, apiVersion: version() };
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

// ── Transport: the real Graph API, or (tests / local E2E only) a recorder that never touches the network ──

export type WaRequest = { method: "GET" | "POST"; path: string; body?: unknown; token: string };
export type WaTransport = { call<T>(r: WaRequest): Promise<T>; download(url: string, token: string): Promise<{ data: Buffer; mime: string }> };

const realTransport: WaTransport = {
  call: <T>(r: WaRequest) =>
    providerFetch<T>(graph(r.path), {
      method: r.method,
      headers: { authorization: `Bearer ${r.token}`, ...(r.body ? { "content-type": "application/json" } : {}) },
      ...(r.body ? { body: JSON.stringify(r.body) } : {}),
    }),
  async download(url, token) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new ProviderError("unavailable", `Media download failed (${res.status})`, res.status);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > 16 * 1024 * 1024) throw new ProviderError("invalid_media", "Media too large", 413);
    return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "application/octet-stream" };
  },
};

/** Recorded outbound calls of the fake transport (inspected by tests). */
export const fakeSent: WaRequest[] = [];

/** Local E2E / tests only: WHATSAPP_FAKE_TRANSPORT=true outside production. Never enabled in production. */
export function fakeTransportEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.WHATSAPP_FAKE_TRANSPORT === "true";
}

const fakeTransport: WaTransport = {
  async call<T>(r: WaRequest) {
    fakeSent.push(r);
    if (fakeSent.length > 500) fakeSent.shift();
    const to = (r.body as { to?: string } | undefined)?.to ?? "";
    if (to.endsWith("0000")) throw new ProviderError("unknown", "Provider request failed (400)", 400, '{"error":{"code":131026,"message":"Message undeliverable"}}');
    if (r.path.endsWith("/messages")) return { messages: [{ id: `wamid.fake.${randomBytes(8).toString("hex")}` }] } as T;
    if (r.path.endsWith("/message_templates") && r.method === "POST") return { id: `fake-tpl-${randomBytes(4).toString("hex")}`, status: "PENDING", category: "MARKETING" } as T;
    if (r.path.endsWith("/message_templates")) return { data: [] } as T;
    if (r.path.endsWith("/subscribed_apps")) return { success: true } as T;
    if (r.path.startsWith("oauth/access_token")) return { access_token: `fake-token-${randomBytes(6).toString("hex")}` } as T;
    if (/^\d+$/.test(r.path.split("?")[0])) return { id: r.path.split("?")[0], display_phone_number: "+966 50 000 1234", verified_name: "Test Business", quality_rating: "GREEN", messaging_limit_tier: "TIER_1K" } as T;
    return {} as T;
  },
  async download() {
    return { data: Buffer.from("fake-media"), mime: "image/jpeg" };
  },
};

let override: WaTransport | null = null;
export function setWaTransport(t: WaTransport | null) {
  override = t;
}
function transport(): WaTransport {
  return override ?? (fakeTransportEnabled() ? fakeTransport : realTransport);
}

/** Meta error code from a ProviderError body (e.g. 131047 re-engagement required, 130429 throughput). */
export function metaErrorCode(err: unknown): number | null {
  if (!(err instanceof ProviderError)) return null;
  const m = String(err.detail ?? "").match(/"code"\s*:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}
/** Throughput / rate / tier limits: back off and retry later, never drop the message. */
export const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);

// ── Phone numbers ──

export type PhoneNumberInfo = { id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string; code_verification_status?: string; messaging_limit_tier?: string };

export async function getPhoneNumber(phoneNumberId: string, token: string) {
  return transport().call<PhoneNumberInfo>({ method: "GET", path: `${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,messaging_limit_tier`, token });
}

// ── Embedded Signup: exchange the returned code for this business's token, then subscribe our app to its WABA ──

export async function exchangeSignupCode(code: string) {
  const s = embeddedSignupStatus();
  const secret = clean(process.env.WHATSAPP_APP_SECRET);
  if (!s.available && !fakeTransportEnabled()) throw new ProviderError("not_supported", "Embedded Signup is not configured");
  const q = new URLSearchParams({ client_id: s.appId ?? "", client_secret: secret, code });
  const r = await transport().call<{ access_token?: string }>({ method: "GET", path: `oauth/access_token?${q}`, token: "" });
  if (!r.access_token) throw new ProviderError("unknown", "No access token returned");
  return r.access_token;
}

export async function subscribeApp(wabaId: string, token: string) {
  await transport().call({ method: "POST", path: `${encodeURIComponent(wabaId)}/subscribed_apps`, token });
}

// ── Sending ──

const sent = (r: { messages?: { id: string }[] }) => ({ externalId: r.messages?.[0]?.id ?? null });

/** Free-form text — Meta only delivers it inside the 24h customer-service window. */
export async function sendText(phoneNumberId: string, to: string, body: string, token: string) {
  return sent(
    await transport().call<{ messages?: { id: string }[] }>({
      method: "POST",
      path: `${encodeURIComponent(phoneNumberId)}/messages`,
      token,
      body: { messaging_product: "whatsapp", recipient_type: "individual", to: normalizePhone(to), type: "text", text: { preview_url: false, body: body.slice(0, 4096) } },
    }),
  );
}

/** Pre-approved template — the only way to message a contact outside the 24h window. */
export async function sendTemplate(phoneNumberId: string, to: string, template: { name: string; language: string; bodyParams?: string[] }, token: string) {
  const components = template.bodyParams?.length ? [{ type: "body", parameters: template.bodyParams.map((text) => ({ type: "text", text })) }] : undefined;
  return sent(
    await transport().call<{ messages?: { id: string }[] }>({
      method: "POST",
      path: `${encodeURIComponent(phoneNumberId)}/messages`,
      token,
      body: { messaging_product: "whatsapp", to: normalizePhone(to), type: "template", template: { name: template.name, language: { code: template.language }, ...(components ? { components } : {}) } },
    }),
  );
}

/** Media by public-safe link (a short-lived signed URL of our storage). Inside the 24h window only. */
export async function sendMedia(phoneNumberId: string, to: string, media: { kind: "image" | "document" | "audio" | "video"; link: string; caption?: string; filename?: string }, token: string) {
  const payload: Record<string, unknown> = { link: media.link };
  if (media.caption && media.kind !== "audio") payload.caption = media.caption.slice(0, 1024);
  if (media.kind === "document" && media.filename) payload.filename = media.filename.slice(0, 200);
  return sent(
    await transport().call<{ messages?: { id: string }[] }>({ method: "POST", path: `${encodeURIComponent(phoneNumberId)}/messages`, token, body: { messaging_product: "whatsapp", to: normalizePhone(to), type: media.kind, [media.kind]: payload } }),
  );
}

// ── Inbound media ──

export async function fetchMedia(mediaId: string, token: string) {
  const info = await transport().call<{ url?: string; mime_type?: string; file_size?: number }>({ method: "GET", path: encodeURIComponent(mediaId), token });
  if (!info.url) throw new ProviderError("invalid_media", "No media url");
  if ((info.file_size ?? 0) > 16 * 1024 * 1024) throw new ProviderError("invalid_media", "Media too large", 413);
  const file = await transport().download(info.url, token);
  return { data: file.data, mime: info.mime_type ?? file.mime };
}

// ── Templates ──

export type MetaTemplate = { id?: string; name: string; language: string; status: string; category: string; rejected_reason?: string; components?: { type: string; text?: string; format?: string; buttons?: { type: string; text: string; url?: string }[] }[] };

/** Templates of the WhatsApp Business Account (needs whatsapp_business_management). */
export async function listTemplates(wabaId: string, token: string): Promise<MetaTemplate[]> {
  const r = await transport().call<{ data?: MetaTemplate[] }>({ method: "GET", path: `${encodeURIComponent(wabaId)}/message_templates?fields=id,name,language,status,category,rejected_reason,components&limit=200`, token });
  return r.data ?? [];
}

export type TemplateSubmission = { name: string; language: string; category: string; header?: string | null; body: string; footer?: string | null; buttons?: { type: "QUICK_REPLY" | "URL"; text: string; url?: string }[]; examples: string[] };

/** Submits a template for Meta review. Explicit owner action only — the result is PENDING until Meta decides. */
export async function createTemplate(wabaId: string, t: TemplateSubmission, token: string) {
  const components: unknown[] = [];
  if (t.header) components.push({ type: "HEADER", format: "TEXT", text: t.header });
  components.push({ type: "BODY", text: t.body, ...(t.examples.length ? { example: { body_text: [t.examples] } } : {}) });
  if (t.footer) components.push({ type: "FOOTER", text: t.footer });
  if (t.buttons?.length) components.push({ type: "BUTTONS", buttons: t.buttons.map((b) => (b.type === "URL" ? { type: "URL", text: b.text, url: b.url } : { type: "QUICK_REPLY", text: b.text })) });
  return transport().call<{ id: string; status: string; category: string }>({ method: "POST", path: `${encodeURIComponent(wabaId)}/message_templates`, token, body: { name: t.name, language: t.language, category: t.category, components } });
}

/** E.164 digits only (Cloud API accepts "+" too, but digits keep matching consistent). */
export function normalizePhone(p: string) {
  return p.replace(/[^\d]/g, "");
}

/** Plausible international number (8–15 digits, no leading 0 after normalization). */
export function validPhone(digits: string | null | undefined) {
  return Boolean(digits && /^[1-9]\d{7,14}$/.test(digits));
}

// ── Webhook payload (subset we use) ──
export type WaMedia = { id: string; mime: string | null; caption: string | null; filename: string | null };
export type WaInbound = { phoneNumberId: string; from: string; profileName: string | null; id: string; timestamp: Date; type: string; text: string | null; media: WaMedia | null };
export type WaStatus = { phoneNumberId: string; id: string; status: string; recipient: string; timestamp: Date; error: string | null };

type MediaPayload = { id: string; mime_type?: string; caption?: string; filename?: string };
type WebhookBody = {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: ({ from: string; id: string; timestamp: string; type: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } } & Partial<Record<"image" | "document" | "audio" | "video" | "sticker", MediaPayload>>)[];
        statuses?: { id: string; status: string; recipient_id: string; timestamp: string; errors?: { code?: number; title?: string }[] }[];
      };
    }[];
  }[];
};

const MEDIA_TYPES = ["image", "document", "audio", "video", "sticker"] as const;

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
        const kind = MEDIA_TYPES.find((k) => m.type === k && m[k]?.id);
        const media = kind ? { id: m[kind]!.id, mime: m[kind]!.mime_type ?? null, caption: m[kind]!.caption ?? null, filename: m[kind]!.filename ?? null } : null;
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? media?.caption ?? null;
        messages.push({ phoneNumberId, from: m.from, profileName: contact?.profile?.name ?? null, id: m.id, timestamp: new Date(Number(m.timestamp) * 1000), type: m.type, text, media });
      }
      for (const s of v.statuses ?? [])
        statuses.push({ phoneNumberId, id: s.id, status: s.status, recipient: s.recipient_id, timestamp: new Date(Number(s.timestamp) * 1000), error: s.errors?.[0] ? `${s.errors[0].code ?? ""} ${s.errors[0].title ?? ""}`.trim() : null });
    }
  return { messages, statuses };
}

/** What the client-side connect button needs (public ids only — never secrets or tokens). */
export function signupConfig() {
  const s = embeddedSignupStatus();
  return { available: s.available, appId: s.available ? s.appId : null, configId: s.available ? s.configId : null, apiVersion: s.apiVersion, testMode: fakeTransportEnabled() };
}
