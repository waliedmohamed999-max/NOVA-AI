import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { checkConnectionsHealth, completeConnect, disconnectIntegration, selectAccountsBatch, startConnect, CONNECTED_ACCOUNTS_PATH } from "@/server/integrations/service";
import { loadConnections } from "@/server/integrations/connections";
import { publishTestPost, testConnection, TEST_POST_TEXT } from "@/server/integrations/diagnostics";
import { redirectUriFor } from "@/server/integrations/registry";
import { MetaProvider } from "@/server/integrations/providers/meta";
import { LinkedInProvider } from "@/server/integrations/providers/linkedin";

// ── Mocked provider HTTP (no real Meta/LinkedIn accounts are available in this environment) ──
type Route = [RegExp, (url: string, init?: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> }, string?];
let calls: { url: string; method: string; body: string }[] = [];
function mockFetch(routes: Route[]) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? String(init.body) : "" });
      const r = routes.find(([re, , m]) => re.test(url) && (!m || m === method));
      if (!r) return new Response(JSON.stringify({ error: { message: `unmocked ${method} ${url}` } }), { status: 500 });
      const out = r[1](url, init);
      return new Response(out.body === undefined ? "" : JSON.stringify(out.body), { status: out.status ?? 200, headers: out.headers });
    }),
  );
}

const ENV = {
  META_APP_ID: "9876543210987654",
  META_APP_SECRET: "fedcba9876543210fedcba9876543210",
  META_REDIRECT_URI: "https://nova.example/api/integrations/meta/callback",
  META_PERMISSION_MODE: "configured",
  META_OAUTH_SCOPES: "pages_show_list,pages_read_engagement,pages_manage_posts,read_insights,business_management",
  META_OPTIONAL_SCOPES: "",
  META_LOGIN_CONFIG_ID: "",
  LINKEDIN_CLIENT_ID: "li-client",
  LINKEDIN_CLIENT_SECRET: "li-secret",
  LINKEDIN_REDIRECT_URI: "https://nova.example/api/integrations/linkedin/callback",
};
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
afterEach(() => vi.unstubAllGlobals());

const META_GRANTED = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "read_insights", "business_management"];

function metaRoutes(opts: { granted?: string[]; pages?: unknown[]; debugValid?: boolean } = {}): Route[] {
  const pages = opts.pages ?? [
    { id: "page-1", name: "Luma Skin Studio", access_token: "page-token-1", tasks: ["MANAGE", "CREATE_CONTENT", "ANALYZE"] },
    { id: "page-2", name: "Luma Clinic Offers", access_token: "page-token-2", tasks: ["ANALYZE"] }, // no posting role
  ];
  return [
    [/oauth\/access_token\?.*code=/, () => ({ body: { access_token: "short-user-token" } })],
    [/oauth\/access_token\?.*fb_exchange_token/, () => ({ body: { access_token: "long-user-token", expires_in: 5_184_000 } })],
    [/\/me\/permissions/, () => ({ body: { data: [...(opts.granted ?? META_GRANTED).map((p) => ({ permission: p, status: "granted" })), { permission: "pages_messaging", status: "declined" }] } }), "GET"],
    [/\/me\/permissions/, () => ({ body: { success: true } }), "DELETE"],
    [/\/me\/accounts/, () => ({ body: { data: pages } })],
    [/\/debug_token/, () => ({ body: { data: { is_valid: opts.debugValid ?? true, expires_at: Math.floor(Date.now() / 1000) + 86400 * 50, scopes: opts.granted ?? META_GRANTED } } })],
    [/\/me\?/, () => ({ body: { id: "fb-user-1", name: "Sara Admin" } })],
    [/\/page-1\/feed/, () => ({ body: { id: "page-1_post-77" } }), "POST"],
  ];
}

async function connectMeta(t: Awaited<ReturnType<typeof makeTenant>>, from: "onboarding" | "settings" = "onboarding") {
  const url = new URL(await startConnect(t.scope, t.user.id, "meta", from));
  return { url, res: await completeConnect("meta", { code: "auth-code", state: url.searchParams.get("state") }, t.user.id) };
}

