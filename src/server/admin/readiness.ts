import { db } from "../db/client";
import { redact } from "../security/redact";
import { audit } from "../audit";
import { logger } from "../logger";
import { getMailer } from "../email/mailer";
import { storage, supportsPresign } from "../storage";
import { whatsappStatus } from "../whatsapp/cloud-api";
import { callbackMatrix, type CallbackEntry } from "../integrations/registry";
import { metaCredentialProblem } from "../integrations/providers/meta";
import { instagramCredentialProblem } from "../integrations/providers/instagram";
import type { Provider } from "@/generated/prisma/enums";
import { appEnvironment } from "../env";

/**
 * Provider readiness for the platform admin (/admin/providers). Every "valid" / "live tested" claim is backed
 * by a ProviderValidation row written by a real call — nothing is assumed from configuration alone.
 * Secrets never appear in results: details are provider error codes/messages with tokens redacted.
 */
export const READINESS_PROVIDERS = ["openai", "anthropic", "linkedin", "instagram", "facebook", "tiktok", "google", "microsoft", "whatsapp", "email", "storage", "stripe"] as const;
export type ReadinessProvider = (typeof READINESS_PROVIDERS)[number];

type Static = {
  env: string[];
  integration: Provider[] | null;
  capabilities: string[];
  /** External approvals the platform still depends on (shown until a live test proves otherwise). */
  pendingApproval: string[];
  /** Checks that count as "live tested" — a real call that exercised the product feature. */
  liveChecks: string[];
  /** Callback/webhook matrix entries this provider depends on. */
  callbacks: string[];
};

const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "") ?? "";
const has = (...keys: string[]) => keys.every((k) => clean(process.env[k]));

