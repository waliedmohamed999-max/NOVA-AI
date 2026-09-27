import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { logger } from "@/server/logger";
import { makeTenant } from "../support/factory";
import { completeConnect, startConnect } from "@/server/integrations/service";
import { redirectUriFor } from "@/server/integrations/registry";
import { metaScopeConfig, parseScopes, upgradeScopes } from "@/server/integrations/providers/meta-scopes";
import { MetaProvider } from "@/server/integrations/providers/meta";
import { oauthDiagnostics } from "@/server/admin/oauth-diagnostics";
import { approveContent, createContentFromPlan } from "@/server/content/service";
import { publishOne } from "@/server/social/publishing";
import { offlinePost } from "@/server/agents/offline-content";
import { loadBrain } from "@/server/agents/brain";
import { parseConnectFlash } from "@/server/integrations/connections";

const env = (vars: Record<string, string>) => {
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
};
let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let calls: { url: string; method: string; body: string }[] = [];
function mockFetch(routes: [RegExp, () => { status?: number; body?: unknown }, string?][]) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? String(init.body) : "" });
    const r = routes.find(([re, , m]) => re.test(url) && (!m || m === method));
    if (!r) return new Response(JSON.stringify({ error: { message: `unmocked ${url}` } }), { status: 500 });
    const out = r[1]();
    return new Response(out.body === undefined ? "" : JSON.stringify(out.body), { status: out.status ?? 200 });
  }));
}
const metaExchange = (granted: string[], pages: unknown[] = []): [RegExp, () => { body: unknown }, string?][] => [
  [/oauth\/access_token\?.*code=/, () => ({ body: { access_token: "short" } })],
  [/oauth\/access_token\?.*fb_exchange_token/, () => ({ body: { access_token: "long", expires_in: 5_000_000 } })],
  [/\/me\/permissions/, () => ({ body: { data: granted.map((permission) => ({ permission, status: "granted" })) } }), "GET"],
  [/\/me\/accounts/, () => ({ body: { data: pages } })],
];

describe("LinkedIn exact redirect URI", () => {
  it("uses the configured callback literally in the authorization request and the token exchange", async () => {
    restore = env({ LINKEDIN_REDIRECT_URI: "http://localhost:3000/api/integrations/linkedin/callback" });
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "linkedin", "settings"));
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/integrations/linkedin/callback");
    mockFetch([
      [/oauth\/v2\/accessToken/, () => ({ body: { access_token: "a", expires_in: 3600, scope: "openid,profile,email,w_member_social" } })],
      [/v2\/userinfo/, () => ({ body: { sub: "x", name: "Member" } })],
    ]);
    await completeConnect("linkedin", { code: "c", state: url.searchParams.get("state") }, t.user.id);
    const exchange = calls.find((c) => c.url.includes("oauth/v2/accessToken"))!;
    expect(new URLSearchParams(exchange.body).get("redirect_uri")).toBe(url.searchParams.get("redirect_uri"));
  });

  it("rejects an in-app page (settings) or a URI with a query as the OAuth callback", () => {
    for (const bad of ["http://localhost:3000/settings/connected-accounts", "http://localhost:3000/api/integrations/linkedin/callback?x=1", "http://localhost:3000/api/integrations/linkedin/callback/"]) {
      restore = env({ LINKEDIN_REDIRECT_URI: bad });
      expect(() => redirectUriFor("linkedin")).toThrow(/must be/);
      restore();
      restore = null;
    }
  });

  it("strips stray quotes/whitespace from .env but otherwise keeps the exact string", () => {
    restore = env({ LINKEDIN_REDIRECT_URI: ' "http://localhost:3000/api/integrations/linkedin/callback" ' });
    expect(redirectUriFor("linkedin")).toBe("http://localhost:3000/api/integrations/linkedin/callback");
  });
});

