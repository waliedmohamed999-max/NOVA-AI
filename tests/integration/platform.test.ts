import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant, makeUser } from "../support/factory";
import { completeConnect, startConnect, tokenForAccount } from "@/server/integrations/service";
import { setSocialProvider, SOCIAL_PROVIDERS } from "@/server/integrations/registry";
import type { SocialProvider } from "@/server/integrations/types";
import { UserFacingError } from "@/server/errors";
import { approveContent, createContentFromPlan } from "@/server/content/service";
import { publishOne } from "@/server/social/publishing";
import { captureLead } from "@/server/sales/capture";
import { assertWithinLimit, canMoveTo, getUsage } from "@/server/billing/entitlements";
import { requestPlanChange } from "@/server/billing/service";
import { acceptInvitation, lookupInvitation } from "@/server/team/invitations";
import { hashToken } from "@/server/crypto";
import { offlinePost } from "@/server/agents/offline-content";
import { loadBrain } from "@/server/agents/brain";

const original = SOCIAL_PROVIDERS.meta;
afterEach(() => setSocialProvider("meta", original));

function fakeMeta(overrides: Partial<SocialProvider> = {}): SocialProvider {
  return {
    id: "meta",
    platforms: ["FACEBOOK", "INSTAGRAM"],
    scopes: ["pages_show_list"],
    isConfigured: () => true,
    connect: ({ state }) => `https://facebook.test/dialog?state=${state}`,
    exchangeCode: async () => ({ accessToken: "user-token-secret", expiresAt: new Date(Date.now() + 86_400_000) }),
    listAccounts: async () => [{ externalId: "ig-1", platform: "INSTAGRAM", name: "luma", accountType: "instagram_business", token: { accessToken: "page-token-secret" } }],
    refreshToken: async () => null,
    disconnect: async () => undefined,
    publishPost: async () => ({ externalId: "remote-1", permalink: "https://instagram.test/p/1" }),
    schedulePost: async () => null,
    getPost: async () => null,
    getPosts: async () => [],
    getMetrics: async () => null,
    getAccountMetrics: async () => null,
    ...overrides,
  };
}

describe("OAuth connect flow", () => {
  it("verifies and consumes state, encrypts tokens, and rejects replays", async () => {
    setSocialProvider("meta", fakeMeta());
    const t = await makeTenant();
    const url = await startConnect(t.scope, t.user.id, "meta");
    const state = new URL(url).searchParams.get("state")!;
    await expect(completeConnect("meta", { code: "x", state: "forged" })).rejects.toBeInstanceOf(UserFacingError);
    const res = await completeConnect("meta", { code: "abc", state });
    expect(res.connected).toEqual(["INSTAGRAM"]);
    await expect(completeConnect("meta", { code: "abc", state })).rejects.toBeInstanceOf(UserFacingError);

    const cred = await db.integrationCredential.findFirstOrThrow({ where: { organizationId: t.organization.id, accountId: { not: null } }, omit: { accessTokenEnc: false } });
    expect(cred.accessTokenEnc).not.toContain("page-token-secret");
    const account = await db.integrationAccount.findFirstOrThrow({ where: { organizationId: t.organization.id } });
    expect((await tokenForAccount(account.integrationId, account.id))?.accessToken).toBe("page-token-secret");
    // Default client never returns ciphertext
    const plain = await db.integrationCredential.findFirstOrThrow({ where: { id: cred.id } });
    expect("accessTokenEnc" in plain).toBe(false);
  });

  it("refuses to connect when the provider has no app credentials", async () => {
    setSocialProvider("meta", fakeMeta({ isConfigured: () => false }));
    const t = await makeTenant();
    await expect(startConnect(t.scope, t.user.id, "meta")).rejects.toMatchObject({ code: "integration_not_configured" });
  });
});

describe("publishing", () => {
  it("publishes approved content through the provider exactly once", async () => {
    let published = 0;
    setSocialProvider("meta", fakeMeta({ publishPost: async () => ({ externalId: `remote-${++published}`, permalink: null }) }));
    const t = await makeTenant();
    const url = await startConnect(t.scope, t.user.id, "meta");
    await completeConnect("meta", { code: "c", state: new URL(url).searchParams.get("state")! });
    const b = await loadBrain(t.scope);
    const [id] = await createContentFromPlan(t.scope, [{ ...offlinePost(b, 0, { platform: "INSTAGRAM" }), dayOffset: 1 }], { agent: "CONTENT_STRATEGIST", startDate: new Date(), generatedBy: "test" });
    await approveContent(t.scope, [id], { userId: t.user.id });
    const pub = await db.socialPublication.findFirstOrThrow({ where: { contentItemId: id } });
    expect(await publishOne(pub.id)).toBe("published");
    expect(await publishOne(pub.id)).toBe("skipped");
    expect(published).toBe(1);
    expect((await db.contentItem.findUniqueOrThrow({ where: { id } })).status).toBe("PUBLISHED");
    expect(await db.socialPost.count({ where: { contentItemId: id } })).toBe(1);
  });

  it("fails honestly (never fake success) when no account is connected", async () => {
    const t = await makeTenant();
    const b = await loadBrain(t.scope);
    const [id] = await createContentFromPlan(t.scope, [{ ...offlinePost(b, 0, { platform: "LINKEDIN" }), dayOffset: 1 }], { agent: "CONTENT_STRATEGIST", startDate: new Date(), generatedBy: "test" });
    await approveContent(t.scope, [id], { userId: t.user.id });
    const pub = await db.socialPublication.findFirstOrThrow({ where: { contentItemId: id } });
    expect(await publishOne(pub.id)).toBe("failed");
    expect((await db.socialPublication.findUniqueOrThrow({ where: { id: pub.id } })).error).toBe("cannot_publish");
    expect(await db.notification.count({ where: { organizationId: t.organization.id, type: "PUBLISHING_FAILED" } })).toBeGreaterThan(0);
  });
});

