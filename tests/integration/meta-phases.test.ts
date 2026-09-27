import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { completeConnect, selectAccountsBatch, startConnect } from "@/server/integrations/service";
import { loadConnections } from "@/server/integrations/connections";
import { metaCredentialProblem, MetaProvider } from "@/server/integrations/providers/meta";
import { oauthDiagnostics } from "@/server/admin/oauth-diagnostics";
import { providerConfigStatus } from "@/server/admin/providers";
import { getUsage } from "@/server/billing/entitlements";

/**
 * Meta, step by step, as the platform actually works:
 *   A. login (public_profile) → identity connected (a Facebook profile is login-only)
 *   B. "Grant access to Pages" → pages_show_list only → Pages picker (nothing auto-selected)
 * Instagram is a separate provider (Instagram Direct) — see instagram-direct.test.ts.
 */
let calls: { url: string; method: string }[] = [];
function mockMeta(granted: string[], pages: unknown[] = []) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (/oauth\/access_token\?.*code=/.test(url)) return json({ access_token: "short" });
    if (/fb_exchange_token/.test(url)) return json({ access_token: "long", expires_in: 5_000_000 });
    if (/\/me\/permissions/.test(url)) return json({ data: granted.map((permission) => ({ permission, status: "granted" })) });
    if (/\/me\/accounts/.test(url)) return json({ data: pages });
    return new Response(JSON.stringify({ error: { message: "unmocked" } }), { status: 500 });
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

async function login(t: Awaited<ReturnType<typeof makeTenant>>, upgrade?: { platform: string; capability: string }) {
  const url = new URL(await startConnect(t.scope, t.user.id, "meta", "onboarding", upgrade));
  return { url, res: await completeConnect("meta", { code: "c", state: url.searchParams.get("state") }, t.user.id) };
}

const PAGES = [
  { id: "page-1", name: "Luma Skin Studio", access_token: "pt1", tasks: ["MANAGE", "CREATE_CONTENT", "ANALYZE"] },
  { id: "page-2", name: "Luma Offers", access_token: "pt2", tasks: ["ANALYZE"] },
];

describe("Phase A — Meta login = identity", () => {
  it("public_profile only: identity connected, Page access is the next step, not a channel on the plan", async () => {
    const t = await makeTenant();
    mockMeta(["public_profile"]);
    const { url, res } = await login(t);
    expect(url.searchParams.get("scope")).toBe("public_profile");
    expect(res).toMatchObject({ identity: true });
    expect(res.error).toBeUndefined();

    const view = await loadConnections(t.scope, false);
    const fb = view.cards.find((c) => c.platform === "FACEBOOK")!;
    const ig = view.cards.find((c) => c.platform === "INSTAGRAM")!;
    expect(fb).toMatchObject({ state: "identity", nextStep: { upgrade: "FACEBOOK:discovery", kind: "pages" }, accounts: [] });
    expect(ig).toMatchObject({ state: "idle", nextStep: null }); // Instagram is independent of the Meta login
    expect((await getUsage(t.organization.id)).socialChannels.used).toBe(0);

    const diag = (await oauthDiagnostics(t.organization.id)).find((d) => d.id === "meta")!;
    expect(diag.assets).toMatchObject({ identity: true, pages: null, granted: ["public_profile"] });
  });
});

