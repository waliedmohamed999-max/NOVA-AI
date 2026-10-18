import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { encryptSecret } from "@/server/crypto";
import { SOCIAL_PROVIDERS, setSocialProvider } from "@/server/integrations/registry";
import { InstagramProvider } from "@/server/integrations/providers/instagram";
import { MetaProvider } from "@/server/integrations/providers/meta";
import { ProviderError, type RemoteComment, type SocialProvider } from "@/server/integrations/types";
import { recentComments, replyToComment } from "@/server/social/comments";
import { makeTenant } from "../support/factory";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const original = SOCIAL_PROVIDERS.instagram;
afterEach(() => {
  setSocialProvider("instagram", original);
  vi.unstubAllGlobals();
});

const at = (iso: string) => new Date(iso);
const replies: { commentId: string; message: string; token: string }[] = [];

function fakeInstagram(byPost: Record<string, RemoteComment[] | Error>): SocialProvider {
  return {
    ...original,
    async listComments(_a, _t, postId) {
      const v = byPost[postId] ?? [];
      if (v instanceof Error) throw v;
      return v;
    },
    async replyToComment(_a, token, commentId, message) {
      replies.push({ commentId, message, token: token.accessToken });
      return { id: `r-${commentId}` };
    },
  } as SocialProvider;
}

async function igAccount(t: Tenant, comments: boolean) {
  const integration = await db.integration.create({ data: { ...t.scope, provider: "INSTAGRAM", status: "CONNECTED" } });
  const account = await db.integrationAccount.create({
    data: { ...t.scope, integrationId: integration.id, platform: "INSTAGRAM", externalId: `ig-${Math.random()}`, name: "@luma", accountType: "instagram_login", metadata: { capabilities: [{ key: "comments", available: comments, ...(comments ? {} : { reason: "requires_approval" }) }] } },
  });
  await db.integrationCredential.create({ data: { ...t.scope, integrationId: integration.id, accountId: null, accessTokenEnc: encryptSecret("IG-token") } });
  return account;
}

async function post(t: Tenant, accountId: string, externalId: string, publishedAt: string) {
  return db.socialPost.create({ data: { ...t.scope, integrationAccountId: accountId, platform: "INSTAGRAM", externalId, caption: `Post ${externalId}`, publishedAt: at(publishedAt) } });
}

describe("social comments", () => {
  it("collects comments across recent posts, newest activity first", async () => {
    const t = await makeTenant("Comments Co");
    const acc = await igAccount(t, true);
    await post(t, acc.id, "m1", "2026-10-01T10:00:00Z");
    await post(t, acc.id, "m2", "2026-10-05T10:00:00Z");
    setSocialProvider(
      "instagram",
      fakeInstagram({
        m1: [{ id: "c1", text: "Love this!", author: "@sara", at: at("2026-10-02T09:00:00Z"), replies: [] }],
        m2: [{ id: "c2", text: "Price?", author: "@omar", at: at("2026-10-06T09:00:00Z"), replies: [{ id: "c2r", text: "DM us", author: "@luma", at: at("2026-10-06T10:00:00Z") }] }],
      }),
    );
    const r = await recentComments(t.scope);
    expect(r.accounts).toEqual([expect.objectContaining({ id: acc.id, status: "ok" })]);
    expect(r.threads.map((x) => x.comment.id)).toEqual(["c2", "c1"]);
    expect(r.threads[0].post.caption).toBe("Post m2");
  });

  it("doesn't call the platform without the comment permission, and reports why", async () => {
    const t = await makeTenant("No Perm Co");
    const acc = await igAccount(t, false);
    await post(t, acc.id, "m1", "2026-10-01T10:00:00Z");
    const list = vi.fn();
    setSocialProvider("instagram", { ...fakeInstagram({}), listComments: list } as SocialProvider);
    const r = await recentComments(t.scope);
    expect(r.accounts[0].status).toBe("permission");
    expect(list).not.toHaveBeenCalled();
    await expect(replyToComment(t.scope, acc.id, "c1", "hi", { userId: t.user.id, label: "Owner" })).rejects.toMatchObject({ code: "permission_required" });
  });

  it("marks an expired connection instead of failing the page", async () => {
    const t = await makeTenant("Expired Co");
    const acc = await igAccount(t, true);
    await post(t, acc.id, "m1", "2026-10-01T10:00:00Z");
    setSocialProvider("instagram", fakeInstagram({ m1: new ProviderError("expired", "token expired", 401) }));
    const r = await recentComments(t.scope);
    expect(r.accounts[0].status).toBe("expired");
    expect(r.threads).toEqual([]);
  });

  it("replies as the account, scoped to the workspace", async () => {
    const t = await makeTenant("Reply Co");
    const acc = await igAccount(t, true);
    setSocialProvider("instagram", fakeInstagram({}));
    replies.length = 0;
    await replyToComment(t.scope, acc.id, "c9", "  Thank you!  ", { userId: t.user.id, label: "Owner" });
    expect(replies).toEqual([{ commentId: "c9", message: "Thank you!", token: "IG-token" }]);
    expect(await db.auditLog.count({ where: { organizationId: t.organization.id, action: "social.comment_replied" } })).toBe(1);

    const other = await makeTenant("Intruder Co");
    await expect(replyToComment(other.scope, acc.id, "c9", "spam", { userId: other.user.id, label: "x" })).rejects.toThrow();
  });
});

