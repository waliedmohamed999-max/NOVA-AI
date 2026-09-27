import { afterEach, describe, expect, it, vi } from "vitest";

// The OAuth callback is bound to the signed-in user; tests set who that is.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/server/auth/session", () => ({ getSession: async () => (session.userId ? { userId: session.userId } : null) }));
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import {
  CONNECTED_ACCOUNTS_PATH,
  ONBOARDING_CONNECT_PATH,
  completeConnect,
  disconnectIntegration,
  markIntegrationError,
  returnPathFor,
  selectAccounts,
  startConnect,
} from "@/server/integrations/service";
import { loadConnections, parseConnectFlash } from "@/server/integrations/connections";
import { setSocialProvider, SOCIAL_PROVIDERS } from "@/server/integrations/registry";
import { ProviderError, type SocialProvider } from "@/server/integrations/types";
import { hashToken } from "@/server/crypto";
import { maskId, providerConfigStatus } from "@/server/admin/providers";

// These are broker tests: one fake serves every platform so the broker logic is tested on its own.
const original = { meta: SOCIAL_PROVIDERS.meta, instagram: SOCIAL_PROVIDERS.instagram };
afterEach(() => {
  setSocialProvider("meta", original.meta);
  setSocialProvider("instagram", original.instagram);
});
function useFake(p: SocialProvider) {
  setSocialProvider("meta", p);
  setSocialProvider("instagram", p);
}

type Acc = Awaited<ReturnType<SocialProvider["listAccounts"]>>[number];
const ig = (id: string, handle = `@${id}`): Acc => ({ externalId: id, platform: "INSTAGRAM", name: id, handle, accountType: "instagram_business", token: { accessToken: `tok-${id}` } });
const fb = (id: string): Acc => ({ externalId: id, platform: "FACEBOOK", name: `Page ${id}`, accountType: "page", token: { accessToken: `tok-${id}` } });

let revoked = 0;
function fakeMeta(accounts: Acc[], overrides: Partial<SocialProvider> = {}): SocialProvider {
  return {
    id: "meta",
    platforms: ["FACEBOOK", "INSTAGRAM"],
    scopes: ["pages_show_list"],
    isConfigured: () => true,
    connect: ({ state }) => `https://facebook.test/dialog?state=${state}`,
    exchangeCode: async () => ({ accessToken: "user-token", expiresAt: new Date(Date.now() + 86_400_000) }),
    listAccounts: async () => accounts,
    refreshToken: async () => null,
    disconnect: async () => void revoked++,
    publishPost: async () => ({ externalId: "r", permalink: null }),
    schedulePost: async () => null,
    getPost: async () => null,
    getPosts: async () => [],
    getMetrics: async () => null,
    getAccountMetrics: async () => null,
    ...overrides,
  };
}

async function connect(t: Awaited<ReturnType<typeof makeTenant>>, from: "onboarding" | "settings" = "settings") {
  const url = await startConnect(t.scope, t.user.id, "meta", from);
  return completeConnect("meta", { code: "code", state: new URL(url).searchParams.get("state")! });
}

describe("return context", () => {
  it("returns to onboarding when started from onboarding, settings otherwise", async () => {
    useFake(fakeMeta([ig("luma")]));
    const t = await makeTenant();
    expect((await connect(t, "onboarding")).redirectTo).toBe(ONBOARDING_CONNECT_PATH);
    expect((await connect(t, "settings")).redirectTo).toBe(CONNECTED_ACCOUNTS_PATH);
  });

  it("never turns a return value into an open redirect", async () => {
    expect(returnPathFor("https://evil.example")).toBe(CONNECTED_ACCOUNTS_PATH);
    expect(returnPathFor("//evil.example")).toBe(CONNECTED_ACCOUNTS_PATH);
    useFake(fakeMeta([ig("luma")]));
    const t = await makeTenant();
    const url = await startConnect(t.scope, t.user.id, "meta", "https://evil.example" as never);
    const state = new URL(url).searchParams.get("state")!;
    // Even a tampered stored value is ignored at callback time.
    await db.oAuthState.update({ where: { stateHash: hashToken(state) }, data: { redirectTo: "https://evil.example/x" } });
    expect((await completeConnect("meta", { code: "c", state })).redirectTo).toBe(CONNECTED_ACCOUNTS_PATH);
  });
});

