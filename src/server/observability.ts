import { randomUUID } from "node:crypto";
import { db } from "./db/client";
import { logger } from "./logger";

/**
 * Unified error reporting. Every area (jobs, OAuth, publishing, provider calls, image generation) reports
 * through here: structured log always; Sentry too when SENTRY_DSN is set (plain HTTPS envelope — no SDK,
 * no request bodies, no cookies, secrets scrubbed).
 */
export type ErrorArea = "job" | "oauth" | "publishing" | "provider" | "image" | "email" | "webhook" | "request";

const SECRET_PATTERNS: [RegExp, string][] = [
  [/(access_token|refresh_token|client_secret|api_key|token|code|password)=([^&\s"]+)/gi, "$1=[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [redacted]"],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]"],
  [/\b(sk|rk|pk|whsec)_(live|test)?_?[A-Za-z0-9]{8,}/g, "$1_[redacted]"],
  [/\bEAA[A-Za-z0-9]{20,}/g, "EAA[redacted]"],
  [/\bya29\.[A-Za-z0-9._-]+/g, "ya29.[redacted]"],
];

export function scrub(s: string) {
  return SECRET_PATTERNS.reduce((acc, [re, rep]) => acc.replace(re, rep), s).slice(0, 2000);
}

type Dsn = { endpoint: string; key: string; raw: string };
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!u.username || !project || u.protocol !== "https:") return null;
    return { endpoint: `https://${u.host}/api/${project}/envelope/`, key: u.username, raw: dsn };
  } catch {
    return null;
  }
}

/** Sentry envelope body (one event). Exported for tests. */
export function sentryEnvelope(dsn: Dsn, err: unknown, area: ErrorArea, tags: Record<string, string | number | boolean | null | undefined>) {
  const e = err instanceof Error ? err : new Error(String(err));
  const eventId = randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE ?? undefined,
    server_name: process.env.NOVA_PROCESS ?? "web",
    tags: { area, ...Object.fromEntries(Object.entries(tags).filter(([, v]) => v != null).map(([k, v]) => [k, scrub(String(v)).slice(0, 200)])) },
    exception: { values: [{ type: e.name, value: scrub(e.message), stacktrace: e.stack ? { frames: e.stack.split("\n").slice(1, 30).reverse().map((l) => ({ function: scrub(l.trim()).slice(0, 300) })) } : undefined }] },
  };
  return [JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: dsn.raw }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}

export function reportError(err: unknown, area: ErrorArea, tags: Record<string, string | number | boolean | null | undefined> = {}) {
  const message = scrub(err instanceof Error ? err.message : String(err));
  logger.error({ area, ...tags, err: { name: err instanceof Error ? err.name : "Error", message } }, `[${area}] ${message}`);
  const dsn = parseDsn(process.env.SENTRY_DSN?.trim());
  if (!dsn || process.env.NODE_ENV === "test") return;
  // Fire and forget: reporting must never break or slow the request that failed.
  void fetch(dsn.endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=nova/1.0` },
    body: sentryEnvelope(dsn, err, area, tags),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
}

export const SLOW_PROVIDER_MS = 8_000;

/** Records a failed or slow provider call (host + path only). Never throws. */
export function recordProviderCall(c: { url: string; method: string; status: number | null; kind: string; durationMs: number }) {
  if (c.kind === "ok" && c.durationMs < SLOW_PROVIDER_MS) return;
  let host = "unknown";
  let path = "";
  try {
    const u = new URL(c.url);
    host = u.host;
    // Ids in paths are fine (no secrets); query strings may carry tokens and are dropped.
    path = u.pathname.slice(0, 200);
  } catch {
    /* keep defaults */
  }
  void db.providerCall
    .create({ data: { host, path, method: c.method.toUpperCase().slice(0, 10), status: c.status, kind: c.kind === "ok" ? "slow" : c.kind, durationMs: Math.round(c.durationMs) } })
    .catch(() => undefined);
}
