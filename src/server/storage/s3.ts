import { createHash, createHmac } from "node:crypto";
import type { StorageDriver } from "./index";

/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2 …) using
 * AWS Signature V4 over fetch — no SDK dependency. Objects stay private; reads go
 * through the app (or a short-lived presigned URL when enabled).
 */
export type S3Config = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom endpoint for R2/MinIO (e.g. https://<account>.r2.cloudflarestorage.com). Omit for AWS. */
  endpoint?: string;
  /** Path-style addressing (`endpoint/bucket/key`). Default: true with a custom endpoint, false on AWS. */
  forcePathStyle?: boolean;
};

type Clock = () => Date;
type Fetch = typeof fetch;

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as S3 expects (encodeURIComponent leaves !'()* alone). */
export function uriEncode(s: string, keepSlash = false) {
  const out = encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? out.replace(/%2F/g, "/") : out;
}

function amzDates(now: Date) {
  const iso = now.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "");
  return { amzDate: iso, date: iso.slice(0, 8) };
}

export class S3Driver implements StorageDriver {
  readonly name = "s3";
  constructor(
    private cfg: S3Config,
    private deps: { fetch?: Fetch; now?: Clock } = {},
  ) {
    if (!cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) throw new Error("S3 storage is missing bucket or credentials");
  }

  private get pathStyle() {
    return this.cfg.forcePathStyle ?? Boolean(this.cfg.endpoint);
  }

  /** Host and canonical path for a key. Keys are validated before any request is built. */
  target(key: string) {
    if (!key || key.startsWith("/") || key.split("/").some((p) => p === "" || p === "." || p === "..")) throw new Error("Invalid storage key");
    const base = this.cfg.endpoint ? new URL(this.cfg.endpoint) : new URL(`https://s3.${this.cfg.region}.amazonaws.com`);
    const encodedKey = uriEncode(key, true);
    if (this.pathStyle) return { origin: base.origin, host: base.host, path: `/${uriEncode(this.cfg.bucket)}/${encodedKey}` };
    const host = `${this.cfg.bucket}.${base.host}`;
    return { origin: `${base.protocol}//${host}`, host, path: `/${encodedKey}` };
  }

  private signingKey(date: string) {
    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, date);
    return hmac(hmac(hmac(kDate, this.cfg.region), "s3"), "aws4_request");
  }

  private signature(method: string, path: string, query: string, headers: Record<string, string>, payloadHash: string, amzDate: string, date: string) {
    const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]));
    const canonical = [method, path, query, names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
    const scope = `${date}/${this.cfg.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
    return { signature: createHmac("sha256", this.signingKey(date)).update(toSign).digest("hex"), signedHeaders: names.join(";"), scope };
  }

  /** Header-signed request (used for PUT/GET/DELETE). Exposed for tests against AWS's published vectors. */
  signRequest(method: string, key: string, opts: { body?: Buffer; headers?: Record<string, string>; now?: Date } = {}) {
    const { origin, host, path } = this.target(key);
    const { amzDate, date } = amzDates(opts.now ?? this.deps.now?.() ?? new Date());
    const payloadHash = sha256Hex(opts.body ?? "");
    const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...(opts.headers ?? {}) };
    const { signature, signedHeaders, scope } = this.signature(method, path, "", headers, payloadHash, amzDate, date);
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    delete headers.host; // fetch sets it
    return { url: `${origin}${path}`, headers };
  }

  /** Short-lived presigned GET (query-string auth). The object itself stays private. */
  presignGet(key: string, ttlSeconds = 300, opts: { contentType?: string; disposition?: string; now?: Date } = {}) {
    const { origin, host, path } = this.target(key);
    const { amzDate, date } = amzDates(opts.now ?? this.deps.now?.() ?? new Date());
    const params: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${this.cfg.accessKeyId}/${date}/${this.cfg.region}/s3/aws4_request`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(Math.min(Math.max(1, Math.floor(ttlSeconds)), 604800)),
      "X-Amz-SignedHeaders": "host",
    };
    if (opts.contentType) params["response-content-type"] = opts.contentType;
    if (opts.disposition) params["response-content-disposition"] = opts.disposition;
    const query = Object.keys(params)
      .sort()
      .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
      .join("&");
    const { signature } = this.signature("GET", path, query, { host }, "UNSIGNED-PAYLOAD", amzDate, date);
    return `${origin}${path}?${query}&X-Amz-Signature=${signature}`;
  }

  private async send(method: string, key: string, body?: Buffer, extra?: Record<string, string>) {
    const { url, headers } = this.signRequest(method, key, { body, headers: extra });
    const res = await (this.deps.fetch ?? fetch)(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(30_000) });
    if (!res.ok && !(method === "DELETE" && res.status === 404)) {
      // Never include credentials or the signed URL in the error.
      throw new Error(`S3 ${method} failed with HTTP ${res.status}`);
    }
    return res;
  }

  async put(key: string, data: Buffer, contentType: string) {
    await this.send("PUT", key, data, { "content-type": contentType });
  }

  async get(key: string) {
    const res = await this.send("GET", key);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string) {
    await this.send("DELETE", key);
  }
}

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config {
  return {
    bucket: env.S3_BUCKET ?? "",
    region: env.S3_REGION ?? (env.S3_ENDPOINT ? "auto" : "us-east-1"),
    accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE === "true" : undefined,
  };
}