describe("provider comment APIs (mocked HTTP)", () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it("Instagram: reads comments with replies and posts a reply", async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined });
      if (String(url).includes("/m1/comments")) return json({ data: [{ id: "c1", text: "Nice", username: "sara", timestamp: "2026-10-02T09:00:00+0000", replies: { data: [{ id: "r1", text: "Thanks", username: "luma", timestamp: "2026-10-02T10:00:00+0000" }] } }] });
      if (String(url).includes("/c1/replies")) return json({ id: "r2" });
      return json({});
    });
    const ig = new InstagramProvider();
    const ref = { externalId: "acc", accountType: "instagram_login", metadata: {} };
    const comments = await ig.listComments(ref, { accessToken: "tok" }, "m1");
    expect(comments).toEqual([{ id: "c1", text: "Nice", author: "@sara", at: new Date("2026-10-02T09:00:00Z"), replies: [{ id: "r1", text: "Thanks", author: "@luma", at: new Date("2026-10-02T10:00:00Z") }] }]);
    expect(await ig.replyToComment(ref, { accessToken: "tok" }, "c1", "Welcome")).toEqual({ id: "r2" });
    expect(calls[1].url).toContain("/c1/replies");
    expect(calls[1].body).toContain("message=Welcome");
  });

  it("Facebook Page: reads comments and replies under the comment", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("/p1/comments")) return json({ data: [{ id: "c1", message: "When do you open?", from: { name: "Mona" }, created_time: "2026-10-03T08:00:00+0000" }] });
      return json({ id: "c1_reply" });
    });
    const meta = new MetaProvider();
    const ref = { externalId: "page", accountType: "facebook_page", metadata: {} };
    const comments = await meta.listComments(ref, { accessToken: "tok" }, "p1");
    expect(comments[0]).toMatchObject({ id: "c1", text: "When do you open?", author: "Mona", replies: [] });
    await meta.replyToComment(ref, { accessToken: "tok" }, "c1", "9am");
    expect(calls[1]).toContain("/c1/comments");
  });

  it("only reports comment access when the permissions were granted", () => {
    const meta = new MetaProvider();
    const fb = (scopes: string[]) => meta.capabilities({ platform: "FACEBOOK", accountType: "facebook_page", metadata: { tasks: ["MODERATE", "CREATE_CONTENT"] } }, scopes).find((c) => c.key === "comments");
    expect(fb(["pages_show_list"])?.available).toBe(false);
    expect(fb(["pages_read_user_content", "pages_manage_engagement"])?.available).toBe(true);
    const ig = meta.capabilities({ platform: "INSTAGRAM", accountType: "instagram_business" }, ["instagram_basic", "instagram_manage_comments"]).find((c) => c.key === "comments");
    expect(ig?.available).toBe(true);
  });
});