export const PROVIDER_INFO: Record<ReadinessProvider, Static> = {
  openai: { env: ["OPENAI_API_KEY"], integration: null, capabilities: ["text", "image", "image_edit"], pendingApproval: [], liveChecks: ["generate_text", "generate_image", "edit_image"], callbacks: [] },
  anthropic: { env: ["ANTHROPIC_API_KEY"], integration: null, capabilities: ["text", "structured_output", "vision"], pendingApproval: [], liveChecks: ["generate_text"], callbacks: [] },
  linkedin: { env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"], integration: ["LINKEDIN"], capabilities: ["profile", "member_publishing", "organization_publishing"], pendingApproval: ["LinkedIn Community Management API (Company Page posting + stats)"], liveChecks: ["publish_test_post"], callbacks: ["linkedin"] },
  instagram: { env: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"], integration: ["INSTAGRAM"], capabilities: ["profile", "publishing", "insights", "comments", "messages"], pendingApproval: ["Meta App Review: instagram_business_content_publish / manage_insights / manage_comments / manage_messages (Advanced Access)"], liveChecks: ["connection", "publish_test_post", "insights", "comments", "messages"], callbacks: ["instagram"] },
  facebook: { env: ["META_APP_ID", "META_APP_SECRET"], integration: ["FACEBOOK"], capabilities: ["identity", "pages", "page_publishing", "page_insights"], pendingApproval: ["Meta: enable the Page-management use case (pages_show_list, pages_manage_posts, pages_read_engagement) + App Review"], // Identity-only logins do not count: live = a manageable Page reached, or a published test post.
    liveChecks: ["pages_connection", "publish_test_post"], callbacks: ["meta"] },
  tiktok: { env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], integration: ["TIKTOK"], capabilities: ["profile", "video_publishing", "video_metrics"], pendingApproval: ["TikTok Content Posting API audit (until then posts are private-only)"], liveChecks: ["connection"], callbacks: ["tiktok"] },
  google: { env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], integration: ["GOOGLE"], capabilities: ["identity", "email_send", "calendar_read", "calendar_write"], pendingApproval: ["Google OAuth verification for gmail.send / calendar scopes (sensitive scopes; unverified apps are limited to test users)"], liveChecks: ["connection", "send_email", "calendar_availability", "calendar_meeting"], callbacks: ["google", "google_sign_in"] },
  microsoft: { env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"], integration: ["MICROSOFT"], capabilities: ["identity", "email_send", "calendar_read", "calendar_write"], pendingApproval: ["Microsoft publisher verification (recommended for multi-tenant apps)"], liveChecks: ["connection", "send_email", "calendar_availability", "calendar_meeting"], callbacks: ["microsoft"] },
  whatsapp: { env: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"], integration: null, capabilities: ["inbound", "outbound_24h", "templates", "status_webhooks"], pendingApproval: ["Meta Business verification + WhatsApp display name approval", "Message templates approved by Meta"], liveChecks: ["connection_test", "send_test"], callbacks: ["whatsapp"] },
  email: { env: [], integration: null, capabilities: ["send", "templates"], pendingApproval: [], liveChecks: ["send_test_email"], callbacks: ["magic_link"] },
  storage: { env: [], integration: null, capabilities: ["upload", "signed_url", "delete"], pendingApproval: [], liveChecks: ["roundtrip"], callbacks: [] },
  stripe: { env: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], integration: null, capabilities: ["checkout", "portal", "subscription_sync", "invoices"], pendingApproval: [], liveChecks: ["checkout_session", "webhook_received"], callbacks: ["stripe"] },
};

export { appEnvironment };

export function isConfigured(p: ReadinessProvider) {
  if (p === "email") return getMailer().configured;
  if (p === "storage") return storage.name !== "local" || appEnvironment() === "development";
  if (p === "whatsapp") return whatsappStatus().configured;
  return has(...PROVIDER_INFO[p].env);
}

// ── Credential format (static, no network) ──

const HEX32 = /^[0-9a-f]{32}$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Problems in the *shape* of configured values (e.g. a token pasted where a secret belongs). null = nothing configured. */
export function credentialFormat(p: ReadinessProvider, env: NodeJS.ProcessEnv = process.env): string[] | null {
  const v = (k: string) => clean(env[k]);
  const problems: string[] = [];
  const need = (k: string, re: RegExp, msg: string) => {
    if (v(k) && !re.test(v(k))) problems.push(`${k}: ${msg}`);
  };
  switch (p) {
    case "openai":
      if (!v("OPENAI_API_KEY")) return null;
      need("OPENAI_API_KEY", /^sk-[A-Za-z0-9_-]{20,}$/, "expected an sk-… API key");
      break;
    case "anthropic":
      if (!v("ANTHROPIC_API_KEY")) return null;
      need("ANTHROPIC_API_KEY", /^sk-ant-[A-Za-z0-9_-]{20,}$/, "expected an sk-ant-… API key");
      break;
    case "linkedin":
      if (!v("LINKEDIN_CLIENT_ID")) return null;
      need("LINKEDIN_CLIENT_ID", /^[A-Za-z0-9]{8,20}$/, "expected the app's Client ID");
      if (!v("LINKEDIN_CLIENT_SECRET")) problems.push("LINKEDIN_CLIENT_SECRET: missing");
      break;
    case "facebook": {
      if (!v("META_APP_ID")) return null;
      const m = metaCredentialProblem(env);
      if (m && m !== "missing") problems.push(`META: ${m}`);
      break;
    }
    case "instagram": {
      if (!v("INSTAGRAM_APP_ID")) return null;
      const m = instagramCredentialProblem(env);
      if (m && m !== "missing") problems.push(`INSTAGRAM: ${m}`);
      break;
    }
    case "tiktok":
      if (!v("TIKTOK_CLIENT_KEY")) return null;
      need("TIKTOK_CLIENT_KEY", /^[A-Za-z0-9]{10,40}$/, "expected the Client key");
      break;
    case "google":
      if (!v("GOOGLE_CLIENT_ID")) return null;
      need("GOOGLE_CLIENT_ID", /^[0-9]+-[A-Za-z0-9_]+\.apps\.googleusercontent\.com$/, "expected …apps.googleusercontent.com");
      if (!v("GOOGLE_CLIENT_SECRET")) problems.push("GOOGLE_CLIENT_SECRET: missing");
      break;
    case "microsoft":
      if (!v("MICROSOFT_CLIENT_ID")) return null;
      need("MICROSOFT_CLIENT_ID", GUID, "expected the Application (client) ID GUID");
      if (v("MICROSOFT_TENANT_ID") && !/^(common|organizations|consumers)$/i.test(v("MICROSOFT_TENANT_ID")) && !GUID.test(v("MICROSOFT_TENANT_ID")) && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v("MICROSOFT_TENANT_ID"))) {
        problems.push("MICROSOFT_TENANT_ID: expected common/organizations/consumers, a tenant GUID or domain");
      }
      if (GUID.test(v("MICROSOFT_CLIENT_SECRET"))) problems.push("MICROSOFT_CLIENT_SECRET: looks like a secret ID, not the secret value");
      break;
    case "whatsapp":
      if (!v("WHATSAPP_ACCESS_TOKEN")) return null;
      need("WHATSAPP_ACCESS_TOKEN", /^EAA[A-Za-z0-9]{20,}$/, "expected a system-user access token (EAA…)");
      need("WHATSAPP_APP_SECRET", HEX32, "expected the 32-character app secret");
      need("WHATSAPP_PHONE_NUMBER_ID", /^\d{8,25}$/, "expected a numeric phone_number_id");
      need("WHATSAPP_BUSINESS_ACCOUNT_ID", /^\d{8,25}$/, "expected a numeric WhatsApp Business Account id");
      if (v("WHATSAPP_VERIFY_TOKEN") && v("WHATSAPP_VERIFY_TOKEN").length < 12) problems.push("WHATSAPP_VERIFY_TOKEN: use at least 12 random characters");
      break;
    case "email": {
      const kind = (v("EMAIL_PROVIDER") || (v("SMTP_HOST") ? "smtp" : v("RESEND_API_KEY") ? "resend" : v("POSTMARK_SERVER_TOKEN") ? "postmark" : "")).toLowerCase();
      if (!kind) return null;
      if (!["smtp", "resend", "postmark", "ses"].includes(kind)) problems.push(`EMAIL_PROVIDER: unknown "${kind}"`);
      if (kind === "resend") need("RESEND_API_KEY", /^re_[A-Za-z0-9_]{10,}$/, "expected re_…");
      if (kind === "postmark") need("POSTMARK_SERVER_TOKEN", GUID, "expected a server token GUID");
      if (kind === "smtp" && /^(localhost|127\.0\.0\.1|mailpit)$/i.test(v("SMTP_HOST"))) problems.push("SMTP_HOST: development mailbox (Mailpit) — not a real provider");
      if (v("EMAIL_FROM") && !/@[^\s>]+\.[^\s>]+/.test(v("EMAIL_FROM"))) problems.push("EMAIL_FROM: no sender address");
      break;
    }
    case "storage":
      if ((v("STORAGE_DRIVER") || "local") === "local") return appEnvironment(env) === "development" ? [] : ["STORAGE_DRIVER: local disk isn't production storage"];
      need("S3_BUCKET", /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "invalid bucket name");
      if (!v("S3_ACCESS_KEY_ID") || !v("S3_SECRET_ACCESS_KEY")) problems.push("S3 keys: missing");
      break;
    case "stripe": {
      if (!v("STRIPE_SECRET_KEY")) return null;
      need("STRIPE_SECRET_KEY", /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/, "expected sk_test_… or sk_live_…");
      need("STRIPE_WEBHOOK_SECRET", /^whsec_[A-Za-z0-9]{10,}$/, "expected whsec_…");
      need("STRIPE_PUBLISHABLE_KEY", /^pk_(test|live)_[A-Za-z0-9]{10,}$/, "expected pk_test_… or pk_live_…");
      for (const k of ["STRIPE_PRICE_STARTER", "STRIPE_PRICE_GROWTH", "STRIPE_PRICE_SCALE"]) need(k, /^price_[A-Za-z0-9]{8,}$/, "expected price_…");
      const skMode = v("STRIPE_SECRET_KEY").split("_")[1];
      const pkMode = v("STRIPE_PUBLISHABLE_KEY").split("_")[1];
      if (pkMode && skMode && pkMode !== skMode) problems.push("STRIPE keys: secret and publishable keys are from different modes");
      break;
    }
  }
  return problems;
}

