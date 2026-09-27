import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MetaProvider } from "@/server/integrations/providers/meta";
import { LinkedInProvider } from "@/server/integrations/providers/linkedin";
import { TikTokProvider } from "@/server/integrations/providers/tiktok";
import { ProviderError } from "@/server/integrations/types";
import { buildImagePrompt, sizeForFormat } from "@/server/design/image-provider";

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];

function mockFetch(routes: [RegExp, (url: string, init?: RequestInit) => { status?: number; body: unknown; headers?: Record<string, string> }][]) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find(([re]) => re.test(url));
    if (!route) return new Response(JSON.stringify({ error: { message: "unmocked" } }), { status: 500 });
    const r = route[1](url, init);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }));
}

beforeAll(() => {
  process.env.META_APP_ID = "app";
  process.env.META_APP_SECRET = "secret";
  process.env.LINKEDIN_CLIENT_ID = "li";
  process.env.LINKEDIN_CLIENT_SECRET = "li-secret";
  process.env.TIKTOK_CLIENT_KEY = "tk";
  process.env.TIKTOK_CLIENT_SECRET = "tk-secret";
});
afterEach(() => vi.unstubAllGlobals());

describe("Meta adapter (mocked Graph API)", () => {
  const meta = new MetaProvider();
  it("builds an authorization URL with state and scopes", () => {
    const url = new URL(meta.connect({ state: "s1", redirectUri: "https://app/cb" }));
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("scope")).toContain("instagram_content_publish");
  });
  it("exchanges the code for a long-lived token and lists pages + instagram accounts", async () => {
    mockFetch([
      [/oauth\/access_token\?.*code=/, () => ({ body: { access_token: "short" } })],
      [/oauth\/access_token\?.*fb_exchange_token/, () => ({ body: { access_token: "long", expires_in: 5_000_000 } })],
      [/me\/accounts/, () => ({ body: { data: [{ id: "p1", name: "Luma", access_token: "page-token", instagram_business_account: { id: "ig1", username: "luma" } }] } })],
    ]);
    const token = await meta.exchangeCode({ code: "c", redirectUri: "https://app/cb" });
    expect(token.accessToken).toBe("long");
    const accounts = await meta.listAccounts(token);
    expect(accounts.map((a) => a.platform)).toEqual(["FACEBOOK", "INSTAGRAM"]);
    expect(accounts[1].token?.accessToken).toBe("page-token");
  });
  it("publishes to Instagram via container + media_publish", async () => {
    mockFetch([
      [/ig1\/media_publish/, () => ({ body: { id: "media-9" } })],
      [/ig1\/media$/, () => ({ body: { id: "container-1" } })],
      [/media-9\?/, () => ({ body: { permalink: "https://instagram.com/p/x" } })],
    ]);
    const res = await meta.publishPost({ externalId: "ig1", accountType: "instagram_business", metadata: {} }, { accessToken: "t" }, { format: "POST", caption: "Hello", mediaUrls: ["https://cdn/x.jpg"] });
    expect(res).toEqual({ externalId: "media-9", permalink: "https://instagram.com/p/x" });
    expect(calls.some((c) => c.url.endsWith("/ig1/media") && String(c.init?.body).includes("image_url"))).toBe(true);
  });
  it("refuses Instagram posts without media", async () => {
    await expect(meta.publishPost({ externalId: "ig1", accountType: "instagram_business", metadata: {} }, { accessToken: "t" }, { format: "POST", caption: "x", mediaUrls: [] })).rejects.toBeInstanceOf(ProviderError);
  });
  it("maps an expired-token Graph error to kind=expired and never leaks the token", async () => {
    mockFetch([[/p1\/feed/, () => ({ status: 400, body: { error: { code: 190, type: "OAuthException", message: "Session has expired" }, access_token: "leak" } })]]);
    const err = await meta.publishPost({ externalId: "p1", accountType: "facebook_page", metadata: {} }, { accessToken: "t" }, { format: "POST", caption: "x", mediaUrls: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("expired");
    expect(String(err.detail)).not.toContain("leak");
  });
  it("normalizes Instagram insights and leaves unknown metrics null", async () => {
    mockFetch([[/m1\/insights/, () => ({ body: { data: [{ name: "reach", values: [{ value: 1200 }] }, { name: "likes", values: [{ value: 80 }] }, { name: "saved", values: [{ value: 14 }] }] } })]]);
    const m = await meta.getMetrics({ externalId: "ig1", accountType: "instagram_business", metadata: {} }, { accessToken: "t" }, "m1");
    expect(m).toMatchObject({ reach: 1200, likes: 80, saves: 14, clicks: null });
  });
});

describe("LinkedIn adapter (mocked REST API)", () => {
  const li = new LinkedInProvider();
  it("publishes a text post and returns the post URN", async () => {
    mockFetch([[/rest\/posts/, () => ({ status: 201, body: "", headers: { "x-restli-id": "urn:li:share:1" } })]]);
    const res = await li.publishPost({ externalId: "urn:li:person:abc", accountType: "linkedin_member", metadata: {} }, { accessToken: "t" }, { format: "LINKEDIN_POST", caption: "Hi", mediaUrls: [] });
    expect(res.externalId).toBe("urn:li:share:1");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ author: "urn:li:person:abc", commentary: "Hi", lifecycleState: "PUBLISHED" });
  });
  it("classifies 401 as expired", async () => {
    mockFetch([[/rest\/posts/, () => ({ status: 401, body: "unauthorized" })]]);
    const err = await li.publishPost({ externalId: "urn:li:person:abc", accountType: "linkedin_member", metadata: {} }, { accessToken: "t" }, { format: "POST", caption: "x", mediaUrls: [] }).catch((e) => e);
    expect(err.kind).toBe("expired");
  });
  it("returns null metrics for member posts instead of inventing numbers", async () => {
    expect(await li.getMetrics({ externalId: "urn:li:person:abc", accountType: "linkedin_member", metadata: {} }, { accessToken: "t" }, "urn:li:share:1")).toBeNull();
  });
});