describe("Meta configured scopes", () => {
  it("minimal mode (default) requests only public_profile — none of the advanced permissions", () => {
    restore = env({ META_PERMISSION_MODE: "", META_OAUTH_SCOPES: "" });
    const url = new URL(new MetaProvider().connect({ state: "s", redirectUri: "http://localhost:3000/api/integrations/meta/callback" }));
    expect(url.searchParams.get("scope")).toBe("public_profile");
    for (const s of ["pages_manage_posts", "read_insights", "instagram_content_publish", "instagram_manage_insights", "business_management"]) expect(url.searchParams.get("scope")).not.toContain(s);
  });

  it("parses, de-duplicates and validates META_OAUTH_SCOPES, never adding scopes silently", () => {
    expect(parseScopes(" pages_show_list, pages_show_list instagram_basic,manage_pages,  Bad-Scope ")).toEqual({ scopes: ["pages_show_list", "instagram_basic"], rejected: ["manage_pages", "bad-scope"] });
    restore = env({ META_PERMISSION_MODE: "minimal", META_OAUTH_SCOPES: "pages_show_list" });
    expect(metaScopeConfig().requested).toEqual(["public_profile", "pages_show_list"]);
    restore();
    restore = env({ META_PERMISSION_MODE: "configured", META_OAUTH_SCOPES: "pages_show_list,instagram_basic" });
    expect(metaScopeConfig().requested).toEqual(["pages_show_list", "instagram_basic"]);
    expect(new URL(new MetaProvider().connect({ state: "s", redirectUri: "x" })).searchParams.get("scope")).toBe("pages_show_list,instagram_basic");
  });

  it("uses a Login for Business configuration id instead of scope when set", () => {
    restore = env({ META_LOGIN_CONFIG_ID: "123456789" });
    const url = new URL(new MetaProvider().connect({ state: "s", redirectUri: "x" }));
    expect(url.searchParams.get("config_id")).toBe("123456789");
    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("records requested scopes on the attempt and shows them in admin diagnostics", async () => {
    restore = env({ META_OAUTH_SCOPES: "pages_show_list" });
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "meta", "onboarding"));
    mockFetch(metaExchange(["public_profile", "pages_show_list"]));
    await completeConnect("meta", { code: "c", state: url.searchParams.get("state") }, t.user.id);
    const diag = (await oauthDiagnostics(t.organization.id)).find((d) => d.id === "meta")!;
    expect(diag.requested).toEqual(["public_profile", "pages_show_list"]);
    expect(diag.lastAttempt).toMatchObject({ outcome: "identity_connected", granted: ["public_profile", "pages_show_list"], missing: [] });
    expect(diag.assets).toMatchObject({ identity: true, pages: 0, instagram: null });
    const fbPublish = diag.capabilities.find((c) => c.platform === "FACEBOOK" && c.capability === "publish")!;
    expect(fbPublish.status).toBe("not_enabled");
    expect(diag.capabilities.find((c) => c.platform === "FACEBOOK" && c.capability === "discovery")!.status).toBe("available");
    expect(JSON.stringify(diag)).not.toMatch(/0123456789abcdef0123456789abcdef|"long"|"short"/);
  });
});

describe("Meta minimal mode live-flow outcomes", () => {
  it("OAuth reaches NOVA with only public_profile: identity connected (not a failure), no Page discovery call", async () => {
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "meta", "onboarding"));
    mockFetch(metaExchange(["public_profile"]));
    const res = await completeConnect("meta", { code: "c", state: url.searchParams.get("state") }, t.user.id);
    expect(res).toMatchObject({ redirectTo: "/onboarding/connect", identity: true });
    expect(res.error).toBeUndefined();
    expect(calls.some((c) => c.url.includes("/me/accounts"))).toBe(false);
    const attempt = await db.oAuthState.findFirstOrThrow({ where: { organizationId: t.organization.id } });
    expect(attempt).toMatchObject({ requestedScopes: ["public_profile"], grantedScopes: ["public_profile"], outcome: "identity_connected" });
  });
});

describe("invalid scope handling", () => {
  it("maps Meta's invalid_scope to a plain message and logs the requested scopes (no page of technical errors)", async () => {
    const warn = vi.spyOn(logger, "warn");
    restore = env({ META_OAUTH_SCOPES: "pages_show_list" });
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "meta", "settings"));
    const res = await completeConnect("meta", { code: null, state: url.searchParams.get("state"), error: "invalid_scope", errorDescription: "Invalid Scopes: pages_manage_posts" }, t.user.id);
    expect(res).toEqual({ redirectTo: "/settings/connected-accounts", error: "meta_invalid_scope" });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ provider: "meta", error_type: "invalid_scope", requested_scopes: ["public_profile", "pages_show_list"] }), expect.any(String));
    expect((await db.oAuthState.findFirstOrThrow({ where: { organizationId: t.organization.id } })).outcome).toBe("invalid_scope");
  });

  it("LinkedIn unauthorized_scope_error is handled the same way", async () => {
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "linkedin", "onboarding"));
    const res = await completeConnect("linkedin", { code: null, state: url.searchParams.get("state"), error: "unauthorized_scope_error", errorDescription: "Scope \"r_x\" is not authorized" }, t.user.id);
    expect(res.error).toBe("linkedin_invalid_scope");
  });

  it("a plain cancel is still oauth_denied", async () => {
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "meta"));
    expect((await completeConnect("meta", { code: null, state: url.searchParams.get("state"), error: "access_denied" }, t.user.id)).error).toBe("oauth_denied");
  });
});

