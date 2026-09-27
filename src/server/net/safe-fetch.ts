import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF-safe fetch for user-supplied URLs (website ingestion).
 * - http/https only, no credentials in URL, default ports only
 * - every hop (including redirects) must resolve to a public IP
 * - response size and time are capped
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
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

async function assertPublicHost(hostname: string) {
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new UnsafeUrlError("Host not allowed");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError("Host resolves to a private address");
}

export async function safeFetchText(
  input: string,
  opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {},
): Promise<{ url: string; status: number; contentType: string; body: string }> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let url = normalizeUrl(input);
  for (let hop = 0; hop <= (opts.maxRedirects ?? 4); hop++) {
    await assertPublicHost(url.hostname);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
      headers: { "user-agent": "NovaBot/1.0 (+company-profile analysis)", accept: "text/html,application/xhtml+xml,text/plain;q=0.8" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = normalizeUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    const contentType = res.headers.get("content-type") ?? "";
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { url: url.toString(), status: res.status, contentType, body: Buffer.concat(chunks).toString("utf8") };
  }
  throw new UnsafeUrlError("Too many redirects");
}
