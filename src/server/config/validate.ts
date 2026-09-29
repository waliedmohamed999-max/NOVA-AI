import { appEnvironment, isPublicHttps } from "../env";

/**
 * Startup configuration validation. Classifies every variable NOVA reads as required / optional /
 * provider-specific / development-only and checks the environment against it.
 *
 * - production: any `error` stops the server (and the worker) from starting.
 * - staging:    errors are reported loudly but the app starts (it is where configuration is completed).
 * - development: only obvious mistakes are reported.
 *
 * Values are never logged or returned — only the variable name and what is wrong.
 */

export type ConfigCategory = "required" | "optional" | "provider" | "development-only";
export type ConfigIssue = { key: string; level: "error" | "warning"; category: ConfigCategory; message: string };

/** The variable catalogue (also rendered in docs/DEPLOYMENT.md). */
export const CONFIG_SPEC: { key: string; category: ConfigCategory; note: string }[] = [
  { key: "DATABASE_URL", category: "required", note: "Hosted PostgreSQL 15+ with pgvector (never localhost in production)" },
  { key: "APP_URL", category: "required", note: "Public HTTPS origin, e.g. https://app.example.com" },
  { key: "APP_ENV", category: "required", note: "production | staging | development" },
  { key: "AUTH_SECRET", category: "required", note: "32+ random characters" },
  { key: "ENCRYPTION_KEY", category: "required", note: "32 random bytes, base64 (encrypts provider tokens)" },
  { key: "EMAIL_PROVIDER / RESEND_API_KEY / POSTMARK_SERVER_TOKEN / SMTP_*", category: "required", note: "A real email provider (not Mailpit)" },
  { key: "STORAGE_DRIVER=s3 + S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_REGION[/S3_ENDPOINT]", category: "required", note: "AWS S3 or Cloudflare R2" },
  { key: "CRON_SECRET", category: "optional", note: "Required when jobs run through /api/cron/tick (no long-running worker)" },
  { key: "NOVA_INLINE_WORKER / WORKER_CONCURRENCY", category: "optional", note: "Run the worker inside the web process (single-server hosts)" },
  { key: "SENTRY_DSN / SENTRY_ENVIRONMENT / SENTRY_RELEASE", category: "optional", note: "Error tracking (secrets are scrubbed)" },
  { key: "LOG_LEVEL", category: "optional", note: "info by default" },
  { key: "OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENAI_*", category: "provider", note: "AI features stay 'not set up' without a key" },
  { key: "STRIPE_*", category: "provider", note: "Billing stays off until key + webhook secret + prices are set" },
  { key: "WHATSAPP_*", category: "provider", note: "WhatsApp Cloud API + Embedded Signup" },
  { key: "META_* / INSTAGRAM_* / LINKEDIN_* / TIKTOK_* / GOOGLE_* / MICROSOFT_*", category: "provider", note: "Social / mailbox / calendar connections" },
  { key: "AI_OFFLINE_MODE", category: "development-only", note: "Deterministic local AI for development/tests (ignored in production)" },
  { key: "AI_DEMO_MODE", category: "development-only", note: "Template 'demo AI' for demos/staging — refused in production" },
  { key: "BRAIN_FETCH_FIXTURES / WHATSAPP_FAKE_TRANSPORT", category: "development-only", note: "E2E test doubles — refused in production" },
  { key: "STORAGE_ALLOW_LOCAL_IN_PRODUCTION", category: "development-only", note: "Escape hatch: local disk on ONE persistent server only" },
];

const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "") ?? "";
const LOCAL_HOST = /@(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(:|\/)/i;
const DEV_MAILBOX = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|mailpit|mailhog)$/i;
/** Placeholders that ship in the examples and must never reach production. */
const PLACEHOLDER = /^(change[-_ ]?me|changeme|secret|password|test|dev|development|example|your[-_].*|xxx+|placeholder)$/i;