// ── Callbacks (per environment) ──

export type CallbackStatus = { entries: CallbackEntry[]; ok: boolean; blockers: string[] };

/** Development tolerates localhost/http; staging and production require public HTTPS. */
export function callbackStatus(p: ReadinessProvider, env: NodeJS.ProcessEnv = process.env): CallbackStatus {
  const names = PROVIDER_INFO[p].callbacks;
  const entries = callbackMatrix(env.APP_URL, env).filter((e) => names.includes(e.name));
  const dev = appEnvironment(env) === "development";
  const blockers = entries.filter((e) => e.problem && !(dev && e.problem === "localhost")).map((e) => `${e.name}: ${e.problem}`);
  return { entries, ok: entries.every((e) => !e.problem), blockers };
}

/** Everything that stops a provider from being production-ready (codes → i18n on the admin page). */
export function productionBlockers(p: ReadinessProvider, r: { configured: boolean; formatProblems: string[] | null; liveTested: boolean; callbacksOk: boolean }, env: NodeJS.ProcessEnv = process.env) {
  const b: string[] = [];
  if (!r.configured) b.push("missing_credentials");
  if (r.formatProblems?.length) b.push("invalid_credential_format");
  if (r.configured && !r.liveTested) b.push("not_live_validated");
  if (PROVIDER_INFO[p].pendingApproval.length) b.push("external_review");
  if (PROVIDER_INFO[p].callbacks.length && !r.callbacksOk) b.push("https_callbacks");
  if (p === "stripe" && /^(sk|rk)_test_/.test(clean(env.STRIPE_SECRET_KEY))) b.push("stripe_test_mode");
  if (p === "storage" && (clean(env.STORAGE_DRIVER) || "local") === "local") b.push("local_storage");
  if (p === "email" && /^(localhost|127\.0\.0\.1|mailpit)$/i.test(clean(env.SMTP_HOST)) && !clean(env.RESEND_API_KEY) && !clean(env.POSTMARK_SERVER_TOKEN)) b.push("dev_mailbox");
  return b;
}

