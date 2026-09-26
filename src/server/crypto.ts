import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM encryption for credentials at rest.
 * Format: v{keyVersion}.{iv}.{tag}.{ciphertext} (base64url segments).
 * Key rotation: add ENCRYPTION_KEY_V2, bump CURRENT_KEY_VERSION, re-encrypt lazily.
 */
const CURRENT_KEY_VERSION = 1;

function keyFor(version: number): Buffer {
  const raw = version === 1 ? process.env.ENCRYPTION_KEY : process.env[`ENCRYPTION_KEY_V${version}`];
  if (!raw) throw new Error(`Encryption key v${version} is not configured`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(CURRENT_KEY_VERSION), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [`v${CURRENT_KEY_VERSION}`, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (!v?.startsWith("v") || !iv || !tag || data === undefined) throw new Error("Malformed encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(Number(v.slice(1))), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** Random URL-safe token (default 32 bytes of entropy). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are only ever stored hashed. SHA-256 is fine for high-entropy random tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmac(value: string, secret = process.env.AUTH_SECRET ?? ""): string {
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
