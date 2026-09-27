import { db } from "../db/client";
import { audit } from "../audit";
import { logger } from "../logger";
import { getMailer } from "../email/mailer";
import { storage, supportsPresign } from "../storage";
import { whatsappStatus } from "../whatsapp/cloud-api";
import type { Provider } from "@/generated/prisma/enums";

/**
 * Provider readiness for the platform admin (/admin/providers). Every "valid" / "live tested" claim is backed
 * by a ProviderValidation row written by a real call — nothing is assumed from configuration alone.
 * Secrets never appear in results: details are provider error codes/messages with tokens redacted.
 */
export const READINESS_PROVIDERS = ["openai", "linkedin", "instagram", "facebook", "tiktok", "google", "microsoft", "whatsapp", "email", "storage", "stripe"] as const;
export type ReadinessProvider = (typeof READINESS_PROVIDERS)[number];

type Static = {
  env: string[];
  integration: Provider[] | null;
  capabilities: string[];
  /** External approvals the platform still depends on (shown until a live test proves otherwise). */
  pendingApproval: string[];
  /** Checks that count as "live tested" — a real call that exercised the product feature. */
  liveChecks: string[];
};

const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "") ?? "";
const has = (...keys: string[]) => keys.every((k) => clean(process.env[k]));

export const PROVIDER_INFO: Record<ReadinessProvider, Static> = {
  openai: { env: ["OPENAI_API_KEY"], integration: null, capabilities: ["text", "image", "image_edit"], pendingApproval: [], liveChecks: ["generate_text", "generate_image", "edit_image"] },
  linkedin: { env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"], integration: ["LINKEDIN"], capabilities: ["profile", "member_publishing", "organization_publishing"], pendingApproval: ["LinkedIn Community Management API (Company Page posting + stats)"], liveChecks: ["publish_test_post"] },
  instagram: { env: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"], integration: ["INSTAGRAM"], capabilities: ["profile", "publishing", "insights", "comments", "messages"], pendingApproval: ["Meta App Review: instagram_business_content_publish / manage_insights / manage_comments / manage_messages (Advanced Access)"], liveChecks: ["connection", "publish_test_post", "insights", "comments", "messages"] },
  facebook: { env: ["META_APP_ID", "META_APP_SECRET"], integration: ["FACEBOOK"], capabilities: ["identity", "pages", "page_publishing", "page_insights"], pendingApproval: ["Meta: enable the Page-management use case (pages_show_list, pages_manage_posts, pages_read_engagement) + App Review"], liveChecks: ["connection", "publish_test_post"] },
  tiktok: { env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], integration: ["TIKTOK"], capabilities: ["profile", "video_publishing", "video_metrics"], pendingApproval: ["TikTok Content Posting API audit (until then posts are private-only)"], liveChecks: ["connection"] },
  google: { env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], integration: ["GOOGLE"], capabilities: ["identity", "email_send", "calendar"], pendingApproval: ["Google OAuth verification for gmail.send / calendar scopes (sensitive scopes; unverified apps are limited to test users)"], liveChecks: ["connection", "send_email", "calendar"] },
  microsoft: { env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"], integration: ["MICROSOFT"], capabilities: ["identity", "email_send", "calendar"], pendingApproval: ["Microsoft publisher verification (recommended for multi-tenant apps)"], liveChecks: ["connection", "send_email", "calendar"] },
  whatsapp: { env: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"], integration: null, capabilities: ["inbound", "outbound_24h", "templates", "status_webhooks"], pendingApproval: ["Meta Business verification + WhatsApp display name approval", "Message templates approved by Meta"], liveChecks: ["send_message", "webhook_received"] },
  email: { env: [], integration: null, capabilities: ["send", "templates"], pendingApproval: [], liveChecks: ["send_test_email"] },
  storage: { env: [], integration: null, capabilities: ["upload", "signed_url", "delete"], pendingApproval: [], liveChecks: ["roundtrip"] },
  stripe: { env: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], integration: null, capabilities: ["checkout", "portal", "subscription_sync", "invoices"], pendingApproval: [], liveChecks: ["checkout_session"] },
};

export function isConfigured(p: ReadinessProvider) {
  if (p === "email") return getMailer().configured;
  if (p === "storage") return storage.name !== "local" || process.env.NODE_ENV !== "production";
  if (p === "whatsapp") return whatsappStatus().configured;
  return has(...PROVIDER_INFO[p].env);
}

export type ReadinessRow = {
  provider: ReadinessProvider;
  configured: boolean;
  credentialsValid: boolean | null;
  liveAccounts: number | null;
  lastSuccessAt: string | null;
  lastError: { at: string; check: string; detail: string | null } | null;
  capabilities: string[];
  pendingApproval: string[];
  liveTested: boolean;
  liveTestedChecks: string[];
  note: string | null;
};

export async function providerReadiness(): Promise<ReadinessRow[]> {
  const rows = await db.providerValidation.findMany({ orderBy: { createdAt: "desc" }, take: 1000 });
  const counts = await db.integration.groupBy({ by: ["provider"], where: { status: "CONNECTED" }, _count: true });
  const waNumbers = await db.whatsAppNumber.count({ where: { isActive: true } });
  return READINESS_PROVIDERS.map((p) => {
    const info = PROVIDER_INFO[p];
    const mine = rows.filter((r) => r.provider === p);
    const cred = mine.find((r) => r.check === "credentials");
    const lastOk = mine.find((r) => r.ok && r.live);
    const lastFail = mine.find((r) => !r.ok);
    const liveTestedChecks = [...new Set(mine.filter((r) => r.ok && r.live && info.liveChecks.includes(r.check)).map((r) => r.check))];
    const liveAccounts = info.integration ? counts.filter((c) => info.integration!.includes(c.provider)).reduce((a, c) => a + c._count, 0) : p === "whatsapp" ? waNumbers : null;
    return {
      provider: p,
      configured: isConfigured(p),
      credentialsValid: cred ? cred.ok : null,
      liveAccounts,
      lastSuccessAt: lastOk?.createdAt.toISOString() ?? null,
      lastError: lastFail && (!lastOk || lastFail.createdAt > lastOk.createdAt) ? { at: lastFail.createdAt.toISOString(), check: lastFail.check, detail: lastFail.detail } : null,
      capabilities: info.capabilities,
      pendingApproval: info.pendingApproval,
      liveTested: liveTestedChecks.length > 0,
      liveTestedChecks,
      note: p === "stripe" ? "stripe_adapter" : p === "storage" && storage.name === "local" ? "local_storage" : null,
    };
  });
}

export async function recordValidation(v: { provider: string; check: string; ok: boolean; live?: boolean; detail?: string | null; costMicro?: bigint; organizationId?: string | null; actorId?: string | null }) {
  return db.providerValidation.create({
    data: { provider: v.provider, check: v.check, ok: v.ok, live: v.live ?? true, detail: redact(v.detail ?? null), costMicro: v.costMicro ?? BigInt(0), organizationId: v.organizationId ?? null, actorId: v.actorId ?? null },
  });
}

function redact(s: string | null) {
  if (!s) return null;
  return s
    .replace(/(access_token|client_secret|refresh_token|token|key)=([^&\s"]+)/gi, "$1=[redacted]")
    .replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, "$1_$2_[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/\bEAA[A-Za-z0-9]{20,}/g, "EAA[redacted]")
    .slice(0, 500);
}

type Check = { ok: boolean; detail: string };
async function call(url: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}
const form = (d: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(d) });
const err = (b: Record<string, unknown>) => {
  const e = b.error as { message?: string; code?: string | number; type?: string } | string | undefined;
  if (typeof e === "string") return `${e}${b.error_description ? `: ${String(b.error_description).split("\n")[0]}` : ""}`;
  return e?.message ?? JSON.stringify(b).slice(0, 200);
};

/**
 * Credential checks that prove the client id/secret (or key) are accepted by the provider without
 * connecting a customer account, publishing, or spending money.
 */
const CHECKS: Partial<Record<ReadinessProvider, () => Promise<Check>>> = {
  async openai() {
    const key = clean(process.env.OPENAI_API_KEY);
    const models = [process.env.OPENAI_TEXT_MODEL || "gpt-5.1", process.env.OPENAI_IMAGE_MODEL_FAST, process.env.OPENAI_IMAGE_MODEL_QUALITY].map((m) => clean(m)).filter(Boolean);
    const missing: string[] = [];
    for (const m of [...new Set(models)]) {
      const r = await call(`https://api.openai.com/v1/models/${encodeURIComponent(m)}`, { headers: { authorization: `Bearer ${key}` } });
      if (r.status === 401) return { ok: false, detail: `invalid_api_key: ${err(r.body)}` };
      if (r.status !== 200) missing.push(`${m} (${r.status})`);
    }
    return missing.length ? { ok: false, detail: `Model not available to this key: ${missing.join(", ")}` } : { ok: true, detail: `Key valid; models available: ${[...new Set(models)].join(", ")}` };
  },
  async facebook() {
    const v = clean(process.env.META_GRAPH_VERSION) || "v21.0";
    const r = await call(`https://graph.facebook.com/${v}/oauth/access_token?${new URLSearchParams({ client_id: clean(process.env.META_APP_ID), client_secret: clean(process.env.META_APP_SECRET), grant_type: "client_credentials" })}`);
    if (r.status !== 200 || !r.body.access_token) return { ok: false, detail: err(r.body) };
    const app = await call(`https://graph.facebook.com/${v}/${clean(process.env.META_APP_ID)}?fields=name`, { headers: { authorization: `Bearer ${String(r.body.access_token)}` } });
    return { ok: true, detail: `App token issued${app.body.name ? ` for "${String(app.body.name)}"` : ""}` };
  },
  async instagram() {
    // Instagram Login has no app-token grant: an invalid code with valid client credentials fails with a code
    // error (not a client error). This proves the id/secret pair without any user involvement.
    const r = await call("https://api.instagram.com/oauth/access_token", form({ client_id: clean(process.env.INSTAGRAM_APP_ID), client_secret: clean(process.env.INSTAGRAM_APP_SECRET), grant_type: "authorization_code", redirect_uri: `${process.env.APP_URL ?? "http://localhost:3000"}/api/integrations/instagram/callback`, code: "nova-credential-check" }));
    const m = err(r.body);
    if (/invalid (platform )?app|client_id|client secret|app secret|Invalid Client/i.test(m)) return { ok: false, detail: m };
    return { ok: true, detail: `Client accepted (expected code error: ${m.slice(0, 120)})` };
  },
  async linkedin() {
    const r = await call("https://www.linkedin.com/oauth/v2/accessToken", form({ grant_type: "client_credentials", client_id: clean(process.env.LINKEDIN_CLIENT_ID), client_secret: clean(process.env.LINKEDIN_CLIENT_SECRET) }));
    if (r.status === 200 && r.body.access_token) return { ok: true, detail: "Client credentials token issued" };
    const m = err(r.body);
    // Most apps aren't allowed the 2-legged flow; LinkedIn still authenticates the client first.
    if (/invalid_client|client authentication failed/i.test(m)) return { ok: false, detail: m };
    return { ok: true, detail: `Client authenticated (2-legged flow not enabled: ${m.slice(0, 120)})` };
  },
  async tiktok() {
    const r = await call("https://open.tiktokapis.com/v2/oauth/token/", form({ client_key: clean(process.env.TIKTOK_CLIENT_KEY), client_secret: clean(process.env.TIKTOK_CLIENT_SECRET), grant_type: "client_credentials" }));
    if (r.status === 200 && r.body.access_token) return { ok: true, detail: "Client credentials token issued" };
    return { ok: false, detail: err(r.body) };
  },
  async google() {
    const r = await call("https://oauth2.googleapis.com/token", form({ client_id: clean(process.env.GOOGLE_CLIENT_ID), client_secret: clean(process.env.GOOGLE_CLIENT_SECRET), grant_type: "authorization_code", code: "nova-credential-check", redirect_uri: `${process.env.APP_URL ?? "http://localhost:3000"}/api/integrations/google/callback` }));
    const e = String(r.body.error ?? "");
    if (e === "invalid_grant") return { ok: true, detail: "Client accepted (expected invalid_grant for a test code)" };
    return { ok: false, detail: err(r.body) };
  },
  async microsoft() {
    const tenant = clean(process.env.MICROSOFT_TENANT_ID) || "common";
    const r = await call(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, form({ client_id: clean(process.env.MICROSOFT_CLIENT_ID), client_secret: clean(process.env.MICROSOFT_CLIENT_SECRET), grant_type: "authorization_code", code: "nova-credential-check", scope: "openid", redirect_uri: `${process.env.APP_URL ?? "http://localhost:3000"}/api/integrations/microsoft/callback` }));
    const codes = (r.body.error_codes as number[] | undefined) ?? [];
    // 7000215/7000222 = bad or expired secret, 700016 = unknown app, 90002 = unknown tenant.
    if (codes.some((c) => [7000215, 7000222, 700016, 90002, 900023].includes(c))) return { ok: false, detail: err(r.body) };
    if (String(r.body.error) === "invalid_grant") return { ok: true, detail: "Client accepted (expected invalid_grant for a test code)" };
    return { ok: false, detail: err(r.body) };
  },
  async whatsapp() {
    const v = clean(process.env.WHATSAPP_API_VERSION) || "v21.0";
    const r = await call(`https://graph.facebook.com/${v}/me?fields=id,name`, { headers: { authorization: `Bearer ${clean(process.env.WHATSAPP_ACCESS_TOKEN)}` } });
    if (r.status !== 200) return { ok: false, detail: err(r.body) };
    return { ok: true, detail: `Token valid (${String(r.body.name ?? r.body.id)})` };
  },
  async email() {
    const t = await getMailer().testConnection();
    return { ok: t.ok, detail: t.detail };
  },
  async stripe() {
    const r = await call("https://api.stripe.com/v1/balance", { headers: { authorization: `Bearer ${clean(process.env.STRIPE_SECRET_KEY)}` } });
    if (r.status !== 200) return { ok: false, detail: err(r.body) };
    return { ok: true, detail: `Key valid (${clean(process.env.STRIPE_SECRET_KEY).startsWith("sk_live_") ? "live" : "test"} mode)` };
  },
};

/** Admin button: validate one provider's credentials against the real API and record the result. */
export async function validateCredentials(provider: ReadinessProvider, actor: { userId: string; organizationId?: string | null }) {
  const check = CHECKS[provider];
  if (!check) throw new Error("no credential check for this provider");
  if (!isConfigured(provider)) {
    return recordValidation({ provider, check: "credentials", ok: false, live: false, detail: `Not configured (${PROVIDER_INFO[provider].env.filter((k) => !clean(process.env[k])).join(", ") || "provider settings"})`, actorId: actor.userId, organizationId: actor.organizationId });
  }
  let result: Check;
  try {
    result = await check();
  } catch (e) {
    result = { ok: false, detail: `Network error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!result.ok) logger.warn({ provider, detail: redact(result.detail) }, "provider credential check failed");
  const row = await recordValidation({ provider, check: "credentials", ok: result.ok, detail: result.detail, actorId: actor.userId, organizationId: actor.organizationId });
  await audit({ category: "SECURITY", actorType: "USER", actorId: actor.userId, action: "admin.provider_validated", summary: `Validated ${provider} credentials: ${result.ok ? "ok" : "failed"}` });
  return row;
}

/**
 * Admin storage test: upload → signed URL → download → delete, on a dedicated test prefix. Uses whatever
 * driver is configured (local / S3 / R2); automated tests use an in-memory driver instead.
 */
export async function storageRoundtrip(actor: { userId: string }) {
  const key = `_nova-admin-test/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const body = Buffer.from(`NOVA storage test ${new Date().toISOString()}`);
  const steps: { step: string; ok: boolean; detail?: string }[] = [];
  let ok = true;
  try {
    await storage.put(key, body, "text/plain");
    steps.push({ step: "upload", ok: true });
    if (supportsPresign()) {
      const url = storage.presignGet!(key, 60, { contentType: "text/plain" });
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const same = r.ok && Buffer.from(await r.arrayBuffer()).equals(body);
      steps.push({ step: "signed_url", ok: same, detail: same ? undefined : `HTTP ${r.status}` });
      ok &&= same;
    } else {
      const got = await storage.get(key);
      const same = got.equals(body);
      steps.push({ step: "read (local driver: signed app URLs)", ok: same });
      ok &&= same;
    }
  } catch (e) {
    ok = false;
    steps.push({ step: "upload", ok: false, detail: e instanceof Error ? e.message : String(e) });
  } finally {
    try {
      await storage.delete(key);
      steps.push({ step: "delete", ok: true });
    } catch (e) {
      ok = false;
      steps.push({ step: "delete", ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  const detail = `${storage.name}: ${steps.map((s) => `${s.step}=${s.ok ? "ok" : `fail${s.detail ? ` (${s.detail})` : ""}`}`).join(", ")}`;
  // Local disk is not a production storage test: record it, but not as "live".
  await recordValidation({ provider: "storage", check: "roundtrip", ok, live: storage.name !== "local", detail, actorId: actor.userId });
  return { ok, driver: storage.name, steps };
}