/**
 * One honest status per provider, derived only from configuration + recorded validations:
 * - BLOCKED: missing/invalid credentials, a failed credential check, or the latest result is an error.
 * - WAITING_EXTERNAL_APPROVAL: works as far as we can test, but depends on a provider review/approval.
 * - READY: live-validated with no production blocker left.
 * - READY_FOR_CLOSED_BETA: live-validated; the only thing left is a deliberate test-mode setting
 *   (Stripe test keys) that stays until an explicit go-live decision.
 * - READY_FOR_STAGING: configured and valid, but not yet live-validated or still on test/dev settings
 *   (test keys, local disk, development mailbox, non-HTTPS callbacks).
 */
export const READINESS_STATUSES = ["READY", "READY_FOR_CLOSED_BETA", "READY_FOR_STAGING", "WAITING_EXTERNAL_APPROVAL", "BLOCKED"] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

const TEST_MODE_ONLY = new Set(["stripe_test_mode"]);
/** Failures that mean "the provider hasn't granted this yet" (review/permission), not "broken". */
export const PENDING_APPROVAL_ERRORS = new Set(["pages_permission_pending"]);

export function readinessStatus(r: { configured: boolean; formatProblems: string[]; credentialsValid: boolean | null; lastError: { errorCode: string | null } | null; blockers: string[]; liveTested: boolean }): ReadinessStatus {
  if (!r.configured || r.formatProblems.length || r.credentialsValid === false) return "BLOCKED";
  if (r.lastError) return r.lastError.errorCode && PENDING_APPROVAL_ERRORS.has(r.lastError.errorCode) && r.blockers.includes("external_review") ? "WAITING_EXTERNAL_APPROVAL" : "BLOCKED";
  if (r.blockers.includes("external_review")) return "WAITING_EXTERNAL_APPROVAL";
  if (r.blockers.length === 0) return "READY";
  if (r.liveTested && r.blockers.every((b) => TEST_MODE_ONLY.has(b))) return "READY_FOR_CLOSED_BETA";
  return "READY_FOR_STAGING";
}