export function validateConfig(env: NodeJS.ProcessEnv = process.env) {
  const environment = appEnvironment(env);
  const deployed = environment !== "development";
  const issues: ConfigIssue[] = [];
  const add = (key: string, category: ConfigCategory, message: string, level: "error" | "warning" = "error") => issues.push({ key, category, message, level });
  const v = (k: string) => clean(env[k]);

  // ── required ──
  const db = v("DATABASE_URL");
  if (!db) add("DATABASE_URL", "required", "missing");
  else if (!/^postgres(ql)?:\/\//i.test(db)) add("DATABASE_URL", "required", "must be a postgresql:// connection string");
  else if (deployed && LOCAL_HOST.test(db)) add("DATABASE_URL", "required", "points at localhost — use the hosted database");

  const appUrl = v("APP_URL");
  if (!appUrl) add("APP_URL", "required", "missing", deployed ? "error" : "warning");
  else if (deployed && !isPublicHttps(appUrl)) add("APP_URL", "required", "must be a public https:// URL (callbacks, links and cookies depend on it)");

  const auth = v("AUTH_SECRET");
  if (!auth) add("AUTH_SECRET", "required", "missing", deployed ? "error" : "warning");
  else if (deployed && (auth.length < 32 || PLACEHOLDER.test(auth))) add("AUTH_SECRET", "required", "must be 32+ random characters (not a placeholder)");

  const enc = v("ENCRYPTION_KEY");
  if (!enc) add("ENCRYPTION_KEY", "required", "missing", deployed ? "error" : "warning");
  else if (Buffer.from(enc, "base64").length !== 32) add("ENCRYPTION_KEY", "required", "must be 32 random bytes encoded as base64 (openssl rand -base64 32)");

  // Email: a real provider (never the development mailbox) outside development.
  const emailKind = (v("EMAIL_PROVIDER") || (v("SMTP_HOST") ? "smtp" : v("RESEND_API_KEY") ? "resend" : v("POSTMARK_SERVER_TOKEN") ? "postmark" : "")).toLowerCase();
  if (deployed) {
    if (!emailKind) add("EMAIL_PROVIDER", "required", "no email provider — verification, invitations and resets can't be sent");
    else if (emailKind === "smtp" && DEV_MAILBOX.test(v("SMTP_HOST"))) add("SMTP_HOST", "required", "is a development mailbox (Mailpit) — configure Resend, Postmark or a real SMTP server");
    else if (emailKind === "resend" && !v("RESEND_API_KEY")) add("RESEND_API_KEY", "required", "missing for EMAIL_PROVIDER=resend");
    else if (emailKind === "postmark" && !v("POSTMARK_SERVER_TOKEN")) add("POSTMARK_SERVER_TOKEN", "required", "missing for EMAIL_PROVIDER=postmark");
    if (!v("EMAIL_FROM") || /\.local>?$/i.test(v("EMAIL_FROM"))) add("EMAIL_FROM", "required", "must be an address on your verified sending domain");
  }

  // Storage: external object storage outside development (local disk loses files on redeploy / isn't shared).
  const driver = v("STORAGE_DRIVER") || "local";
  if (driver === "s3") {
    for (const k of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) if (!v(k)) add(k, "required", "missing for STORAGE_DRIVER=s3");
    if (!v("S3_REGION") && !v("S3_ENDPOINT")) add("S3_REGION", "required", "set S3_REGION (AWS) or S3_ENDPOINT (Cloudflare R2)");
  } else if (driver !== "local") add("STORAGE_DRIVER", "required", `unknown driver "${driver}" (use s3)`);
  else if (deployed) {
    if (v("STORAGE_ALLOW_LOCAL_IN_PRODUCTION") === "true") add("STORAGE_DRIVER", "development-only", "local disk storage (explicitly allowed): only safe on ONE server with a persistent disk", "warning");
    else add("STORAGE_DRIVER", "required", "local disk storage outside development — set STORAGE_DRIVER=s3 (S3 or R2)");
  }

  // ── development-only switches must never be on in production ──
  if (environment === "production") {
    if (v("AI_DEMO_MODE") === "true") add("AI_DEMO_MODE", "development-only", "demo AI is refused in production — add OPENAI_API_KEY / ANTHROPIC_API_KEY, or run this deployment as APP_ENV=staging");
    if (v("BRAIN_FETCH_FIXTURES") === "true") add("BRAIN_FETCH_FIXTURES", "development-only", "test fixture fetcher must be off in production");
    if (v("WHATSAPP_FAKE_TRANSPORT") === "true") add("WHATSAPP_FAKE_TRANSPORT", "development-only", "test transport must be off in production");
  }
  if (deployed && v("AI_OFFLINE_MODE") === "true") add("AI_OFFLINE_MODE", "development-only", "is ignored outside development — remove it", "warning");

  // ── optional / provider sanity (warnings: the feature stays honestly 'not set up') ──
  if (deployed && !v("OPENAI_API_KEY") && !v("ANTHROPIC_API_KEY") && v("AI_DEMO_MODE") !== "true") add("OPENAI_API_KEY", "provider", "no AI provider — AI features show 'not set up'", "warning");
  if (v("CRON_SECRET") && v("CRON_SECRET").length < 24) add("CRON_SECRET", "optional", "use 24+ random characters");
  if (v("SENTRY_DSN") && !/^https:\/\/[^@]+@[^/]+\/\d+/.test(v("SENTRY_DSN"))) add("SENTRY_DSN", "optional", "doesn't look like a Sentry DSN", "warning");
  if (deployed && !v("SENTRY_DSN")) add("SENTRY_DSN", "optional", "no error tracking configured", "warning");
  if (v("STRIPE_SECRET_KEY") && !v("STRIPE_WEBHOOK_SECRET")) add("STRIPE_WEBHOOK_SECRET", "provider", "billing needs the webhook secret — plans only change from verified webhooks");
  if (environment === "production" && /^sk_test_/.test(v("STRIPE_SECRET_KEY"))) add("STRIPE_SECRET_KEY", "provider", "is a test-mode key in production", "warning");

  const errors = issues.filter((i) => i.level === "error");
  return { environment, issues, errors, ok: errors.length === 0 };
}
export type ConfigReport = ReturnType<typeof validateConfig>;

/** Called at server / worker start. Production refuses to start with errors; other environments only log. */
export function assertStartupConfig(log: { error: (o: object, m: string) => void; warn: (o: object, m: string) => void; info: (o: object, m: string) => void }, env: NodeJS.ProcessEnv = process.env) {
  const r = validateConfig(env);
  for (const i of r.issues) {
    // Called as methods: pino's log functions need their logger as `this`.
    if (i.level === "error") log.error({ key: i.key, category: i.category }, `[config] ${i.key}: ${i.message}`);
    else log.warn({ key: i.key, category: i.category }, `[config] ${i.key}: ${i.message}`);
  }
  if (r.ok) log.info({ environment: r.environment, warnings: r.issues.length }, "[config] configuration validated");
  if (!r.ok && r.environment === "production") {
    throw new Error(`Refusing to start in production: ${r.errors.length} configuration error(s): ${r.errors.map((e) => e.key).join(", ")}. See docs/DEPLOYMENT.md.`);
  }
  return r;
}
