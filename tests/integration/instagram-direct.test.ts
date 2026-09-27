import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { checkConnectionsHealth, completeConnect, disconnectIntegration, startConnect } from "@/server/integrations/service";
import { loadConnections } from "@/server/integrations/connections";
import { InstagramProvider, instagramCredentialProblem } from "@/server/integrations/providers/instagram";
import { redirectUriFor, SOCIAL_PROVIDERS } from "@/server/integrations/registry";
import { providerIdFor } from "@/server/integrations/service";
import { oauthDiagnostics } from "@/server/admin/oauth-diagnostics";
import { providerConfigStatus } from "@/server/admin/providers";

/**
 * Instagram Direct = Instagram API with Instagram Login. Its own provider: no Facebook Page,
 * no pages_show_list, Business/Creator accounts only. Provider HTTP is mocked (no live calls in tests).
 */
let calls: { url: string; method: string; body: string }[] = [];
function mockIg(opts: { accountType?: string; permissions?: string | string[]; flat?: boolean; meStatus?: number } = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? String(init.body) : "" });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url.startsWith("https://api.instagram.com/oauth/access_token")) {
      const short = { access_token: "IGshort", user_id: 17841400000000001, permissions: opts.permissions ?? "instagram_business_basic" };
      return json(opts.flat ? short : { data: [short] });
    }
    if (url.startsWith("https://graph.instagram.com/access_token")) return json({ access_token: "IGlong", token_type: "bearer", expires_in: 5_183_944 });
    if (url.startsWith("https://graph.instagram.com/refresh_access_token")) return json({ access_token: "IGrefreshed", expires_in: 5_183_944 });
    if (/graph\.instagram\.com\/v[\d.]+\/me\?/.test(url)) {
      if (opts.meStatus) return json({ error: { message: "Error validating access token", type: "OAuthException", code: 190 } }, opts.meStatus);
      return json({ id: "app-scoped-1", user_id: "17841400000000001", username: "lumaskin", name: "Luma Skin Studio", account_type: opts.accountType ?? "BUSINESS", profile_picture_url: "https://cdn.example/p.jpg", followers_count: 1200, media_count: 48 });
    }
    if (/\/17841400000000001\/media_publish/.test(url)) return json({ id: "media-99" });
    if (/\/17841400000000001\/media$/.test(url)) return json({ id: "container-1" });
    if (/\/media-99\?/.test(url)) return json({ permalink: "https://www.instagram.com/p/abc/" });
    return json({ error: { message: `unmocked ${url}` } }, 500);
  }));
}

const saved: Record<string, string | undefined> = {};
function env(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in saved)) saved[k] = process.env[k];
    process.env[k] = v;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
});

async function connectIg(t: Awaited<ReturnType<typeof makeTenant>>, upgrade?: { platform: string; capability: string }) {
  const url = new URL(await startConnect(t.scope, t.user.id, "instagram", "onboarding", upgrade));
  return { url, res: await completeConnect("instagram", { code: "AQD-code#_", state: url.searchParams.get("state") }, t.user.id) };
}

describe("Instagram Direct — architecture", () => {
  it("is its own provider: INSTAGRAM maps to instagram, FACEBOOK stays with Meta (Pages only)", () => {
    expect(providerIdFor("INSTAGRAM")).toBe("instagram");
    expect(providerIdFor("FACEBOOK")).toBe("meta");
    expect(SOCIAL_PROVIDERS.meta.platforms).toEqual(["FACEBOOK"]);
    expect(SOCIAL_PROVIDERS.instagram.platforms).toEqual(["INSTAGRAM"]);
  });
});