export type ReadinessRow = {
  provider: ReadinessProvider;
  status: ReadinessStatus;
  configured: boolean;
  formatValid: boolean | null;
  formatProblems: string[];
  credentialsValid: boolean | null;
  liveAccounts: number | null;
  lastValidationAt: string | null;
  lastSuccessAt: string | null;
  lastError: { at: string; check: string; detail: string | null; httpStatus: number | null; errorCode: string | null; correlationId: string } | null;
  capabilities: string[];
  pendingApproval: string[];
  callbacks: CallbackStatus;
  liveTested: boolean;
  liveTestedChecks: string[];
  blockers: string[];
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
    const format = credentialFormat(p);
    const callbacks = callbackStatus(p);
    const configured = isConfigured(p);
    const liveTested = liveTestedChecks.length > 0;
    const credentialsValid = cred ? (cred.live ? cred.ok : cred.ok ? null : false) : null;
    const lastError =
      lastFail && (!lastOk || lastFail.createdAt > lastOk.createdAt)
        ? { at: lastFail.createdAt.toISOString(), check: lastFail.check, detail: lastFail.detail, httpStatus: lastFail.httpStatus, errorCode: lastFail.errorCode, correlationId: lastFail.id }
        : null;
    const blockers = productionBlockers(p, { configured, formatProblems: format, liveTested, callbacksOk: callbacks.ok });
    return {
      provider: p,
      status: readinessStatus({ configured, formatProblems: format ?? [], credentialsValid, lastError, blockers, liveTested }),
      configured,
      formatValid: format === null ? null : format.length === 0,
      formatProblems: format ?? [],
      credentialsValid,
      liveAccounts,
      lastValidationAt: mine[0]?.createdAt.toISOString() ?? null,
      lastSuccessAt: lastOk?.createdAt.toISOString() ?? null,
      lastError,
      capabilities: info.capabilities,
      pendingApproval: info.pendingApproval,
      callbacks,
      liveTested,
      liveTestedChecks,
      blockers,
      note: p === "stripe" ? "stripe_adapter" : p === "storage" && storage.name === "local" ? "local_storage" : null,
    };
  });
}

type ValidationInput = { provider: string; check: string; ok: boolean; live?: boolean; detail?: string | null; httpStatus?: number | null; errorCode?: string | null; durationMs?: number | null; meta?: Record<string, unknown>; costMicro?: bigint; organizationId?: string | null; actorId?: string | null };

export async function recordValidation(v: ValidationInput) {
  return db.providerValidation.create({
    data: {
      provider: v.provider,
      check: v.check,
      ok: v.ok,
      live: v.live ?? true,
      detail: redact(v.detail ?? null),
      httpStatus: v.httpStatus ?? null,
      errorCode: v.errorCode ? redact(v.errorCode)!.slice(0, 120) : null,
      durationMs: v.durationMs != null ? Math.round(v.durationMs) : null,
      meta: JSON.parse(redact(JSON.stringify(v.meta ?? {}), 8000) ?? "{}"),
      costMicro: v.costMicro ?? BigInt(0),
      organizationId: v.organizationId ?? null,
      actorId: v.actorId ?? null,
    },
  });
}

export { redact };

