import { readZip } from "../brain/parsers";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../db/client";
import { hmac, safeEqual, sha256 } from "../crypto";
import { UserFacingError } from "../errors";
import { logger } from "../logger";
import { S3Driver, s3ConfigFromEnv } from "./s3";

/** Storage driver abstraction. `STORAGE_DRIVER=local` (default) or `s3` (AWS S3, Cloudflare R2, MinIO…). */
export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Optional: a short-lived direct URL for the object (S3 presigned GET). */
  presignGet?(key: string, ttlSeconds: number, opts: { contentType?: string; disposition?: string }): string;
}

export class LocalDriver implements StorageDriver {
  readonly name = "local";
  // Runtime-configured directory; excluded from build tracing.
  private root = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.STORAGE_LOCAL_DIR ?? ".storage");
  private resolve(key: string) {
    const full = path.resolve(/* turbopackIgnore: true */ this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }
  get(key: string) {
    return readFile(this.resolve(key));
  }
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

function createDriver(): StorageDriver {
  const kind = process.env.STORAGE_DRIVER ?? "local";
  if (kind === "s3") return new S3Driver(s3ConfigFromEnv());
  if (kind !== "local") throw new Error(`Unknown STORAGE_DRIVER "${kind}" (use "local" or "s3")`);
  if (process.env.NODE_ENV === "production" && process.env.STORAGE_ALLOW_LOCAL_IN_PRODUCTION !== "true") {
    // Local disk loses files on redeploy and isn't shared between instances.
    logger.warn("STORAGE_DRIVER=local in production — files are only safe on a single persistent server");
  }
  return new LocalDriver();
}

let driver: StorageDriver | null = null;
/** Lazily created so a misconfigured driver fails on first use with a clear message, not at import. */
export const storage: StorageDriver = {
  get name() {
    return (driver ??= createDriver()).name;
  },
  put: (k, d, t) => (driver ??= createDriver()).put(k, d, t),
  get: (k) => (driver ??= createDriver()).get(k),
  delete: (k) => (driver ??= createDriver()).delete(k),
  presignGet: (k, ttl, o) => {
    const d = (driver ??= createDriver());
    if (!d.presignGet) throw new Error("presign not supported by this driver");
    return d.presignGet(k, ttl, o);
  },
};

/** Whether the configured driver can hand out direct presigned URLs (S3 / R2) or serves through the app. */
export function supportsPresign() {
  return Boolean((driver ??= createDriver()).presignGet);
}

/** Test hook. */
export function setStorageDriver(d: StorageDriver | null) {
  driver = d;
}

/** Every object key starts with its organization id; reads and deletes re-check that. */
export function orgKey(organizationId: string, ext: string) {
  if (!/^[a-z0-9]+$/i.test(organizationId) || !/^[a-z0-9]{1,8}$/.test(ext)) throw new Error("Invalid storage key parts");
  return `${organizationId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
}

export function keyBelongsTo(organizationId: string, key: string) {
  return key.startsWith(`${organizationId}/`) && !key.includes("..");
}

/** Deletes a tenant's file (object + record). Refuses keys outside the organization's prefix. */
export async function deleteFile(organizationId: string, fileId: string) {
  const file = await db.fileObject.findFirst({ where: { id: fileId, organizationId, deletedAt: null } });
  if (!file) throw new UserFacingError("item_not_found");
  if (!keyBelongsTo(organizationId, file.storageKey)) throw new Error("Storage key outside organization prefix");
  await storage.delete(file.storageKey);
  await db.fileObject.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
}

/** Direct presigned URLs are opt-in (S3_SIGNED_REDIRECT=true); by default the app streams files itself. */
export function directDownloadsEnabled() {
  return process.env.STORAGE_DRIVER === "s3" && process.env.S3_SIGNED_REDIRECT === "true";
}

/** Allowed uploads, verified by magic bytes — never by the client-provided type. */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", ext: "gif", test: (b) => b.subarray(0, 6).toString("ascii").startsWith("GIF8") },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("ascii") === "%PDF-" },
];

const TEXT_TYPES: Record<string, string> = { txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json" };

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function detectType(data: Buffer, fileName: string): { mime: string; ext: string } | null {
  const sig = SIGNATURES.find((s) => s.test(data));
  if (sig) return { mime: sig.mime, ext: sig.ext };
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  // Office Open XML (Company Brain imports): a real ZIP that contains the expected document part.
  if ((ext === "docx" || ext === "xlsx") && data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    try {
      const entries = readZip(data);
      if (ext === "docx" && entries.has("word/document.xml")) return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext };
      if (ext === "xlsx" && entries.has("xl/workbook.xml")) return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext };
    } catch {
      return null;
    }
    return null;
  }
  if (TEXT_TYPES[ext]) {
    // Must be valid UTF-8 text without NUL bytes.
    const sample = data.subarray(0, 4096);
    if (sample.includes(0)) return null;
    return { mime: TEXT_TYPES[ext], ext };
  }
  return null;
}

export async function saveUpload(input: { organizationId: string; workspaceId?: string | null; userId?: string | null; fileName: string; data: Buffer; purpose: string }) {
  if (input.data.byteLength > MAX_UPLOAD_BYTES) throw new UserFacingError("file_too_large");
  const type = detectType(input.data, input.fileName);
  if (!type) throw new UserFacingError("file_type");
  const key = orgKey(input.organizationId, type.ext);
  await storage.put(key, input.data, type.mime);
  return db.fileObject.create({
    data: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId ?? null,
      storageKey: key,
      fileName: input.fileName.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 200),
      mimeType: type.mime,
      sizeBytes: input.data.byteLength,
      sha256: sha256(input.data),
      purpose: input.purpose,
      uploadedById: input.userId ?? null,
    },
  });
}

/** Short-lived signed URL; the file route verifies the signature before serving. */
export function signedFileUrl(fileId: string, ttlSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/files/${fileId}?exp=${exp}&sig=${hmac(`${fileId}:${exp}`)}`;
}

export function verifyFileSignature(fileId: string, exp: string | null, sig: string | null) {
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, hmac(`${fileId}:${exp}`));
}