describe("state validation", () => {
  it("rejects forged, expired, wrong-provider and replayed states", async () => {
    useFake(fakeMeta([ig("luma")]));
    const t = await makeTenant();
    await expect(completeConnect("meta", { code: "c", state: "forged" })).rejects.toMatchObject({ code: "oauth_state" });
    await expect(completeConnect("meta", { code: "c", state: null })).rejects.toMatchObject({ code: "oauth_state" });

    const expired = new URL(await startConnect(t.scope, t.user.id, "meta")).searchParams.get("state")!;
    await db.oAuthState.update({ where: { stateHash: hashToken(expired) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(completeConnect("meta", { code: "c", state: expired })).rejects.toMatchObject({ code: "oauth_state" });

    const other = new URL(await startConnect(t.scope, t.user.id, "meta")).searchParams.get("state")!;
    await expect(completeConnect("linkedin", { code: "c", state: other })).rejects.toMatchObject({ code: "oauth_state" });

    const good = new URL(await startConnect(t.scope, t.user.id, "meta")).searchParams.get("state")!;
    expect((await completeConnect("meta", { code: "c", state: good })).connected).toEqual(["INSTAGRAM"]);
    await expect(completeConnect("meta", { code: "c", state: good })).rejects.toMatchObject({ code: "oauth_state" });
  });

  it("maps a cancelled consent and a failed exchange to human errors on the right page", async () => {
    useFake(fakeMeta([ig("luma")], { exchangeCode: async () => { throw new ProviderError("unknown", "boom secret-ish detail"); } }));
    const t = await makeTenant();
    const s1 = new URL(await startConnect(t.scope, t.user.id, "meta", "onboarding")).searchParams.get("state")!;
    expect(await completeConnect("meta", { code: null, state: s1, error: "access_denied" })).toMatchObject({ redirectTo: ONBOARDING_CONNECT_PATH, error: "oauth_denied" });
    const s2 = new URL(await startConnect(t.scope, t.user.id, "meta", "onboarding")).searchParams.get("state")!;
    expect(await completeConnect("meta", { code: "c", state: s2 })).toMatchObject({ redirectTo: ONBOARDING_CONNECT_PATH, error: "integration_error" });
    expect(await db.integration.count({ where: { organizationId: t.organization.id } })).toBe(0);
  });

  it("a Meta sign-in without any Page is an identity connection, not a failure", async () => {
    useFake(fakeMeta([]));
    const t = await makeTenant();
    const res = await connect(t);
    expect(res.error).toBeUndefined();
    expect(res.identity).toBe(true);
  });
});

describe("account selection", () => {
  it("never auto-selects when several accounts come back, and activates only the chosen ones", async () => {
    useFake(fakeMeta([ig("brand_a"), ig("brand_b"), fb("p1")]));
    const t = await makeTenant();
    const res = await connect(t, "onboarding");
    expect(res.needsSelection).toEqual(["INSTAGRAM", "FACEBOOK"]); // Meta assets are never auto-selected
    expect(res.connected).toEqual(expect.arrayContaining(["INSTAGRAM", "FACEBOOK"]));

    const view = await loadConnections(t.scope, false);
    const card = view.cards.find((c) => c.platform === "INSTAGRAM")!;
    expect(card.state).toBe("choose");
    expect(card.accounts.every((a) => !a.isActive)).toBe(true);
    expect(view.cards.find((c) => c.platform === "FACEBOOK")!.state).toBe("choose"); // even a single Page waits for the customer

    const b = card.accounts.find((a) => a.name === "brand_b")!;
    await selectAccounts(t.scope, t.user.id, card.integrationId!, [b.id]);
    const after = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "INSTAGRAM")!;
    expect(after.state).toBe("connected");
    expect(after.accounts.filter((a) => a.isActive).map((a) => a.name)).toEqual(["brand_b"]);

    // Reconnecting keeps the customer's choice instead of guessing again.
    const again = await connect(t);
    expect(again.needsSelection).toEqual(["FACEBOOK"]); // Instagram keeps the earlier choice; the Page was never chosen
    const kept = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "INSTAGRAM")!;
    expect(kept.accounts.filter((a) => a.isActive).map((a) => a.name)).toEqual(["brand_b"]);
  });

  it("rejects empty selections and accounts from another integration", async () => {
    useFake(fakeMeta([ig("a1"), ig("a2"), fb("p1")]));
    const t = await makeTenant();
    await connect(t);
    const view = await loadConnections(t.scope, false);
    const igCard = view.cards.find((c) => c.platform === "INSTAGRAM")!;
    const fbCard = view.cards.find((c) => c.platform === "FACEBOOK")!;
    await expect(selectAccounts(t.scope, t.user.id, igCard.integrationId!, [])).rejects.toMatchObject({ code: "validation" });
    await expect(selectAccounts(t.scope, t.user.id, igCard.integrationId!, [fbCard.accounts[0].id])).rejects.toMatchObject({ code: "validation" });
  });
});

describe("tenant isolation", () => {
  it("one workspace cannot select, see or disconnect another workspace's accounts", async () => {
    useFake(fakeMeta([ig("a1"), ig("a2")]));
    const a = await makeTenant("Tenant A");
    const b = await makeTenant("Tenant B");
    await connect(a);
    const card = (await loadConnections(a.scope, false)).cards.find((c) => c.platform === "INSTAGRAM")!;
    await expect(selectAccounts(b.scope, b.user.id, card.integrationId!, [card.accounts[0].id])).rejects.toMatchObject({ code: "item_not_found" });
    await expect(disconnectIntegration(b.scope, card.integrationId!, b.user.id)).rejects.toMatchObject({ code: "item_not_found" });
    expect((await loadConnections(b.scope, false)).cards.every((c) => c.integrationId === null)).toBe(true);
    expect(await db.integrationCredential.count({ where: { organizationId: a.organization.id } })).toBeGreaterThan(0);
  });
});

describe("disconnect, expiry and reconnect", () => {
  it("disconnect revokes, deletes credentials and frees the channel", async () => {
    useFake(fakeMeta([ig("luma")]));
    const t = await makeTenant();
    await connect(t);
    const card = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "INSTAGRAM")!;
    const before = revoked;
    await disconnectIntegration(t.scope, card.integrationId!, t.user.id);
    expect(revoked).toBe(before + 1);
    expect(await db.integrationCredential.count({ where: { integrationId: card.integrationId! } })).toBe(0);
    const view = await loadConnections(t.scope, false);
    expect(view.cards.find((c) => c.platform === "INSTAGRAM")!.state).toBe("idle");
    expect(view.plan.used).toBe(0);
  });

  it("an expired connection shows 'needs reconnecting' and a reconnect restores it", async () => {
    useFake(fakeMeta([ig("luma")]));
    const t = await makeTenant();
    await connect(t);
    const card0 = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "INSTAGRAM")!;
    await selectAccounts(t.scope, t.user.id, card0.integrationId!, [card0.accounts[0].id]);
    const id = card0.integrationId!;
    await markIntegrationError(t.scope, id, new ProviderError("expired", "token expired"));
    const expired = (await loadConnections(t.scope, false)).cards.find((c) => c.platform === "INSTAGRAM")!;
    expect(expired.state).toBe("reconnect");
    expect(expired.healthKey).toBe("expired");
    const notif = await db.notification.findFirst({ where: { organizationId: t.organization.id, type: "INTEGRATION_DISCONNECTED" } });
    expect(notif?.link).toBe(CONNECTED_ACCOUNTS_PATH);
    await connect(t);
    expect((await loadConnections(t.scope, false)).cards.find((c) => c.platform === "INSTAGRAM")!.state).toBe("connected");
  });
});