describe("Instagram Direct — OAuth", () => {
  it("start: Instagram authorize URL, Instagram app id, business scopes only — never pages_show_list", async () => {
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "instagram", "settings"));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("5555555555555555");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/integrations/instagram/callback");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic");
    expect(url.searchParams.get("enable_fb_login")).toBe("0");
    expect(url.toString()).not.toMatch(/pages_show_list|facebook\.com|abcdef0123456789abcdef0123456789/);
  });

  it("callback: server-side code exchange + long-lived token, Business account connected with honest capabilities", async () => {
    mockIg();
    const t = await makeTenant();
    const { res } = await connectIg(t);
    expect(res).toMatchObject({ redirectTo: "/onboarding/connect", connected: ["INSTAGRAM"], needsSelection: [] });
    const exchange = calls.find((c) => c.url.startsWith("https://api.instagram.com/oauth/access_token"))!;
    const form = new URLSearchParams(exchange.body);
    expect(form.get("client_secret")).toBe("abcdef0123456789abcdef0123456789");
    expect(form.get("code")).toBe("AQD-code"); // trailing "#_" stripped
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(calls.some((c) => c.url.includes("ig_exchange_token"))).toBe(true);
    expect(calls.some((c) => c.url.includes("facebook.com"))).toBe(false);

    const ig = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "INSTAGRAM")!;
    expect(ig).toMatchObject({ state: "connected", professionalType: "BUSINESS" });
    expect(ig.accounts[0]).toMatchObject({ handle: "@lumaskin", isActive: true });
    const caps = Object.fromEntries(ig.accounts[0].capabilities!.map((c) => [c.key, c.available]));
    expect(caps).toEqual({ identity: true, instagram_publishing: false, metrics: false, comments: false, messages: false });
    const integration = await db.integration.findFirstOrThrow({ where: { ...t.scope, provider: "INSTAGRAM" } });
    expect(integration.scopes).toEqual(["instagram_business_basic"]);
    const cred = await db.integrationCredential.findFirstOrThrow({ where: { integrationId: integration.id }, omit: { accessTokenEnc: false } });
    expect(cred.accessTokenEnc).not.toContain("IGlong");
    expect(JSON.stringify(await loadConnections(t.scope, false))).not.toMatch(/IGlong|IGshort/);
  });

  it("Creator accounts are supported; permissions granted for publishing light up the capability", async () => {
    mockIg({ accountType: "MEDIA_CREATOR", permissions: ["instagram_business_basic", "instagram_business_content_publish"], flat: true });
    env({ INSTAGRAM_OAUTH_SCOPES: "instagram_business_content_publish" });
    const t = await makeTenant();
    const { url } = await connectIg(t);
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish");
    const ig = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "INSTAGRAM")!;
    expect(ig.professionalType).toBe("CREATOR");
    expect(ig.accounts[0].capabilities!.find((c) => c.key === "instagram_publishing")!.available).toBe(true);
  });

  it("a personal Instagram account is refused with a plain message — no fake support", async () => {
    mockIg({ accountType: "PERSONAL" });
    const t = await makeTenant();
    const { res } = await connectIg(t);
    expect(res.error).toBe("instagram_personal_account");
    expect(await db.integration.count({ where: { ...t.scope, provider: "INSTAGRAM" } })).toBe(0);
    expect((await db.oAuthState.findFirstOrThrow({ where: { organizationId: t.organization.id } })).outcome).toBe("personal_account");
  });

  it("retired permission names are ignored and the redirect URI must be the Instagram callback", () => {
    env({ INSTAGRAM_OAUTH_SCOPES: "business_basic,instagram_business_manage_insights,pages_show_list" });
    expect(new InstagramProvider().scopes).toEqual(["instagram_business_basic", "instagram_business_manage_insights"]);
    env({ INSTAGRAM_REDIRECT_URI: "http://localhost:3000/settings/connected-accounts" });
    expect(() => redirectUriFor("instagram")).toThrow();
    env({ INSTAGRAM_REDIRECT_URI: "http://localhost:3000/api/integrations/instagram/callback" });
    expect(redirectUriFor("instagram")).toBe("http://localhost:3000/api/integrations/instagram/callback");
  });
});