/** live=false: the check passed but against something that isn't a production provider (e.g. Mailpit). */
export type Check = { ok: boolean; detail: string; live?: boolean; httpStatus?: number | null; errorCode?: string | null; meta?: Record<string, unknown> };
export async function call(url: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
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
export const errText = (b: Record<string, unknown>) => {
  const e = b.error as { message?: string; code?: string | number; type?: string } | string | undefined;
  if (typeof e === "string") return `${e}${b.error_description ? `: ${String(b.error_description).split("\n")[0]}` : ""}`;
  return e?.message ?? JSON.stringify(b).slice(0, 200);
};
/** Provider error code from the common error envelopes (OAuth, Graph, Stripe, OpenAI). */
export const errCode = (b: Record<string, unknown>) => {
  const e = b.error as { code?: string | number; type?: string; error_subcode?: number } | string | undefined;
  if (typeof e === "string") return e;
  if (e?.code != null) return `${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""}`;
  return e?.type ?? null;
};
export const failCheck = (r: { status: number; body: Record<string, unknown> }, prefix = ""): Check => ({ ok: false, detail: `${prefix}${errText(r.body)}`, httpStatus: r.status, errorCode: errCode(r.body) });

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
      if (r.status === 401) return failCheck(r, "invalid_api_key: ");
      if (r.status !== 200) missing.push(`${m} (${r.status}: ${errText(r.body)})`);
    }
    // Model names are never changed automatically — the admin sees exactly which one is unavailable.
    return missing.length
      ? { ok: false, detail: `Model not available to this key: ${missing.join("; ")}`, httpStatus: 404, errorCode: "model_not_found", meta: { models } }
      : { ok: true, detail: `Key valid; models available: ${[...new Set(models)].join(", ")}`, meta: { models } };
  },
  async anthropic() {
    // models.retrieve spends no tokens: proves the key and that the configured models are available to it.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: clean(process.env.ANTHROPIC_API_KEY), maxRetries: 0, timeout: 15_000 });
    const models = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];
    const missing: string[] = [];
    for (const m of models) {
      try {
        await client.models.retrieve(m);
      } catch (e) {
        const status = (e as { status?: number }).status ?? null;
        if (status === 401) return { ok: false, detail: "invalid_api_key", httpStatus: 401, errorCode: "authentication_error" };
        if (status == null) throw e;
        missing.push(`${m} (${status})`);
      }
    }
    return missing.length
      ? { ok: false, detail: `Model not available to this key: ${missing.join("; ")}`, httpStatus: 404, errorCode: "model_not_found", meta: { models } }
      : { ok: true, detail: `Key valid; models available: ${models.join(", ")}`, meta: { models } };
  },
  async facebook() {
    const v = clean(process.env.META_GRAPH_VERSION) || "v21.0";
    const r = await call(`https://graph.facebook.com/${v}/oauth/access_token?${new URLSearchParams({ client_id: clean(process.env.META_APP_ID), client_secret: clean(process.env.META_APP_SECRET), grant_type: "client_credentials" })}`);
    if (r.status !== 200 || !r.body.access_token) return failCheck(r);
    const app = await call(`https://graph.facebook.com/${v}/${clean(process.env.META_APP_ID)}?fields=name`, { headers: { authorization: `Bearer ${String(r.body.access_token)}` } });
    return { ok: true, detail: `App token issued${app.body.name ? ` for "${String(app.body.name)}"` : ""}` };
  },
  async instagram() {
    // Instagram Login has no app-token grant: an invalid code with valid client credentials fails with a code
    // error (not a client error). This proves the id/secret pair without any user involvement.
    const r = await call("https://api.instagram.com/oauth/access_token", form({ client_id: clean(process.env.INSTAGRAM_APP_ID), client_secret: clean(process.env.INSTAGRAM_APP_SECRET), grant_type: "authorization_code", redirect_uri: `${process.env.APP_URL ?? "http://localhost:3000"}/api/integrations/instagram/callback`, code: "nova-credential-check" }));
    const m = errText(r.body);
    if (/invalid (platform )?app|client_id|client secret|app secret|Invalid Client/i.test(m)) return failCheck(r);
    return { ok: true, detail: `Client accepted (expected code error: ${m.slice(0, 120)})` };
  },
  async linkedin() {
    const r = await call("https://www.linkedin.com/oauth/v2/accessToken", form({ grant_type: "client_credentials", client_id: clean(process.env.LINKEDIN_CLIENT_ID), client_secret: clean(process.env.LINKEDIN_CLIENT_SECRET) }));
    if (r.status === 200 && r.body.access_token) return { ok: true, detail: "Client credentials token issued" };
    const m = errText(r.body);
    // Most apps aren't allowed the 2-legged flow; LinkedIn still authenticates the client first.
    if (/invalid_client|client authentication failed/i.test(m)) return failCheck(r);
    return { ok: true, detail: `Client authenticated (2-legged flow not enabled: ${m.slice(0, 120)})` };
  },
  async tiktok() {
    const r = await call("https://open.tiktokapis.com/v2/oauth/token/", form({ client_key: clean(process.env.TIKTOK_CLIENT_KEY), client_secret: clean(process.env.TIKTOK_CLIENT_SECRET), grant_type: "client_credentials" }));
    if (r.status === 200 && r.body.access_token) return { ok: true, detail: "Client credentials token issued" };
    return failCheck(r);
  },
  async google() {
    const r = await call("https://oauth2.googleapis.com/token", form({ client_id: clean(process.env.GOOGLE_CLIENT_ID), client_secret: clean(process.env.GOOGLE_CLIENT_SECRET), grant_type: "authorization_code", code: "nova-credential-check", redirect_uri: `${process.env.APP_URL ?? "http://localhost:3000"}/api/integrations/google/callback` }));
    const e = String(r.body.error ?? "");
    if (e === "invalid_grant") return { ok: true, detail: "Client accepted (expected invalid_grant for a test code)" };
    return failCheck(r);
  },
  async microsoft() {
    const tenant = clean(process.env.MICROSOFT_TENANT_ID) || "common";
    const r = await call(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, form({ client_id: clean(process.env.MICROSOFT_CLIENT_ID), client_secret: clean(process.env.MICROSOFT_CLIENT_SECRET), grant_type: "authorization_code", code: "nova-credential-check", scope: "openid", redirect_uri: `${process.env.APP_URL ?? "http://localhost:3000"}/api/integrations/microsoft/callback` }));
    const codes = (r.body.error_codes as number[] | undefined) ?? [];
    // 7000215/7000222 = bad or expired secret, 700016 = unknown app, 90002 = unknown tenant.
    if (codes.some((c) => [7000215, 7000222, 700016, 90002, 900023].includes(c))) return { ...failCheck(r), errorCode: `AADSTS${codes[0]}` };
    if (String(r.body.error) === "invalid_grant") return { ok: true, detail: "Client accepted (expected invalid_grant for a test code)" };
    return failCheck(r);
  },
  async whatsapp() {
    const { whatsappDiagnostics } = await import("./live-tests");
    const d = await whatsappDiagnostics();
    return { ok: d.tokenValid, detail: d.summary, httpStatus: d.httpStatus, errorCode: d.errorCode, meta: d as unknown as Record<string, unknown> };
  },
  async email() {
    const t = await getMailer().testConnection();
    return { ok: t.ok, detail: t.detail, live: !/development mailbox/i.test(t.detail) };
  },
  async stripe() {
    const { stripeDiagnostics } = await import("./live-tests");
    const d = await stripeDiagnostics();
    return { ok: d.apiReachable && d.pricesValid && d.webhookConfigured, detail: d.summary, httpStatus: d.httpStatus, errorCode: d.errorCode, meta: d as unknown as Record<string, unknown> };
  },
};

