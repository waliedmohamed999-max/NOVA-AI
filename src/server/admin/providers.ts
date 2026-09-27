import { metaCredentialProblem } from "../integrations/providers/meta";
import { instagramCredentialProblem } from "../integrations/providers/instagram";

/**
 * Platform-admin view of provider configuration. Reads environment variables only —
 * secrets are never stored in the database and never returned unmasked.
 */
export type ProviderStatus = "configured" | "missing" | "error";
export type ProviderField = { env: string; kind: "id" | "secret" | "setting"; value: string | null };
export type ProviderRow = { key: string; status: ProviderStatus; fields: ProviderField[]; note: string | null };

export function maskId(v: string) {
  return v.length <= 8 ? "••••" : `${v.slice(0, 4)}••••${v.slice(-2)}`;
}

function field(env: string, kind: ProviderField["kind"]): ProviderField {
  const raw = process.env[env]?.trim();
  if (!raw) return { env, kind, value: null };
  return { env, kind, value: kind === "secret" ? "••••" : kind === "id" ? maskId(raw) : raw };
}

/** All required present → configured; none → missing; some → error (half-configured). */
function judge(required: ProviderField[]): ProviderStatus {
  const set = required.filter((f) => f.value).length;
  return set === required.length ? "configured" : set === 0 ? "missing" : "error";
}

function row(key: string, required: ProviderField[], optional: ProviderField[] = [], note: string | null = null): ProviderRow {
  return { key, status: judge(required), fields: [...required, ...optional], note };
}

function instagramRow(): ProviderRow {
  const r = row("instagram", [field("INSTAGRAM_APP_ID", "id"), field("INSTAGRAM_APP_SECRET", "secret")], [field("INSTAGRAM_REDIRECT_URI", "setting"), field("INSTAGRAM_OAUTH_SCOPES", "setting")]);
  const problem = instagramCredentialProblem();
  if (problem && problem !== "missing") return { ...r, status: "error", note: `instagram_${problem}` };
  return r;
}

function metaRow(): ProviderRow {
  const r = row("meta", [field("META_APP_ID", "id"), field("META_APP_SECRET", "secret")], [field("META_REDIRECT_URI", "setting"), field("META_PERMISSION_MODE", "setting"), field("META_OAUTH_SCOPES", "setting"), field("META_GRAPH_VERSION", "setting")]);
  const problem = metaCredentialProblem();
  if (problem && problem !== "missing") return { ...r, status: "error", note: `meta_${problem}` };
  return r;
}

export function providerConfigStatus(): ProviderRow[] {
  const storageDriver = process.env.STORAGE_DRIVER ?? "local";
  const s3 = [field("S3_BUCKET", "setting"), field("S3_ACCESS_KEY_ID", "id"), field("S3_SECRET_ACCESS_KEY", "secret")];
  const stripe = [field("STRIPE_SECRET_KEY", "secret"), field("STRIPE_WEBHOOK_SECRET", "secret")];
  const stripeSet = stripe.some((f) => f.value);
  return [
    metaRow(),
    instagramRow(),
    row("linkedin", [field("LINKEDIN_CLIENT_ID", "id"), field("LINKEDIN_CLIENT_SECRET", "secret")], [field("LINKEDIN_REDIRECT_URI", "setting"), field("LINKEDIN_API_VERSION", "setting"), field("LINKEDIN_ORGANIZATION_ACCESS", "setting")]),
    row("tiktok", [field("TIKTOK_CLIENT_KEY", "id"), field("TIKTOK_CLIENT_SECRET", "secret")]),
    row("openai", [field("OPENAI_API_KEY", "secret")], [field("OPENAI_MODEL_BEST", "setting"), field("OPENAI_MODEL_FAST", "setting")]),
    row("anthropic", [field("ANTHROPIC_API_KEY", "secret")], [field("AI_PRIMARY_PROVIDER", "setting")]),
    row("email", [field("SMTP_HOST", "setting"), field("EMAIL_FROM", "setting")], [field("SMTP_PORT", "setting"), field("SMTP_USER", "id"), field("SMTP_PASSWORD", "secret")]),
    storageDriver === "s3"
      ? row("storage", s3, [field("S3_ENDPOINT", "setting"), field("S3_REGION", "setting"), { env: "STORAGE_DRIVER", kind: "setting", value: "s3" }])
      : { key: "storage", status: "configured", fields: [{ env: "STORAGE_DRIVER", kind: "setting", value: storageDriver }, field("STORAGE_LOCAL_DIR", "setting")], note: "local" },
    // The Stripe adapter and webhook are not implemented yet; keys alone do not enable payments.
    { key: "payments", status: stripeSet ? "error" : "missing", fields: [...stripe, field("STRIPE_PRICE_GROWTH", "setting")], note: "stripe_not_implemented" },
  ];
}