describe("Facebook Pages (Meta) — OAuth", () => {
  it("start: authorization URL uses the configured redirect URI, a fresh state and only configured scopes", async () => {
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "meta", "onboarding"));
    expect(url.origin + url.pathname).toMatch(/^https:\/\/www\.facebook\.com\/v[\d.]+\/dialog\/oauth$/);
    expect(url.searchParams.get("client_id")).toBe("9876543210987654");
    expect(url.searchParams.get("redirect_uri")).toBe(ENV.META_REDIRECT_URI);
    expect(url.searchParams.get("state")?.length).toBeGreaterThan(20);
    const scopes = url.searchParams.get("scope")!.split(",");
    expect(scopes).toContain("pages_manage_posts");
    for (const s of ["pages_messaging", "leads_retrieval"]) expect(scopes).not.toContain(s);
    expect(url.toString()).not.toContain("fedcba9876543210fedcba9876543210");
  });

  it("callback: exchanges server-side, stores encrypted tokens, returns Pages only (no Instagram children), selects none", async () => {
    mockFetch(metaRoutes());
    const t = await makeTenant();
    const { res } = await connectMeta(t);
    expect(res.redirectTo).toBe("/onboarding/connect");
    expect(res.connected).toEqual(["FACEBOOK"]);
    expect(res.needsSelection).toEqual(["FACEBOOK"]);
    expect(calls.some((c) => c.url.includes("oauth/access_token") && c.url.includes("client_secret=fedcba9876543210fedcba9876543210"))).toBe(true);
    // Instagram is not discovered through Pages anymore.
    expect(decodeURIComponent(calls.find((c) => c.url.includes("/me/accounts"))!.url)).not.toContain("instagram_business_account");

    const view = await loadConnections(t.scope, false);
    const fb = view.cards.find((c) => c.platform === "FACEBOOK")!;
    expect(fb.state).toBe("choose");
    expect(fb.accounts.map((a) => a.name)).toEqual(["Luma Skin Studio", "Luma Clinic Offers"]);
    expect(view.cards.find((c) => c.platform === "INSTAGRAM")!.state).toBe("idle");
    expect(await db.integration.count({ where: { ...t.scope, provider: "INSTAGRAM" } })).toBe(0);

    const creds = await db.integrationCredential.findMany({ where: { organizationId: t.organization.id }, omit: { accessTokenEnc: false } });
    expect(creds.length).toBeGreaterThan(0);
    for (const c of creds) expect(c.accessTokenEnc).not.toMatch(/token/);
    expect(JSON.stringify(view)).not.toMatch(/page-token|long-user-token|fedcba9876543210fedcba9876543210/);
    const integration = await db.integration.findFirstOrThrow({ where: { ...t.scope, provider: "FACEBOOK" } });
    expect(integration.scopes).not.toContain("pages_messaging"); // declined ≠ granted
  });

  it("Page capabilities come from granted permissions and Page roles — never assumed", async () => {
    mockFetch(metaRoutes());
    const t = await makeTenant();
    await connectMeta(t);
    const fb = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "FACEBOOK")!;
    const caps = (name: string) => Object.fromEntries(fb.accounts.find((a) => a.name === name)!.capabilities!.map((c) => [c.key, c.available]));
    expect(caps("Luma Skin Studio")).toMatchObject({ identity: true, publish: true, metrics: true, messages: false, leads: false });
    expect(caps("Luma Clinic Offers")).toMatchObject({ publish: false }); // ANALYZE-only role
  });

  it("state validation: forged, replayed and another user's state are rejected", async () => {
    mockFetch(metaRoutes());
    const t = await makeTenant();
    const other = await makeTenant("Other");
    await expect(completeConnect("meta", { code: "c", state: "forged" }, t.user.id)).rejects.toMatchObject({ code: "oauth_state" });
    const url = new URL(await startConnect(t.scope, t.user.id, "meta"));
    const state = url.searchParams.get("state");
    await expect(completeConnect("meta", { code: "c", state }, other.user.id)).rejects.toMatchObject({ code: "oauth_state" }); // login-CSRF
    await expect(completeConnect("meta", { code: "c", state }, t.user.id)).rejects.toMatchObject({ code: "oauth_state" }); // consumed by the attempt above
    expect(await db.integration.count({ where: { organizationId: other.organization.id } })).toBe(0);
  });
});