describe("capabilities follow granted scopes", () => {
  it("Facebook publishing is false when pages_manage_posts wasn't granted", async () => {
    restore = env({ META_OAUTH_SCOPES: "pages_show_list" });
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "meta"));
    mockFetch(metaExchange(["public_profile", "pages_show_list"], [{ id: "p1", name: "Luma", access_token: "pt", tasks: ["MANAGE", "CREATE_CONTENT", "ANALYZE"] }]));
    await completeConnect("meta", { code: "c", state: url.searchParams.get("state") }, t.user.id);
    const acc = await db.integrationAccount.findFirstOrThrow({ where: { organizationId: t.organization.id, platform: "FACEBOOK" } });
    const caps = Object.fromEntries(((acc.metadata as { capabilities: { key: string; available: boolean }[] }).capabilities).map((c) => [c.key, c.available]));
    expect(caps).toMatchObject({ identity: true, publish: false, metrics: false });
  });
});

describe("reauthorization for an extra permission", () => {
  async function connectedPage() {
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "meta"));
    mockFetch(metaExchange(["public_profile", "pages_show_list"], [{ id: "p1", name: "Luma", access_token: "pt", tasks: ["CREATE_CONTENT"] }]));
    await completeConnect("meta", { code: "c", state: url.searchParams.get("state") }, t.user.id);
    return t;
  }

  it("requests only the configured scopes plus what the capability needs, with auth_type=rerequest", async () => {
    restore = env({ META_OAUTH_SCOPES: "pages_show_list", META_OPTIONAL_SCOPES: "pages_manage_posts" });
    const t = await connectedPage();
    const url = new URL(await startConnect(t.scope, t.user.id, "meta", "settings", { platform: "FACEBOOK", capability: "publish" }));
    expect(url.searchParams.get("scope")!.split(",").sort()).toEqual(["pages_manage_posts", "pages_show_list", "public_profile"]);
    expect(url.searchParams.get("auth_type")).toBe("rerequest");
    const attempt = await db.oAuthState.findFirstOrThrow({ where: { organizationId: t.organization.id }, orderBy: { createdAt: "desc" } });
    expect(attempt.requestedScopes).toContain("pages_manage_posts");
  });

  it("refuses to request a permission the operator hasn't enabled for the app", async () => {
    restore = env({ META_OAUTH_SCOPES: "pages_show_list", META_OPTIONAL_SCOPES: "" });
    const t = await connectedPage();
    await expect(startConnect(t.scope, t.user.id, "meta", "settings", { platform: "INSTAGRAM", capability: "instagram_publishing" })).rejects.toMatchObject({ code: "capability_unavailable" });
    expect(upgradeScopes("FACEBOOK", "not_a_capability")).toBeNull();
  });

  it("publishing without the permission fails gracefully and points to the grant flow — no API call", async () => {
    restore = env({ META_OAUTH_SCOPES: "pages_show_list", META_OPTIONAL_SCOPES: "pages_manage_posts" });
    const t = await connectedPage();
    await db.integrationAccount.updateMany({ where: { organizationId: t.organization.id }, data: { isActive: true } });
    const b = await loadBrain(t.scope);
    const [id] = await createContentFromPlan(t.scope, [{ ...offlinePost(b, 0, { platform: "FACEBOOK" }), dayOffset: 1 }], { agent: "CONTENT_STRATEGIST", startDate: new Date(), generatedBy: "test" });
    await approveContent(t.scope, [id], { userId: t.user.id });
    const pub = await db.socialPublication.findFirstOrThrow({ where: { contentItemId: id } });
    calls = [];
    expect(await publishOne(pub.id)).toBe("failed");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect((await db.socialPublication.findUniqueOrThrow({ where: { id: pub.id } })).error).toBe("permission_required");
    const n = await db.notification.findFirstOrThrow({ where: { organizationId: t.organization.id, type: "PUBLISHING_FAILED" } });
    expect(n.link).toBe("/settings/connected-accounts?upgrade=FACEBOOK:publish");
    expect(parseConnectFlash({ upgrade: "FACEBOOK:publish" }).upgrade).toEqual({ platform: "FACEBOOK", capability: "publish" });
    expect(parseConnectFlash({ upgrade: "https://evil" }).upgrade).toBeNull();
  });
});