describe("plan channel limit and missing credentials", () => {
  it("adds channels up to the plan limit and reports the rest as limited", async () => {
    useFake(fakeMeta([ig("luma"), fb("p1")]));
    const t = await makeTenant();
    await db.subscription.update({ where: { organizationId: t.organization.id }, data: { plan: "STARTER" } });
    await db.integration.create({ data: { ...t.scope, provider: "LINKEDIN", status: "CONNECTED" } }); // 1 of 2 used
    const res = await connect(t);
    expect(res.connected).toHaveLength(1);
    expect(res.limited).toHaveLength(1);
    await expect(startConnect(t.scope, t.user.id, "tiktok")).rejects.toMatchObject({ code: expect.stringMatching(/plan_limit|integration_not_configured/) });
  });

  it("refuses to start when the channel limit is already reached", async () => {
    useFake(fakeMeta([ig("luma")]));
    const t = await makeTenant();
    await db.subscription.update({ where: { organizationId: t.organization.id }, data: { plan: "STARTER" } });
    await db.integration.createMany({ data: [{ ...t.scope, provider: "LINKEDIN", status: "CONNECTED" }, { ...t.scope, provider: "TIKTOK", status: "CONNECTED" }] });
    await expect(startConnect(t.scope, t.user.id, "meta")).rejects.toMatchObject({ code: "plan_limit" });
  });

  it("shows unavailable (not env names) when the platform app isn't configured", async () => {
    useFake(fakeMeta([ig("luma")], { isConfigured: () => false }));
    const t = await makeTenant();
    await expect(startConnect(t.scope, t.user.id, "meta")).rejects.toMatchObject({ code: "integration_not_configured" });
    const view = await loadConnections(t.scope, false);
    expect(view.cards.find((c) => c.platform === "INSTAGRAM")!.state).toBe("unavailable");
    expect(JSON.stringify(view)).not.toMatch(/META_APP|SECRET|CLIENT_ID/);
  });
});