describe("TikTok adapter (mocked Open API)", () => {
  const tt = new TikTokProvider();
  it("uses PKCE in the authorization URL", () => {
    const url = new URL(tt.connect({ state: "s", redirectUri: "https://app/cb", codeChallenge: "abc" }));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("exchanges and refreshes tokens", async () => {
    mockFetch([[/oauth\/token/, () => ({ body: { access_token: "a", refresh_token: "r", expires_in: 86400, refresh_expires_in: 999999, scope: "user.info.basic,video.publish" } })]]);
    const t = await tt.exchangeCode({ code: "c", redirectUri: "https://app/cb", codeVerifier: "v" });
    expect(t).toMatchObject({ accessToken: "a", refreshToken: "r" });
    expect(String(calls[0].init?.body)).toContain("code_verifier=v");
    expect(await tt.refreshToken(t)).toMatchObject({ accessToken: "a" });
  });
  it("requires a video to publish", async () => {
    await expect(tt.publishPost({ externalId: "u", metadata: {} }, { accessToken: "t" }, { format: "SHORT_VIDEO", caption: "x", mediaUrls: ["https://cdn/a.jpg"] })).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("design prompt", () => {
  it("constrains image prompts to the brand kit", () => {
    const p = buildImagePrompt(
      { concept: "Summer skincare", layout: "Centered product", visualElements: ["serum bottle"], textOnImage: null, palette: [] },
      { primaryColors: ["#1F3A34"], secondaryColors: ["#E9D8C4"], imageStyle: "Soft natural light", forbiddenStyles: ["heavy filters"], layoutRules: ["Generous whitespace"] },
      "CAROUSEL",
    );
    expect(p).toContain("#1F3A34");
    expect(p).toContain("Avoid: heavy filters");
    expect(sizeForFormat("STORY")).toBe("1024x1536");
  });
});
