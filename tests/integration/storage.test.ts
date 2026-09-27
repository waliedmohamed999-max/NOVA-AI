import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { deleteFile, saveUpload, setStorageDriver, signedFileUrl, verifyFileSignature, type StorageDriver } from "@/server/storage";

afterEach(() => setStorageDriver(null));

function memoryDriver() {
  const objects = new Map<string, Buffer>();
  const d: StorageDriver = {
    name: "memory",
    put: async (k, data) => void objects.set(k, data),
    get: async (k) => objects.get(k) ?? Promise.reject(new Error("missing")),
    delete: async (k) => void objects.delete(k),
  };
  return { d, objects };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("storage service", () => {
  it("stores uploads under the organization's prefix and records metadata", async () => {
    const { d, objects } = memoryDriver();
    setStorageDriver(d);
    const t = await makeTenant();
    const f = await saveUpload({ organizationId: t.organization.id, workspaceId: t.workspace.id, userId: t.user.id, fileName: "logo../../x.png", data: PNG, purpose: "brand" });
    expect(f.storageKey.startsWith(`${t.organization.id}/`)).toBe(true);
    expect(f.mimeType).toBe("image/png");
    expect(f.fileName).not.toContain("/");
    expect(objects.has(f.storageKey)).toBe(true);
    const url = new URL(signedFileUrl(f.id), "http://x");
    expect(verifyFileSignature(f.id, url.searchParams.get("exp"), url.searchParams.get("sig"))).toBe(true);
    expect(verifyFileSignature("other", url.searchParams.get("exp"), url.searchParams.get("sig"))).toBe(false);
  });

  it("rejects oversized and disguised files before touching storage", async () => {
    const { d, objects } = memoryDriver();
    setStorageDriver(d);
    const t = await makeTenant();
    await expect(saveUpload({ organizationId: t.organization.id, fileName: "a.png", data: Buffer.alloc(10 * 1024 * 1024 + 1), purpose: "x" })).rejects.toMatchObject({ code: "file_too_large" });
    await expect(saveUpload({ organizationId: t.organization.id, fileName: "a.png", data: Buffer.from("MZ-not-an-image"), purpose: "x" })).rejects.toMatchObject({ code: "file_type" });
    expect(objects.size).toBe(0);
  });

  it("deletes only within the owning organization", async () => {
    const { d, objects } = memoryDriver();
    setStorageDriver(d);
    const a = await makeTenant("A");
    const b = await makeTenant("B");
    const f = await saveUpload({ organizationId: a.organization.id, fileName: "a.png", data: PNG, purpose: "x" });
    await expect(deleteFile(b.organization.id, f.id)).rejects.toMatchObject({ code: "item_not_found" });
    expect(objects.has(f.storageKey)).toBe(true);
    await deleteFile(a.organization.id, f.id);
    expect(objects.has(f.storageKey)).toBe(false);
    expect((await db.fileObject.findUniqueOrThrow({ where: { id: f.id } })).deletedAt).not.toBeNull();
  });
});