describe("Facebook Pages — picker", () => {
  it("activates exactly the chosen Page; choosing none is rejected", async () => {
    mockFetch(metaRoutes());
    const t = await makeTenant();
    await connectMeta(t);
    const fb = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "FACEBOOK")!;
    await expect(selectAccountsBatch(t.scope, t.user.id, [{ integrationId: fb.integrationId!, accountIds: [] }])).rejects.toMatchObject({ code: "validation" });
    const page1 = fb.accounts.find((a) => a.name === "Luma Skin Studio")!.id;
    await selectAccountsBatch(t.scope, t.user.id, [{ integrationId: fb.integrationId!, accountIds: [page1] }]);
    const after = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "FACEBOOK")!;
    expect(after.state).toBe("connected");
    expect(after.accounts.filter((a) => a.isActive).map((a) => a.name)).toEqual(["Luma Skin Studio"]);
  });

  it("rejects selections across tenants", async () => {
    mockFetch(metaRoutes());
    const a = await makeTenant("A");
    const b = await makeTenant("B");
    await connectMeta(a);
    const fb = (await loadConnections(a.scope, false)).cards.find((c) => c.platform === "FACEBOOK")!;
    await expect(selectAccountsBatch(b.scope, b.user.id, [{ integrationId: fb.integrationId!, accountIds: [fb.accounts[0].id] }])).rejects.toMatchObject({ code: "item_not_found" });
  });
});

describe("Facebook Pages — disconnect, health, missing credentials", () => {
  it("disconnect revokes the Meta grant, deletes credentials and keeps history", async () => {
    mockFetch(metaRoutes());
    const t = await makeTenant();
    await connectMeta(t);
    const id = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "FACEBOOK")!.integrationId!;
    calls = [];
    await disconnectIntegration(t.scope, id, t.user.id);
    expect(calls.filter((c) => c.method === "DELETE" && c.url.includes("/me/permissions"))).toHaveLength(1);
    expect(await db.integrationCredential.count({ where: { organizationId: t.organization.id } })).toBe(0);
    expect(await db.integrationAccount.count({ where: { organizationId: t.organization.id } })).toBeGreaterThan(0); // history kept
    expect(await db.auditLog.count({ where: { organizationId: t.organization.id, action: "integration.disconnected" } })).toBe(1);
  });

  it("health check marks an invalid token as expired and notifies the customer", async () => {
    mockFetch(metaRoutes());
    const t = await makeTenant();
    await connectMeta(t);
    mockFetch(metaRoutes({ debugValid: false }));
    await db.integration.updateMany({ where: { organizationId: t.organization.id }, data: { lastCheckedAt: new Date(0) } });
    const res = await checkConnectionsHealth(1000);
    expect(res.unhealthy).toBeGreaterThan(0);
    const view = await loadConnections(t.scope, false);
    expect(view.cards.find((c) => c.platform === "FACEBOOK")!.state).toBe("reconnect");
    const n = await db.notification.findFirst({ where: { organizationId: t.organization.id, type: "INTEGRATION_DISCONNECTED" } });
    expect(n?.link).toBe(CONNECTED_ACCOUNTS_PATH);
    expect(n?.body).not.toMatch(/OAuthException|invalid_grant|401|token_expired/);
  });

  it("a Graph OAuthException (code 190) is classified as expired", async () => {
    mockFetch([[/\/me\/accounts/, () => ({ status: 400, body: { error: { type: "OAuthException", code: 190, message: "Error validating access token" } } })]]);
    await expect(new MetaProvider().listAccounts({ accessToken: "x" })).rejects.toMatchObject({ kind: "expired" });
  });

  it("missing credentials: not connectable, no env names leak", async () => {
    delete process.env.META_APP_SECRET;
    try {
      const t = await makeTenant();
      await expect(startConnect(t.scope, t.user.id, "meta")).rejects.toMatchObject({ code: "integration_not_configured" });
      const view = await loadConnections(t.scope, false);
      expect(view.cards.find((c) => c.platform === "FACEBOOK")!.state).toBe("unavailable");
    } finally {
      process.env.META_APP_SECRET = ENV.META_APP_SECRET;
    }
  });
});