/** Admin button: validate one provider's credentials against the real API and record the result. */
export async function validateCredentials(provider: ReadinessProvider, actor: { userId: string; organizationId?: string | null }) {
  const check = CHECKS[provider];
  if (!check) throw new Error("no credential check for this provider");
  if (!isConfigured(provider)) {
    return recordValidation({ provider, check: "credentials", ok: false, live: false, detail: `Not configured (${PROVIDER_INFO[provider].env.filter((k) => !clean(process.env[k])).join(", ") || "provider settings"})`, errorCode: "not_configured", actorId: actor.userId, organizationId: actor.organizationId });
  }
  const format = credentialFormat(provider);
  const started = Date.now();
  let result: Check;
  try {
    result = await check();
  } catch (e) {
    result = { ok: false, detail: `Network error: ${e instanceof Error ? e.message : String(e)}`, errorCode: "network_error" };
  }
  if (format?.length) result = { ...result, detail: `${result.detail} · format: ${format.join("; ")}` };
  if (!result.ok) logger.warn({ provider, httpStatus: result.httpStatus, errorCode: result.errorCode, detail: redact(result.detail) }, "provider credential check failed");
  const row = await recordValidation({ provider, check: "credentials", ok: result.ok, live: result.live ?? true, detail: result.detail, httpStatus: result.httpStatus, errorCode: result.errorCode, durationMs: Date.now() - started, meta: result.meta, actorId: actor.userId, organizationId: actor.organizationId });
  await audit({ category: "SECURITY", actorType: "USER", actorId: actor.userId, action: "admin.provider_validated", summary: `Validated ${provider} credentials: ${result.ok ? "ok" : "failed"}` });
  return row;
}