describe("helpers", () => {
  it("post-OAuth query only accepts platform names and short error codes", () => {
    expect(parseConnectFlash({ connected: "INSTAGRAM,FACEBOOK", error: "oauth_denied" })).toEqual({ connected: ["INSTAGRAM", "FACEBOOK"], choose: [], limited: [], error: "oauth_denied", upgrade: null, identity: false });
    expect(parseConnectFlash({ connected: "<script>", error: "https://x" })).toEqual({ connected: [], choose: [], limited: [], error: null, upgrade: null, identity: false });
  });

  it("admin provider status masks ids and never returns secrets", () => {
    process.env.META_APP_ID = "123456789012";
    process.env.META_APP_SECRET = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    try {
      expect(maskId("123456789012")).toBe("1234••••12");
      const meta = providerConfigStatus().find((r) => r.key === "meta")!;
      expect(meta.status).toBe("configured");
      expect(JSON.stringify(meta)).not.toContain("a1b2c3d4e5f60718293a4b5c6d7e8f90");
      expect(JSON.stringify(meta)).not.toContain("123456789012");
      delete process.env.META_APP_SECRET;
      expect(providerConfigStatus().find((r) => r.key === "meta")!.status).toBe("error");
      expect(providerConfigStatus().find((r) => r.key === "payments")!.note).toBe("stripe_pending_keys");
    } finally {
      delete process.env.META_APP_ID;
      delete process.env.META_APP_SECRET;
    }
  });
});

describe("callback route", () => {
  it("redirects to the return page with platform names only — no code, state or token in the URL", async () => {
    useFake(fakeMeta([ig("a1"), ig("a2"), fb("p1")]));
    const t = await makeTenant();
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/integrations/[provider]/callback/route");
    const url = await startConnect(t.scope, t.user.id, "meta", "onboarding");
    const state = new URL(url).searchParams.get("state")!;
    session.userId = t.user.id;
    const res = await GET(new NextRequest(`http://localhost:3000/api/integrations/meta/callback?code=secret-code&state=${state}`), { params: Promise.resolve({ provider: "meta" }) });
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe(ONBOARDING_CONNECT_PATH);
    expect(location.searchParams.get("choose")).toBe("INSTAGRAM,FACEBOOK");
    expect(location.search).not.toMatch(/secret-code|state=|token/);
    // Nothing is chosen yet, so nothing is synced until the customer picks accounts.
    const jobs = await db.job.findMany({ where: { organizationId: t.organization.id, type: "social.sync_integration" } });
    expect(jobs).toHaveLength(0);
  });
});

describe("callback route — session binding", () => {
  it("rejects a callback finished by a different signed-in user", async () => {
    useFake(fakeMeta([ig("a1")]));
    const t = await makeTenant();
    const attacker = await makeTenant("Attacker");
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/integrations/[provider]/callback/route");
    const state = new URL(await startConnect(t.scope, t.user.id, "meta", "onboarding")).searchParams.get("state")!;
    session.userId = attacker.user.id;
    const res = await GET(new NextRequest(`http://localhost:3000/api/integrations/meta/callback?code=c&state=${state}`), { params: Promise.resolve({ provider: "meta" }) });
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("oauth_state");
    expect(await db.integration.count({ where: { organizationId: t.organization.id } })).toBe(0);
  });
});