describe("Instagram Direct — permission upgrade, publishing, health, disconnect", () => {
  it("publishing permission is requested on demand only when enabled for the app", async () => {
    mockIg();
    const t = await makeTenant();
    await connectIg(t);
    await expect(startConnect(t.scope, t.user.id, "instagram", "settings", { platform: "INSTAGRAM", capability: "instagram_publishing" })).rejects.toMatchObject({ code: "capability_unavailable" });
    env({ INSTAGRAM_OPTIONAL_SCOPES: "instagram_business_content_publish" });
    const url = new URL(await startConnect(t.scope, t.user.id, "instagram", "settings", { platform: "INSTAGRAM", capability: "instagram_publishing" }));
    expect(url.searchParams.get("scope")!.split(",").sort()).toEqual(["instagram_business_basic", "instagram_business_content_publish"]);
    expect(url.searchParams.get("force_reauth")).toBe("true");
  });

  it("publishes an image through graph.instagram.com (container → media_publish)", async () => {
    mockIg();
    const res = await new InstagramProvider().publishPost({ externalId: "17841400000000001", accountType: "instagram_login", metadata: {} }, { accessToken: "IGlong" }, { format: "POST", caption: "Hello", mediaUrls: ["https://cdn.example/a.jpg"] });
    expect(res).toEqual({ externalId: "media-99", permalink: "https://www.instagram.com/p/abc/" });
    expect(calls.every((c) => c.url.startsWith("https://graph.instagram.com/"))).toBe(true);
    await expect(new InstagramProvider().publishPost({ externalId: "1", metadata: {} }, { accessToken: "x" }, { format: "POST", caption: "text only", mediaUrls: [] })).rejects.toMatchObject({ kind: "invalid_media" });
  });

  it("health check marks an invalid token as expired; refresh uses ig_refresh_token", async () => {
    mockIg();
    const t = await makeTenant();
    await connectIg(t);
    const id = (await db.integration.findFirstOrThrow({ where: { ...t.scope, provider: "INSTAGRAM" } })).id;
    mockIg({ meStatus: 400 });
    await db.integration.update({ where: { id }, data: { lastCheckedAt: new Date(0) } });
    await checkConnectionsHealth(1000);
    expect((await db.integration.findUniqueOrThrow({ where: { id } })).status).toBe("EXPIRED");
    mockIg();
    const next = await new InstagramProvider().refreshToken({ accessToken: "IGlong" });
    expect(next?.accessToken).toBe("IGrefreshed");
    expect(calls[0].url).toContain("grant_type=ig_refresh_token");
  });

  it("disconnect removes Instagram's token without touching a Facebook identity/Page connection", async () => {
    mockIg();
    const t = await makeTenant();
    await connectIg(t);
    await db.integration.create({ data: { ...t.scope, provider: "FACEBOOK", status: "CONNECTED", statusMessage: "identity_only", scopes: ["public_profile"] } });
    const id = (await db.integration.findFirstOrThrow({ where: { ...t.scope, provider: "INSTAGRAM" } })).id;
    await disconnectIntegration(t.scope, id, t.user.id);
    expect(await db.integrationCredential.count({ where: { integrationId: id } })).toBe(0);
    expect((await db.integration.findFirstOrThrow({ where: { ...t.scope, provider: "FACEBOOK" } })).status).toBe("CONNECTED");
    const view = await loadConnections(t.scope, false);
    expect(view.cards.find((c) => c.platform === "INSTAGRAM")!.state).toBe("idle");
    expect(view.cards.find((c) => c.platform === "FACEBOOK")!.state).toBe("identity");
  });
});

describe("Instagram Direct — configuration and diagnostics", () => {
  it("missing or wrong-format credentials make it unavailable; never shows the value", async () => {
    env({ INSTAGRAM_APP_SECRET: "IGAAB" + "z".repeat(150) });
    expect(instagramCredentialProblem()).toBe("secret_is_access_token");
    expect(new InstagramProvider().isConfigured()).toBe(false);
    const row = providerConfigStatus().find((r) => r.key === "instagram")!;
    expect(row).toMatchObject({ status: "error", note: "instagram_secret_is_access_token" });
    expect(JSON.stringify(row)).not.toContain("IGAAB");
    env({ INSTAGRAM_APP_ID: "" });
    const t = await makeTenant();
    expect((await loadConnections(t.scope, false)).cards.find((c) => c.platform === "INSTAGRAM")!.state).toBe("unavailable");
  });

  it("admin diagnostics show the connected professional account, granted scopes and capabilities", async () => {
    mockIg();
    const t = await makeTenant();
    await connectIg(t);
    const d = (await oauthDiagnostics(t.organization.id)).find((x) => x.id === "instagram")!;
    expect(d.instagramAccount).toEqual({ connected: true, handle: "@lumaskin", type: "BUSINESS", selected: true });
    expect(d.lastAttempt).toMatchObject({ outcome: "connected", granted: ["instagram_business_basic"] });
    expect(d.capabilities.find((c) => c.capability === "instagram_publishing")!.status).toBe("not_enabled");
    expect(JSON.stringify(d)).not.toMatch(/IGlong|abcdef0123456789abcdef0123456789/);
  });
});