const maskEndpoint = (u: string) => {
  try {
    const url = new URL(u);
    const [first, ...rest] = url.hostname.split(".");
    return `${url.protocol}//${first.length > 6 ? `${first.slice(0, 3)}…${first.slice(-2)}` : first}.${rest.join(".")}`;
  } catch {
    return "custom endpoint";
  }
};

/**
 * Admin storage test: upload → signed URL → fetch/validate → delete → confirm deleted, on a dedicated test
 * prefix. Uses the configured driver (local / S3 / R2); automated tests use an in-memory driver instead.
 * The test object never outlives the test.
 */
export async function storageRoundtrip(actor: { userId: string }) {
  const key = `_nova-admin-test/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const body = Buffer.from(`NOVA storage test ${new Date().toISOString()}`);
  const steps: { step: string; ok: boolean; detail?: string }[] = [];
  const started = Date.now();
  let ok = true;
  let uploaded = false;
  try {
    await storage.put(key, body, "text/plain");
    uploaded = true;
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
    steps.push({ step: uploaded ? "read" : "upload", ok: false, detail: e instanceof Error ? e.message : String(e) });
  } finally {
    if (uploaded) {
      try {
        await storage.delete(key);
        steps.push({ step: "delete", ok: true });
        // Confirm it's really gone.
        const still = await storage
          .get(key)
          .then((b) => Boolean(b))
          .catch(() => false);
        steps.push({ step: "confirm_deleted", ok: !still, detail: still ? "object still readable after delete" : undefined });
        ok &&= !still;
      } catch (e) {
        ok = false;
        steps.push({ step: "delete", ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  const durationMs = Date.now() - started;
  const driver = storage.name;
  const bucket = clean(process.env.S3_BUCKET) || null;
  const endpoint = clean(process.env.S3_ENDPOINT) ? maskEndpoint(clean(process.env.S3_ENDPOINT)) : clean(process.env.S3_REGION) || null;
  const detail = `${driver}${bucket ? ` · ${bucket}` : ""}${endpoint ? ` · ${endpoint}` : ""}: ${steps.map((s) => `${s.step}=${s.ok ? "ok" : `fail${s.detail ? ` (${s.detail})` : ""}`}`).join(", ")}`;
  // Local disk is not a production storage test: record it, but not as "live".
  await recordValidation({ provider: "storage", check: "roundtrip", ok, live: driver !== "local", detail, durationMs, meta: { driver, bucket, endpoint, steps }, actorId: actor.userId });
  return { ok, driver, bucket, endpoint, durationMs, steps };
}
