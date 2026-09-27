import { form, providerFetch } from "../http";
import { emptyMetrics, ProviderError, type AccountMetrics, type AccountRef, type ConnectedAccount, type NormalizedMetrics, type PublishInput, type RemotePost, type SocialProvider, type TokenSet } from "../types";

/**
 * TikTok for Developers: Login Kit (OAuth v2) + Content Posting API + Display API.
 * Direct posting requires an audited app; unaudited apps can only post privately.
 * PULL_FROM_URL requires the media domain to be verified in the TikTok developer portal.
 */
const API = "https://open.tiktokapis.com/v2";

type TikTokEnvelope<T> = { data: T; error?: { code: string; message?: string } };

function check<T>(res: TikTokEnvelope<T>): T {
  if (res.error && res.error.code !== "ok") {
    const code = res.error.code;
    throw new ProviderError(code === "access_token_invalid" ? "expired" : code === "rate_limit_exceeded" ? "rate_limited" : code.startsWith("scope") ? "permission" : "unknown", `TikTok error: ${code}`);
  }
  return res.data;
}

const auth = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json; charset=UTF-8" });

export class TikTokProvider implements SocialProvider {
  readonly id = "tiktok" as const;
  readonly platforms: SocialProvider["platforms"] = ["TIKTOK"];
  readonly scopes = ["user.info.basic", "user.info.stats", "video.list", "video.publish"];

  isConfigured() {
    return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
  }

  connect({ state, redirectUri, codeChallenge }: { state: string; redirectUri: string; codeChallenge?: string }) {
    const p = new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, response_type: "code", scope: this.scopes.join(","), redirect_uri: redirectUri, state });
    if (codeChallenge) {
      p.set("code_challenge", codeChallenge);
      p.set("code_challenge_method", "S256");
    }
    return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
  }

  private async token(body: Record<string, string>): Promise<TokenSet> {
    const res = await providerFetch<{ access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number; scope: string; error?: string }>(
      `${API}/oauth/token/`,
      form({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, ...body }),
    );
    if (res.error || !res.access_token) throw new ProviderError("expired", "TikTok token request failed");
    return {
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      expiresAt: new Date(Date.now() + res.expires_in * 1000),
      refreshExpiresAt: new Date(Date.now() + res.refresh_expires_in * 1000),
      scopes: res.scope.split(","),
    };
  }

  exchangeCode({ code, redirectUri, codeVerifier }: { code: string; redirectUri: string; codeVerifier?: string }) {
    return this.token({ code, grant_type: "authorization_code", redirect_uri: redirectUri, ...(codeVerifier ? { code_verifier: codeVerifier } : {}) });
  }

  async listAccounts(token: TokenSet): Promise<ConnectedAccount[]> {
    const data = check(
      await providerFetch<TikTokEnvelope<{ user: { open_id: string; display_name: string; avatar_url?: string; username?: string } }>>(`${API}/user/info/?fields=open_id,display_name,avatar_url,username`, {
        headers: auth(token.accessToken),
      }),
    );
    return [{ externalId: data.user.open_id, platform: "TIKTOK", name: data.user.display_name, handle: data.user.username ? `@${data.user.username}` : null, avatarUrl: data.user.avatar_url ?? null, accountType: "tiktok_user" }];
  }

  refreshToken(token: TokenSet) {
    if (!token.refreshToken) return Promise.resolve(null);
    return this.token({ grant_type: "refresh_token", refresh_token: token.refreshToken });
  }

  async disconnect(token: TokenSet) {
    await providerFetch(`${API}/oauth/revoke/`, form({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, token: token.accessToken })).catch(() => undefined);
  }

  async publishPost(_account: AccountRef, token: TokenSet, input: PublishInput) {
    const video = input.mediaUrls.find((u) => /\.(mp4|mov|webm)$/i.test(u));
    if (!video) throw new ProviderError("invalid_media", "TikTok posts require a video");
    const creator = check(await providerFetch<TikTokEnvelope<{ privacy_level_options: string[] }>>(`${API}/post/publish/creator_info/query/`, { method: "POST", headers: auth(token.accessToken) }));
    const privacy = creator.privacy_level_options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : creator.privacy_level_options[0];
    const init = check(
      await providerFetch<TikTokEnvelope<{ publish_id: string }>>(`${API}/post/publish/video/init/`, {
        method: "POST",
        headers: auth(token.accessToken),
        body: JSON.stringify({
          post_info: { title: input.caption.slice(0, 2200), privacy_level: privacy, disable_comment: false },
          source_info: { source: "PULL_FROM_URL", video_url: video },
        }),
      }),
    );
    // Publishing completes asynchronously; the publish_id is resolved to a video id during sync.
    return { externalId: `publish:${init.publish_id}`, permalink: null };
  }

  async schedulePost() {
    return null;
  }

  async getPost(account: AccountRef, token: TokenSet, externalId: string) {
    const posts = await this.query(token, [externalId]);
    return posts[0] ?? null;
  }

  private async query(token: TokenSet, ids: string[]): Promise<RemotePost[]> {
    const data = check(
      await providerFetch<TikTokEnvelope<{ videos: TikTokVideo[] }>>(`${API}/video/query/?fields=${VIDEO_FIELDS}`, {
        method: "POST",
        headers: auth(token.accessToken),
        body: JSON.stringify({ filters: { video_ids: ids } }),
      }),
    );
    return data.videos.map(toRemote);
  }

  async getPosts(_account: AccountRef, token: TokenSet, opts: { since?: Date; limit?: number }) {
    const data = check(
      await providerFetch<TikTokEnvelope<{ videos: TikTokVideo[] }>>(`${API}/video/list/?fields=${VIDEO_FIELDS}`, {
        method: "POST",
        headers: auth(token.accessToken),
        body: JSON.stringify({ max_count: Math.min(opts.limit ?? 20, 20) }),
      }),
    );
    return data.videos.map(toRemote).filter((p) => !opts.since || p.publishedAt >= opts.since);
  }

  async getMetrics(account: AccountRef, token: TokenSet, externalId: string): Promise<NormalizedMetrics | null> {
    const post = await this.getPost(account, token, externalId);
    return post?.metrics ?? null;
  }

  async getAccountMetrics(_account: AccountRef, token: TokenSet): Promise<AccountMetrics | null> {
    const data = check(await providerFetch<TikTokEnvelope<{ user: { follower_count?: number } }>>(`${API}/user/info/?fields=follower_count`, { headers: auth(token.accessToken) }));
    return { followers: data.user.follower_count ?? null, reach: null, impressions: null, profileViews: null, raw: data.user };
  }
}

type TikTokVideo = { id: string; title?: string; video_description?: string; share_url?: string; cover_image_url?: string; create_time: number; like_count?: number; comment_count?: number; share_count?: number; view_count?: number };
const VIDEO_FIELDS = "id,title,video_description,share_url,cover_image_url,create_time,like_count,comment_count,share_count,view_count";

function toRemote(v: TikTokVideo): RemotePost {
  return {
    externalId: v.id,
    caption: v.video_description ?? v.title ?? null,
    permalink: v.share_url ?? null,
    mediaUrl: v.cover_image_url ?? null,
    format: "SHORT_VIDEO",
    publishedAt: new Date(v.create_time * 1000),
    metrics: { ...emptyMetrics({ video: v }), likes: v.like_count ?? null, comments: v.comment_count ?? null, shares: v.share_count ?? null, videoViews: v.view_count ?? null, impressions: v.view_count ?? null },
  };
}
