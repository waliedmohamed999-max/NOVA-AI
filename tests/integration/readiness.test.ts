import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { providerReadiness, recordValidation, storageRoundtrip, validateCredentials } from "@/server/admin/readiness";
import { setStorageDriver, type StorageDriver } from "@/server/storage";
import { makeTenant } from "../support/factory";
import { SOCIAL_PROVIDERS } from "@/server/integrations/registry";

/** Readiness dashboard: every YES must come from a recorded validation. Provider HTTP is mocked. */
const saved: Record<string, string | undefined> = {};
function env(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in saved)) saved[k] = process.env[k];
    process.env[k] = v;
  }
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
beforeEach(async () => {
  await db.providerValidation.deleteMany({});
});
afterEach(() => {
  vi.unstubAllGlobals();
  setStorageDriver(null);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
});

describe("provider readiness", () => {
  it("nothing is valid or live tested until a real check succeeded", async () => {
    const rows = await providerReadiness();
    expect(rows.map((r) => r.provider)).toEqual(["openai", "anthropic", "linkedin", "instagram", "facebook", "tiktok", "google", "microsoft", "whatsapp", "email", "storage", "stripe"]);
    for (const r of rows) {
      expect(r.credentialsValid).toBeNull();
      expect(r.liveTested).toBe(false);
    }
    expect(rows.find((r) => r.provider === "linkedin")!.pendingApproval[0]).toContain("Community Management");
  });

  it("validates OpenAI key and models, Google/Microsoft clients and TikTok client credentials", async () => {
    env({ OPENAI_API_KEY: "sk-test-abcdefghijk", OPENAI_TEXT_MODEL: "gpt-5.1", OPENAI_IMAGE_MODEL_FAST: "gpt-image-1-mini", OPENAI_IMAGE_MODEL_QUALITY: "gpt-image-1", GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", MICROSOFT_CLIENT_ID: "m", MICROSOFT_CLIENT_SECRET: "s", TIKTOK_CLIENT_KEY: "t", TIKTOK_CLIENT_SECRET: "s" });
    let googleError = "invalid_grant";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.openai.com/v1/models/")) return url.endsWith("gpt-image-1") ? json({ error: { message: "The model `gpt-image-1` does not exist" } }, 404) : json({ id: "ok" });
      if (url === "https://oauth2.googleapis.com/token") return json({ error: googleError, error_description: googleError === "invalid_client" ? "The OAuth client was not found." : "Bad Request" }, 400);
      if (url.includes("login.microsoftonline.com")) return json({ error: "invalid_grant", error_codes: [9002313] }, 400);
      if (url.startsWith("https://open.tiktokapis.com/v2/oauth/token/")) return json({ access_token: "clt.x", expires_in: 7200 });
      return json({ error: "unmocked" }, 500);
    }));
    const actor = { userId: "admin-1" };
    const openai = await validateCredentials("openai", actor);
    expect(openai.ok).toBe(false);
    expect(openai.detail).toContain("gpt-image-1 (404: The model `gpt-image-1` does not exist)");
    expect(openai).toMatchObject({ httpStatus: 404, errorCode: "model_not_found" });
    expect((await validateCredentials("google", actor)).ok).toBe(true);
    googleError = "invalid_client";
    const bad = await validateCredentials("google", actor);
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain("invalid_client");
    expect((await validateCredentials("microsoft", actor)).ok).toBe(true);
    expect((await validateCredentials("tiktok", actor)).ok).toBe(true);

    const rows = await providerReadiness();
    expect(rows.find((r) => r.provider === "google")).toMatchObject({ credentialsValid: false, lastError: { check: "credentials" } });
    expect(rows.find((r) => r.provider === "tiktok")).toMatchObject({ credentialsValid: true, liveTested: false });
  });

  it("validates the Anthropic key via models.retrieve (no tokens spent) and reports missing models", async () => {
    env({ ANTHROPIC_API_KEY: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz" });
    const seen: string[] = [];
    let haiku = 200;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      seen.push(url);
      if (url.startsWith("https://api.anthropic.com/v1/models/")) {
        const id = decodeURIComponent(url.split("/").pop()!.split("?")[0]);
        if (id === "claude-haiku-4-5" && haiku !== 200) return json({ type: "error", error: { type: "not_found_error", message: "model not found" } }, haiku);
        return json({ type: "model", id, display_name: id, created_at: "2026-01-01T00:00:00Z" });
      }
      return json({ error: "unmocked" }, 500);
    }));
    const ok = await validateCredentials("anthropic", { userId: "admin-1" });
    expect(ok.ok).toBe(true);
    expect(seen.every((u) => u.startsWith("https://api.anthropic.com/v1/models/"))).toBe(true);
    expect(seen.some((u) => u.includes("/messages"))).toBe(false);
    haiku = 404;
    const bad = await validateCredentials("anthropic", { userId: "admin-1" });
    expect(bad).toMatchObject({ ok: false, errorCode: "model_not_found" });
    expect(bad.detail).toContain("claude-haiku-4-5 (404)");
    expect(JSON.stringify(bad, (_k, v) => (typeof v === "bigint" ? String(v) : v))).not.toContain("sk-ant-api03");
  });

  it("derives one honest status per provider from configuration and recorded validations", async () => {
    // Nothing configured → BLOCKED; nothing is READY without a recorded live success.
    env({ OPENAI_API_KEY: "", TIKTOK_CLIENT_KEY: "aw1b2c3d4e5f6g7h8", TIKTOK_CLIENT_SECRET: "s", ANTHROPIC_API_KEY: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz" });
    let rows = await providerReadiness();
    expect(rows.find((r) => r.provider === "openai")!.status).toBe("BLOCKED");
    expect(rows.every((r) => r.status !== "READY")).toBe(true);
    // Configured but external review pending → WAITING_EXTERNAL_APPROVAL, even with valid credentials.
    await recordValidation({ provider: "tiktok", check: "credentials", ok: true, live: true, detail: "ok" });
    rows = await providerReadiness();
    expect(rows.find((r) => r.provider === "tiktok")!.status).toBe("WAITING_EXTERNAL_APPROVAL");
    // Configured, valid, no review needed, not yet live-tested → READY_FOR_STAGING.
    expect(rows.find((r) => r.provider === "anthropic")!.status).toBe("READY_FOR_STAGING");
    // A real generation recorded → READY. A newer failure → BLOCKED again.
    await recordValidation({ provider: "anthropic", check: "generate_text", ok: true, live: true, detail: "claude-haiku-4-5" });
    rows = await providerReadiness();
    expect(rows.find((r) => r.provider === "anthropic")!.status).toBe("READY");
    await new Promise((r) => setTimeout(r, 5));
    await recordValidation({ provider: "anthropic", check: "generate_text", ok: false, detail: "overloaded", httpStatus: 529 });
    rows = await providerReadiness();
    expect(rows.find((r) => r.provider === "anthropic")!.status).toBe("BLOCKED");
  });

  it("an unconfigured provider is recorded as not configured, without calling anyone", async () => {
    env({ STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await validateCredentials("stripe", { userId: "admin-1" });
    expect(r).toMatchObject({ ok: false, live: false });
    expect(r.detail).toContain("STRIPE_SECRET_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never stores secrets in validation details", async () => {
    const r = await recordValidation({ provider: "openai", check: "x", ok: false, detail: "Incorrect API key provided: sk-proj-abcdefghijklmnop; url?access_token=EAAB123&x=1; sk_live_abcdef" });
    expect(r.detail).not.toMatch(/abcdefghijklmnop|EAAB123|sk_live_abcdef/);
  });

  it("storage test: upload, read, delete on a test prefix; local disk isn't counted as live", async () => {
    const objects = new Map<string, Buffer>();
    const mem: StorageDriver = {
      name: "memory-s3",
      put: async (k, d) => void objects.set(k, d),
      get: async (k) => objects.get(k)!,
      delete: async (k) => void objects.delete(k),
    };
    setStorageDriver(mem);
    const r = await storageRoundtrip({ userId: "admin-1" });
    expect(r.ok).toBe(true);
    expect(objects.size).toBe(0);
    const row = await db.providerValidation.findFirstOrThrow({ where: { provider: "storage" } });
    expect(row).toMatchObject({ ok: true, live: true, check: "roundtrip" });
    expect((await providerReadiness()).find((x) => x.provider === "storage")!.liveTested).toBe(true);
  });
});

describe("LinkedIn test post", () => {
  it("is stored as a real social post and recorded as a live validation", async () => {
    env({ LINKEDIN_CLIENT_ID: "li", LINKEDIN_CLIENT_SECRET: "s" });
    const t = await makeTenant();
    const integration = await db.integration.create({ data: { ...t.scope, provider: "LINKEDIN", status: "CONNECTED", scopes: ["openid", "w_member_social"] } });
    const account = await db.integrationAccount.create({ data: { ...t.scope, integrationId: integration.id, platform: "LINKEDIN", externalId: "urn:li:person:abc", name: "Walied", accountType: "linkedin_member", isActive: true } });
    const { encryptSecret } = await import("@/server/crypto");
    await db.integrationCredential.create({ data: { ...t.scope, integrationId: integration.id, accountId: null, accessTokenEnc: encryptSecret("AQX-token"), expiresAt: new Date(Date.now() + 86_400_000) } });
    const spy = vi.spyOn(SOCIAL_PROVIDERS.linkedin, "publishPost").mockResolvedValue({ externalId: "urn:li:share:777", permalink: "https://www.linkedin.com/feed/update/urn:li:share:777" });
    const { publishTestPost, TEST_POST_TEXT } = await import("@/server/integrations/diagnostics");
    const r = await publishTestPost(t.scope, t.user.id, account.id, "PUBLISH");
    expect(r.externalId).toBe("urn:li:share:777");
    expect(spy).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ caption: TEST_POST_TEXT, format: "LINKEDIN_POST" }));
    const post = await db.socialPost.findFirstOrThrow({ where: { ...t.scope, externalId: "urn:li:share:777" } });
    expect(post).toMatchObject({ platform: "LINKEDIN", integrationAccountId: account.id });
    const v = await db.providerValidation.findFirstOrThrow({ where: { provider: "linkedin", check: "publish_test_post" } });
    expect(v.ok).toBe(true);
    expect((await providerReadiness()).find((x) => x.provider === "linkedin")!.liveTested).toBe(true);
    await expect(publishTestPost(t.scope, t.user.id, account.id, "publish")).rejects.toMatchObject({ code: "validation" });
    spy.mockRestore();
  });
});

describe("provider call observability", () => {
  it("records failed provider calls by host and path, never the query string", async () => {
    const { providerFetch } = await import("@/server/integrations/http");
    const { adminHealth } = await import("@/server/admin/queries");
    await db.providerCall.deleteMany({});
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { message: "boom" } }, 503)));
    await expect(providerFetch("https://graph.example.test/v21.0/123/feed?access_token=SECRET123")).rejects.toMatchObject({ kind: "unavailable" });
    await vi.waitFor(async () => expect(await db.providerCall.count()).toBe(1));
    const row = await db.providerCall.findFirstOrThrow();
    expect(row).toMatchObject({ host: "graph.example.test", path: "/v21.0/123/feed", status: 503, kind: "unavailable", method: "GET" });
    expect(JSON.stringify(row)).not.toContain("SECRET123");
    const h = await adminHealth();
    expect(h.providerFailures[0]).toMatchObject({ host: "graph.example.test", count: 1 });
  });
});