describe("Facebook Pages — admin dev test", () => {
  it("validates the token, lists Pages with capabilities, and never returns tokens", async () => {
    mockFetch(metaRoutes());
    const t = await makeTenant();
    await connectMeta(t);
    const fbId = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "FACEBOOK")!.integrationId!;
    const res = await testConnection(t.scope, fbId);
    expect(res.valid).toBe(true);
    expect(res.accounts.map((a) => `${a.platform}:${a.name}`)).toEqual(["FACEBOOK:Luma Skin Studio", "FACEBOOK:Luma Clinic Offers"]);
    expect(res.scopes).toContain("pages_manage_posts");
    expect(JSON.stringify(res)).not.toMatch(/page-token|long-user-token|fedcba9876543210fedcba9876543210/);
    expect(calls.every((c) => c.method === "GET")).toBe(true); // testing never publishes
  });

  it("publishes the fixed test text only with explicit confirmation and records the external post id", async () => {
    mockFetch(metaRoutes());
    const t = await makeTenant();
    await connectMeta(t);
    const fb = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "FACEBOOK")!;
    const page1 = fb.accounts.find((a) => a.name === "Luma Skin Studio")!;
    await selectAccountsBatch(t.scope, t.user.id, [{ integrationId: fb.integrationId!, accountIds: [page1.id] }]);
    await expect(publishTestPost(t.scope, t.user.id, page1.id, "yes")).rejects.toMatchObject({ code: "validation" });

    const res = await publishTestPost(t.scope, t.user.id, page1.id, "PUBLISH");
    expect(res.externalId).toBe("page-1_post-77");
    const post = calls.find((c) => c.url.includes("/page-1/feed"))!;
    expect(new URLSearchParams(post.body).get("message")).toBe(TEST_POST_TEXT);
    const stored = await db.integrationAccount.findUniqueOrThrow({ where: { id: page1.id } });
    expect((stored.metadata as { testPosts: { externalId: string }[] }).testPosts.at(-1)?.externalId).toBe("page-1_post-77");

    const other = await makeTenant("Other");
    await expect(publishTestPost(other.scope, other.user.id, page1.id, "PUBLISH")).rejects.toMatchObject({ code: "item_not_found" });
  });
});

// ── LinkedIn ──
function linkedinRoutes(opts: { active?: boolean; userinfoStatus?: number } = {}): Route[] {
  return [
    [/oauth\/v2\/accessToken/, () => ({ body: { access_token: "li-access", expires_in: 5_184_000, scope: "email,openid,profile,w_member_social" } })],
    [/v2\/userinfo/, () => (opts.userinfoStatus ? { status: opts.userinfoStatus, body: { message: "Invalid access token" } } : { body: { sub: "abc123", name: "Omar Nasser", email: "omar@example.com", picture: "https://media.licdn.example/p.jpg" } })],
    [/oauth\/v2\/introspectToken/, () => ({ body: { active: opts.active ?? true, scope: "email,openid,profile,w_member_social", expires_at: Math.floor(Date.now() / 1000) + 86400 * 55, status: opts.active === false ? "revoked" : "active" } })],
    [/oauth\/v2\/revoke/, () => ({ body: {} })],
    [/rest\/posts/, () => ({ status: 201, headers: { "x-restli-id": "urn:li:share:7001" } })],
  ];
}