describe("Phase B — Page discovery on request", () => {
  it("'Grant access to Pages' requests pages_show_list only (rerequest), lists Pages, selects none", async () => {
    const t = await makeTenant();
    mockMeta(["public_profile"]);
    await login(t);
    mockMeta(["public_profile", "pages_show_list"], PAGES);
    const { url, res } = await login(t, { platform: "FACEBOOK", capability: "discovery" });
    expect(url.searchParams.get("scope")!.split(",").sort()).toEqual(["pages_show_list", "public_profile"]);
    expect(url.searchParams.get("auth_type")).toBe("rerequest");
    // Meta is Pages-only: NOVA never asks Pages for Instagram children.
    const pagesCall = calls.find((c) => c.url.includes("/me/accounts"))!;
    expect(decodeURIComponent(pagesCall.url)).not.toContain("instagram_business_account");

    expect(res.needsSelection).toEqual(["FACEBOOK"]);
    const fb = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "FACEBOOK")!;
    expect(fb.state).toBe("choose");
    expect(fb.accounts.map((a) => [a.name, a.isActive])).toEqual([["Luma Skin Studio", false], ["Luma Offers", false]]);
    // Page capabilities come from GRANTED permissions: discovery only, no publishing yet.
    const caps = Object.fromEntries(fb.accounts[0].capabilities!.map((c) => [c.key, c.available]));
    expect(caps).toMatchObject({ identity: true, publish: false, metrics: false });

    await selectAccountsBatch(t.scope, t.user.id, [{ integrationId: fb.integrationId!, accountIds: [fb.accounts[0].id] }]);
    expect((await getUsage(t.organization.id)).socialChannels.used).toBe(1);
    const diag = (await oauthDiagnostics(t.organization.id)).find((d) => d.id === "meta")!;
    expect(diag.assets).toMatchObject({ identity: true, pages: 2, selectedPages: ["Luma Skin Studio"] });
  });

  it("Page access granted but the account manages no Page → identity, with a clear reason", async () => {
    const t = await makeTenant();
    mockMeta(["public_profile", "pages_show_list"], []);
    env({ META_OAUTH_SCOPES: "pages_show_list" });
    const { res } = await login(t);
    expect(res.identity).toBe(true);
    const fb = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "FACEBOOK")!;
    expect(fb).toMatchObject({ state: "identity", noManagedPages: true, nextStep: null });
  });

  it("pages_manage_posts granted → Page publishing capability true (granted, not requested, decides)", async () => {
    const t = await makeTenant();
    env({ META_OAUTH_SCOPES: "pages_show_list,pages_manage_posts" });
    mockMeta(["public_profile", "pages_show_list", "pages_manage_posts"], PAGES);
    await login(t);
    const fb = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "FACEBOOK")!;
    const cap = (name: string) => Object.fromEntries(fb.accounts.find((a) => a.name === name)!.capabilities!.map((c) => [c.key, c.available]));
    expect(cap("Luma Skin Studio").publish).toBe(true);
    expect(cap("Luma Offers").publish).toBe(false); // ANALYZE-only role on that Page
  });
});

describe("credential format", () => {
  it("an access token pasted as the App Secret is caught before any login", () => {
    expect(metaCredentialProblem({ META_APP_ID: "1234567890123456", META_APP_SECRET: "EAAB" + "x".repeat(200) } as unknown as NodeJS.ProcessEnv)).toBe("secret_is_access_token");
    expect(metaCredentialProblem({ META_APP_ID: "1234567890123456", META_APP_SECRET: "not-a-secret" } as unknown as NodeJS.ProcessEnv)).toBe("secret_format");
    expect(metaCredentialProblem({ META_APP_ID: "abc", META_APP_SECRET: "0123456789abcdef0123456789abcdef" } as unknown as NodeJS.ProcessEnv)).toBe("app_id_format");
    expect(metaCredentialProblem({ META_APP_ID: "1234567890123456", META_APP_SECRET: "0123456789abcdef0123456789abcdef" } as unknown as NodeJS.ProcessEnv)).toBeNull();

    env({ META_APP_SECRET: "EAAB" + "y".repeat(100) });
    expect(new MetaProvider().isConfigured()).toBe(false);
    const row = providerConfigStatus().find((r) => r.key === "meta")!;
    expect(row).toMatchObject({ status: "error", note: "meta_secret_is_access_token" });
    expect(JSON.stringify(row)).not.toContain("EAAB");
  });
});

describe("no personal publishing", () => {
  it("a Facebook profile never becomes a publishing destination", async () => {
    const t = await makeTenant();
    mockMeta(["public_profile"]);
    await login(t);
    expect(await db.integrationAccount.count({ where: { organizationId: t.organization.id } })).toBe(0);
  });
});
