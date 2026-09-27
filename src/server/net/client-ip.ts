import { isIP } from "node:net";

/**
 * Client IP extraction that only believes forwarding headers when told to.
 *
 * TRUST_PROXY:
 *   unset / "false" / "0"  → never read forwarding headers (they are client-controlled). IP is unknown.
 *   "true" / "1"           → one trusted proxy in front of the app: use the LAST X-Forwarded-For entry
 *                            (the one our proxy appended), never the client-supplied leftmost one.
 *   "<n>" (2–10)           → n trusted hops (e.g. CDN → load balancer → app): use the n-th entry from the right.
 * TRUST_PROXY_HEADER (optional, only when TRUST_PROXY is enabled): read a single-value header set by the
 *   trusted edge instead, e.g. "cf-connecting-ip" (Cloudflare) or "x-real-ip" (nginx, Vercel).
 */
type HeaderBag = { get(name: string): string | null };

export function trustedHops(env: NodeJS.ProcessEnv = process.env): number {
  const v = (env.TRUST_PROXY ?? "").trim().toLowerCase();
  if (v === "true") return 1;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 0;
}

/** Normalizes "1.2.3.4:5678", "[::1]:80" and "::ffff:1.2.3.4"; returns null for anything that isn't an IP. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim();
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracket) v = bracket[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(v)) v = v.slice(7);
  return isIP(v) ? v.toLowerCase() : null;
}

export function clientIp(headers: HeaderBag, env: NodeJS.ProcessEnv = process.env): string | null {
  const hops = trustedHops(env);
  if (!hops) return null;
  const single = env.TRUST_PROXY_HEADER?.trim().toLowerCase();
  if (single) return normalizeIp(headers.get(single));
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length < hops) return null;
  return normalizeIp(chain[chain.length - hops]);
}
