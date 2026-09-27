import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

/**
 * SSRF-safe fetch for user-supplied URLs (website ingestion).
 * - http/https only, no credentials in the URL, default ports only
 * - DNS is resolved inside the socket's own lookup and every address is checked there, so the
 *   IP we validate is the IP we connect to (no DNS-rebinding window between check and connect)
 * - every redirect hop is re-validated and re-resolved; hop count, size, time and content type are capped
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

// Separate lists: a single BlockList would match every IPv4 against the IPv4-mapped IPv6 rule.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const)
  BLOCKED_V4.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96], // IPv4-mapped (any form) — never a legitimate public answer
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const)
  BLOCKED_V6.addSubnet(net, prefix, "ipv6");

const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;
const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "instance-data", "metadata.azure.internal"]);

export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return BLOCKED_V4.check(ip, "ipv4");
  if (kind === 6) {
    return BLOCKED_V6.check(ip, "ipv6");
  }
  return true; // not an IP at all
}

export function normalizeUrl(input: string): URL {
  const trimmed = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) throw new UnsafeUrlError("Only http(s) URLs are allowed");
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (!["http:", "https:"].includes(url.protocol)) throw new UnsafeUrlError("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new UnsafeUrlError("Credentials in URL are not allowed");
  if (url.port && !["80", "443"].includes(url.port)) throw new UnsafeUrlError("Non-standard ports are not allowed");
  url.hash = "";
  return url;
}

/** Host-name level checks that don't need DNS (IP literals are fully checked here). */
export function assertAllowedHost(hostname: string, allowIps: readonly string[] = []) {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host || BLOCKED_HOSTS.test(host) || METADATA_HOSTS.has(host)) throw new UnsafeUrlError("Host not allowed");
  if (isIP(host) && isBlockedIp(host) && !allowIps.includes(host)) throw new UnsafeUrlError("Host resolves to a private address");
  return host;
}

type Resolver = (hostname: string) => Promise<LookupAddress[]>;
const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => dnsLookup(hostname, { all: true, verbatim: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))));

/** Test-only knobs (never set in application code). */
export type SafeFetchTestOverrides = { resolve?: Resolver; allowIps?: string[]; allowPorts?: string[] };

const ALLOWED_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i;

export async function safeFetchText(
  input: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; unsafeTestOverrides?: SafeFetchTestOverrides } = {},
): Promise<{ url: string; status: number; contentType: string; body: string }> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const t = opts.unsafeTestOverrides ?? {};
  const allowIps = t.allowIps ?? [];
  let url = parse(input, t);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 4); hop++) {
    const res = await requestOnce(url, { timeoutMs: opts.timeoutMs ?? 12_000, maxBytes, resolve: t.resolve ?? systemResolver, allowIps });
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = parse(new URL(res.location, url).toString(), t);
      continue;
    }
    return { url: url.toString(), status: res.status, contentType: res.contentType, body: res.body };
  }
  throw new UnsafeUrlError("Too many redirects");
}

function parse(input: string, t: SafeFetchTestOverrides) {
  if (t.allowPorts?.length) {
    const u = new URL(input);
    if (u.port && t.allowPorts.includes(u.port)) {
      const probe = new URL(u);
      probe.port = "";
      normalizeUrl(probe.toString());
      return u;
    }
  }
  return normalizeUrl(input);
}

function requestOnce(url: URL, o: { timeoutMs: number; maxBytes: number; resolve: Resolver; allowIps: string[] }) {
  const host = assertAllowedHost(url.hostname, o.allowIps);
  // The socket calls this to resolve the host; we validate every address before it connects.
  const lookup = (hostname: string, options: { all?: boolean }, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => {
    o.resolve(hostname).then(
      (addrs) => {
        const bad = addrs.find((a) => isBlockedIp(a.address) && !o.allowIps.includes(a.address));
        if (!addrs.length || bad) return cb(new UnsafeUrlError("Host resolves to a private address"), "");
        if (options?.all) return cb(null, addrs);
        cb(null, addrs[0].address, addrs[0].family);
      },
      (err) => cb(err, ""),
    );
  };
  const mod = url.protocol === "https:" ? https : http;
  return new Promise<{ status: number; location: string | null; contentType: string; body: string }>((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup: isIP(host) ? undefined : (lookup as never),
        agent: false, // no pooled sockets: every hop resolves and validates afresh
        headers: { "user-agent": "NovaBot/1.0 (+company-profile analysis)", accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "accept-encoding": "identity" },
        timeout: o.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location ?? null;
        const contentType = String(res.headers["content-type"] ?? "");
        if ((status >= 300 && status < 400) || !ALLOWED_TYPES.test(contentType)) {
          res.resume();
          return resolve({ status, location, contentType, body: "" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.byteLength;
          if (size > o.maxBytes) {
            res.destroy();
            return resolve({ status, location, contentType, body: Buffer.concat(chunks).toString("utf8") });
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status, location, contentType, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    const deadline = setTimeout(() => req.destroy(new UnsafeUrlError("Timed out")), o.timeoutMs);
    req.on("timeout", () => req.destroy(new UnsafeUrlError("Timed out")));
    req.on("error", reject);
    req.on("close", () => clearTimeout(deadline));
    req.end();
  });
}