describe("LinkedIn — OAuth", () => {
  it("start: only openid profile email w_member_social, configured redirect URI", async () => {
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "linkedin", "settings"));
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(url.searchParams.get("scope")).toBe("openid profile email w_member_social");
    expect(url.searchParams.get("redirect_uri")).toBe(ENV.LINKEDIN_REDIRECT_URI);
    expect(redirectUriFor("linkedin")).toBe(ENV.LINKEDIN_REDIRECT_URI);
  });

  it("callback: exchanges code, fetches the member profile, stores scopes and capabilities, returns to settings", async () => {
    mockFetch(linkedinRoutes());
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "linkedin", "settings"));
    const res = await completeConnect("linkedin", { code: "li-code", state: url.searchParams.get("state") }, t.user.id);
    expect(res.redirectTo).toBe(CONNECTED_ACCOUNTS_PATH);
    expect(res.connected).toEqual(["LINKEDIN"]);
    const integration = await db.integration.findFirstOrThrow({ where: { ...t.scope, provider: "LINKEDIN" } });
    expect(integration.scopes.sort()).toEqual(["email", "openid", "profile", "w_member_social"]);
    const card = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "LINKEDIN")!;
    expect(card.state).toBe("connected");
    expect(card.accounts[0].name).toBe("Omar Nasser");
    expect(Object.fromEntries(card.accounts[0].capabilities!.map((c) => [c.key, c]))).toMatchObject({
      identity: { available: true },
      member_publishing: { available: true },
      organization_publishing: { available: false, reason: "requires_approval" },
    });
  });

  it("profile fetch and admin test: validates via introspection, shows the member and scopes, publishes only when confirmed", async () => {
    mockFetch(linkedinRoutes());
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "linkedin"));
    await completeConnect("linkedin", { code: "c", state: url.searchParams.get("state") }, t.user.id);
    expect((await new LinkedInProvider().getProfile({ accessToken: "li-access" })).name).toBe("Omar Nasser");
    const card = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "LINKEDIN")!;
    const res = await testConnection(t.scope, card.integrationId!);
    expect(res).toMatchObject({ valid: true, profile: { name: "Omar Nasser" } });
    expect(res.scopes).toContain("w_member_social");
    expect(calls.some((c) => c.url.includes("rest/posts"))).toBe(false);
    const posted = await publishTestPost(t.scope, t.user.id, card.accounts[0].id, "PUBLISH");
    expect(posted.externalId).toBe("urn:li:share:7001");
    expect(JSON.parse(calls.find((c) => c.url.includes("rest/posts"))!.body).commentary).toBe(TEST_POST_TEXT);
  });

  it("disconnect revokes at LinkedIn; expired/revoked tokens are detected", async () => {
    mockFetch(linkedinRoutes());
    const t = await makeTenant();
    const url = new URL(await startConnect(t.scope, t.user.id, "linkedin"));
    await completeConnect("linkedin", { code: "c", state: url.searchParams.get("state") }, t.user.id);
    const id = (await db.integration.findFirstOrThrow({ where: { ...t.scope, provider: "LINKEDIN" } })).id;

    mockFetch(linkedinRoutes({ active: false }));
    await db.integration.update({ where: { id }, data: { lastCheckedAt: new Date(0) } });
    await checkConnectionsHealth(1000);
    expect((await db.integration.findUniqueOrThrow({ where: { id } })).status).toBe("EXPIRED");

    mockFetch(linkedinRoutes({ userinfoStatus: 401 }));
    await expect(new LinkedInProvider().getProfile({ accessToken: "dead" })).rejects.toMatchObject({ kind: "expired" });

    mockFetch(linkedinRoutes());
    await disconnectIntegration(t.scope, id, t.user.id);
    expect(calls.some((c) => c.url.includes("oauth/v2/revoke") && c.body.includes("client_secret=li-secret"))).toBe(true);
    expect((await db.integration.findUniqueOrThrow({ where: { id } })).status).toBe("DISCONNECTED");
  });

  it("missing credentials: not connectable", async () => {
    delete process.env.LINKEDIN_CLIENT_ID;
    try {
      const t = await makeTenant();
      await expect(startConnect(t.scope, t.user.id, "linkedin")).rejects.toMatchObject({ code: "integration_not_configured" });
    } finally {
      process.env.LINKEDIN_CLIENT_ID = ENV.LINKEDIN_CLIENT_ID;
    }
  });
});

describe("start route", () => {
  it("refuses cross-site starts before touching the session", async () => {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/integrations/[provider]/start/route");
    const res = await GET(new NextRequest("http://localhost:3000/api/integrations/meta/start?from=onboarding", { headers: { "sec-fetch-site": "cross-site" } }), { params: Promise.resolve({ provider: "meta" }) });
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/onboarding/connect");
    expect(loc.searchParams.get("error")).toBe("forbidden");
  });

  it("an explicit redirect URI must point at the provider's callback path", () => {
    process.env.META_REDIRECT_URI = "https://evil.example/steal";
    try {
      expect(() => redirectUriFor("meta")).toThrow();
    } finally {
      process.env.META_REDIRECT_URI = ENV.META_REDIRECT_URI;
    }
  });
});