describe("website lead capture", () => {
  async function form(allowedOrigins: string[] = []) {
    const t = await makeTenant();
    const f = await db.leadCaptureForm.create({
      data: { ...t.scope, publicKey: `k-${t.organization.id}`, name: "Site", allowedOrigins, fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }, { key: "message", label: "Msg", type: "textarea", required: false }] },
    });
    return { t, f };
  }
  const meta = (ip: string, origin: string | null = null) => ({ ip, origin, appUrl: "http://localhost:3000" });

  it("creates a real lead with attribution and a timeline", async () => {
    const { t, f } = await form();
    const res = await captureLead(f.publicKey, { name: "Ali", email: "ali@example.com", message: "Need a quote", utm_source: "instagram", _ts: Date.now() - 10_000 }, meta("1.1.1.1"));
    expect(res.ok).toBe(true);
    const lead = await db.lead.findFirstOrThrow({ where: t.scope });
    expect(lead).toMatchObject({ channel: "WEBSITE", source: "Website form (instagram)" });
    const types = (await db.leadEvent.findMany({ where: { leadId: lead.id } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["CREATED", "FORM_SUBMITTED", "MESSAGE_RECEIVED"]));
  });
  it("validates fields, blocks foreign origins, rate limits and ignores bots", async () => {
    const { t, f } = await form(["https://client.example"]);
    expect(await captureLead(f.publicKey, { name: "", email: "nope" }, meta("2.2.2.2"))).toMatchObject({ ok: false, error: "validation" });
    expect(await captureLead(f.publicKey, { name: "A", email: "a@b.co" }, meta("2.2.2.3", "https://evil.example"))).toMatchObject({ ok: false, error: "forbidden_origin" });
    expect((await captureLead(f.publicKey, { name: "A", email: "a@b.co" }, meta("2.2.2.4", "https://client.example"))).ok).toBe(true);
    await captureLead(f.publicKey, { name: "Bot", email: "bot@b.co", company_website: "spam" }, meta("2.2.2.5"));
    expect(await db.lead.count({ where: { ...t.scope, name: "Bot" } })).toBe(0);
    for (let i = 0; i < 5; i++) await captureLead(f.publicKey, { name: "R", email: "r@b.co" }, meta("9.9.9.9"));
    expect(await captureLead(f.publicKey, { name: "R", email: "r@b.co" }, meta("9.9.9.9"))).toMatchObject({ ok: false, error: "rate_limited" });
    expect(await captureLead("missing", {}, meta("3.3.3.3"))).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("billing entitlements", () => {
  it("reports usage, enforces seat limits and never fakes checkout", async () => {
    const t = await makeTenant();
    const u = await getUsage(t.organization.id);
    expect(u).toMatchObject({ plan: "STARTER", seats: { used: 1, limit: 2 } });
    await db.invitation.create({ data: { organizationId: t.organization.id, email: "x@y.com", tokenHash: hashToken(`t-${t.organization.id}`), expiresAt: new Date(Date.now() + 86_400_000) } });
    await expect(assertWithinLimit(t.organization.id, "seats")).rejects.toMatchObject({ code: "plan_limit" });
    await expect(assertWithinLimit(t.organization.id, "agents", { agentKey: "SALES_AGENT" })).rejects.toMatchObject({ code: "plan_limit" });
    expect((await canMoveTo(t.organization.id, "GROWTH")).ok).toBe(true);
    await expect(requestPlanChange({ organizationId: t.organization.id, plan: "GROWTH", email: "a@b.c", actorId: t.user.id })).rejects.toMatchObject({ code: "billing_not_configured" });
  });
});

describe("team invitations", () => {
  it("accepts only for the invited email, once", async () => {
    const t = await makeTenant();
    const invitee = await makeUser({ email: `invitee-${t.organization.id}@example.com` });
    const stranger = await makeUser();
    const token = `inv-${t.organization.id}`;
    await db.invitation.create({ data: { organizationId: t.organization.id, email: invitee.email, role: "MANAGER", tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 86_400_000) } });
    await expect(acceptInvitation(token, stranger)).rejects.toMatchObject({ code: "forbidden" });
    await acceptInvitation(token, invitee);
    expect((await db.organizationMember.findFirstOrThrow({ where: { organizationId: t.organization.id, userId: invitee.id } })).role).toBe("MANAGER");
    expect((await lookupInvitation(token)).state).toBe("accepted");
    await expect(acceptInvitation(token, invitee)).rejects.toMatchObject({ code: "invalid_token" });
  });
  it("rejects expired invitations", async () => {
    const t = await makeTenant();
    const token = `exp-${t.organization.id}`;
    await db.invitation.create({ data: { organizationId: t.organization.id, email: "late@example.com", tokenHash: hashToken(token), expiresAt: new Date(Date.now() - 1000) } });
    expect((await lookupInvitation(token)).state).toBe("expired");
  });
});
