import { form, providerFetch } from "../http";
import {
  emptyMetrics,
  ProviderError,
  type AccountMetrics,
  type AccountRef,
  type Capability,
  type ConnectedAccount,
  type ConnectionCheck,
  type NormalizedMetrics,
  type ProviderProfile,
  type PublishInput,
  type RemotePost,
  type SocialProvider,
  type TokenSet,
} from "../types";
import { INSTAGRAM_CAPABILITY_SCOPES, instagramScopeConfig, instagramUpgradeScopes } from "./instagram-scopes";

/**
 * Instagram API with Instagram Login ("Instagram Direct"): connects an Instagram Professional
 * account (Business or Creator) directly — no Facebook Page, no pages_show_list.
 * Uses the Instagram app credentials from the Meta dashboard (Instagram → API setup with
 * Instagram login), which are different from the Facebook App ID/secret.
 */
const V = () => process.env.INSTAGRAM_GRAPH_VERSION ?? process.env.META_GRAPH_VERSION ?? "v23.0";
const GRAPH = () => `https://graph.instagram.com/${V()}`;
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "") ?? "";

/** Professional account types returned by /me (Creator is reported as MEDIA_CREATOR). */
const PROFESSIONAL = new Set(["BUSINESS", "MEDIA_CREATOR", "CREATOR"]);

type IgError = { error?: { code?: number; error_subcode?: number; type?: string; message?: string }; error_type?: string; error_message?: string; code?: number };

function classify(_status: number, body: unknown) {
  const b = body as IgError;
  const e = b?.error;
  const code = e?.code ?? b?.code;
  const type = e?.type ?? b?.error_type;
  if (code === 190 || type === "OAuthException") return code === 10 || code === 200 ? "permission" : "expired";
  if (code === 4 || code === 17 || code === 32 || code === 613) return "rate_limited";
  if (code === 10 || ((code ?? 0) >= 200 && (code ?? 0) < 300)) return "permission";
  if (code === 9004 || code === 36003 || code === 2207026) return "invalid_media";
  return null;
}

const get = <T>(path: string, token: string, params: Record<string, string> = {}) =>
  providerFetch<T>(`${GRAPH()}${path}?${new URLSearchParams({ ...params, access_token: token })}`, { classify });
const post = <T>(path: string, token: string, data: Record<string, string>) => providerFetch<T>(`${GRAPH()}${path}`, { ...form({ ...data, access_token: token }), classify });

/** Same setup check as Meta: the Instagram App Secret is 32 hex characters, never an access token. */
export function instagramCredentialProblem(env: NodeJS.ProcessEnv = process.env): "missing" | "app_id_format" | "secret_is_access_token" | "secret_format" | null {
  const id = clean(env.INSTAGRAM_APP_ID);
  const secret = clean(env.INSTAGRAM_APP_SECRET);
  if (!id || !secret) return "missing";
  if (!/^\d{5,20}$/.test(id)) return "app_id_format";
  if (/^(EAA|IG[A-Z])/.test(secret)) return "secret_is_access_token";
  if (!/^[0-9a-f]{32}$/i.test(secret)) return "secret_format";
  return null;
}

type Me = { id?: string; user_id?: string; username?: string; name?: string; account_type?: string; profile_picture_url?: string; followers_count?: number; media_count?: number };

export class InstagramProvider implements SocialProvider {
  readonly id = "instagram" as const;
  readonly platforms: SocialProvider["platforms"] = ["INSTAGRAM"];

  get scopes() {
    return instagramScopeConfig().requested;
  }

  isConfigured() {
    return instagramCredentialProblem() === null;
  }

  upgradeScopes(_platform: string, capability: string, alreadyGranted: string[]) {
    return instagramUpgradeScopes(capability, alreadyGranted);
  }

  connect({ state, redirectUri, scopes, rerequest }: { state: string; redirectUri: string; scopes?: string[]; rerequest?: boolean }) {
    const p = new URLSearchParams({ client_id: clean(process.env.INSTAGRAM_APP_ID), redirect_uri: redirectUri, response_type: "code", scope: (scopes ?? this.scopes).join(","), state });
    p.set("enable_fb_login", "0");
    if (rerequest) p.set("force_reauth", "true");
    return `https://www.instagram.com/oauth/authorize?${p}`;
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }): Promise<TokenSet> {
    // Instagram appends "#_" to the code in the redirect in some clients; it is not part of the code.
    const res = await providerFetch<{ access_token?: string; user_id?: string | number; permissions?: string | string[]; data?: { access_token: string; user_id: string | number; permissions?: string | string[] }[] }>(
      "https://api.instagram.com/oauth/access_token",
      { ...form({ client_id: clean(process.env.INSTAGRAM_APP_ID), client_secret: clean(process.env.INSTAGRAM_APP_SECRET), grant_type: "authorization_code", redirect_uri: redirectUri, code: code.replace(/#_$/, "") }), classify },
    );
    const short = res.data?.[0] ?? res;
    if (!short.access_token) throw new ProviderError("unknown", "Instagram returned no access token");
    const permissions = short.permissions;
    const scopes = Array.isArray(permissions) ? permissions : typeof permissions === "string" ? permissions.split(/[\s,]+/).filter(Boolean) : undefined;
    // Exchange for a long-lived (~60 day) token, server-side.
    const long = await providerFetch<{ access_token: string; expires_in?: number }>(
      `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: clean(process.env.INSTAGRAM_APP_SECRET), access_token: short.access_token })}`,
      { classify },
    );
    return { accessToken: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null, scopes };
  }

  async grantedScopes(token: TokenSet) {
    return token.scopes ?? [];
  }

  private async me(token: string) {
    return get<Me>("/me", token, { fields: "id,user_id,username,name,account_type,profile_picture_url,followers_count,media_count" });
  }

  /** Exactly one account: the Instagram Professional account that signed in. Personal accounts are refused. */
  async listAccounts(token: TokenSet): Promise<ConnectedAccount[]> {
    const me = await this.me(token.accessToken);
    const type = (me.account_type ?? "").toUpperCase();
    if (!PROFESSIONAL.has(type)) throw new ProviderError("not_supported", "Instagram account is not a professional account", undefined, "personal_account");
    const externalId = String(me.user_id ?? me.id);
    return [
      {
        externalId,
        platform: "INSTAGRAM",
        name: me.name || me.username || "Instagram",
        handle: me.username ? `@${me.username}` : null,
        avatarUrl: me.profile_picture_url ?? null,
        accountType: "instagram_login",
        metadata: { professionalType: type === "BUSINESS" ? "BUSINESS" : "CREATOR", appScopedId: me.id ?? null },
      },
    ];
  }

  capabilities(_account: unknown, scopes: string[]): Capability[] {
    return (Object.entries(INSTAGRAM_CAPABILITY_SCOPES) as [Capability["key"], string[]][]).map(([key, need]) =>
      need.every((s) => scopes.includes(s)) ? { key, available: true } : { key, available: false, reason: key === "messages" || key === "comments" ? "requires_approval" : "permission_missing" },
    );
  }

  async getProfile(token: TokenSet): Promise<ProviderProfile> {
    const me = await this.me(token.accessToken);
    return { id: String(me.user_id ?? me.id), name: me.username ? `@${me.username}` : (me.name ?? "Instagram"), avatarUrl: me.profile_picture_url ?? null };
  }

  /** A profile read validates the token (Instagram Login has no debug_token endpoint). */
  async checkConnection(token: TokenSet): Promise<ConnectionCheck> {
    try {
      const me = await this.me(token.accessToken);
      const type = (me.account_type ?? "").toUpperCase();
      return { valid: PROFESSIONAL.has(type), expiresAt: token.expiresAt ?? null, scopes: [], profile: { id: String(me.user_id ?? me.id), name: me.username ? `@${me.username}` : (me.name ?? "Instagram") }, detail: PROFESSIONAL.has(type) ? undefined : "personal_account" };
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "expired") return { valid: false, scopes: [], detail: "token_invalid" };
      throw err;
    }
  }

  async refreshToken(token: TokenSet): Promise<TokenSet | null> {
    // Long-lived Instagram tokens can be refreshed once they are at least 24h old and still valid.
    const res = await providerFetch<{ access_token: string; expires_in?: number }>(
      `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token.accessToken })}`,
      { classify },
    );
    return { accessToken: res.access_token, expiresAt: res.expires_in ? new Date(Date.now() + res.expires_in * 1000) : null, scopes: token.scopes };
  }

  /** Instagram Login has no token-revocation endpoint; NOVA deletes the stored token (see disconnectIntegration). */
  async disconnect() {}

  async publishPost(account: AccountRef, token: TokenSet, input: PublishInput) {
    if (input.mediaUrls.length === 0) throw new ProviderError("invalid_media", "Instagram posts require at least one image or video");
    const ig = account.externalId;
    const isVideo = (u: string) => /\.(mp4|mov)$/i.test(u);
    let creationId: string;
    if (input.format === "CAROUSEL" && input.mediaUrls.length > 1) {
      const children: string[] = [];
      for (const url of input.mediaUrls.slice(0, 10)) {
        const c = await post<{ id: string }>(`/${ig}/media`, token.accessToken, isVideo(url) ? { media_type: "VIDEO", video_url: url, is_carousel_item: "true" } : { image_url: url, is_carousel_item: "true" });
        children.push(c.id);
      }
      creationId = (await post<{ id: string }>(`/${ig}/media`, token.accessToken, { media_type: "CAROUSEL", children: children.join(","), caption: input.caption })).id;
    } else if (input.format === "REEL" || input.format === "SHORT_VIDEO" || isVideo(input.mediaUrls[0])) {
      creationId = (await post<{ id: string }>(`/${ig}/media`, token.accessToken, { media_type: "REELS", video_url: input.mediaUrls[0], caption: input.caption })).id;
      await this.waitForContainer(creationId, token.accessToken);
    } else if (input.format === "STORY") {
      creationId = (await post<{ id: string }>(`/${ig}/media`, token.accessToken, { media_type: "STORIES", image_url: input.mediaUrls[0] })).id;
    } else {
      creationId = (await post<{ id: string }>(`/${ig}/media`, token.accessToken, { image_url: input.mediaUrls[0], caption: input.caption })).id;
    }
    const published = await post<{ id: string }>(`/${ig}/media_publish`, token.accessToken, { creation_id: creationId });
    const meta = await get<{ permalink?: string }>(`/${published.id}`, token.accessToken, { fields: "permalink" }).catch(() => ({ permalink: undefined }));
    return { externalId: published.id, permalink: meta.permalink ?? null };
  }

  private async waitForContainer(id: string, token: string) {
    for (let i = 0; i < 20; i++) {
      const s = await get<{ status_code?: string }>(`/${id}`, token, { fields: "status_code" });
      if (s.status_code === "FINISHED") return;
      if (s.status_code === "ERROR") throw new ProviderError("invalid_media", "Instagram could not process the video");
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new ProviderError("unavailable", "Instagram video processing timed out");
  }

  /** Instagram has no native scheduling API; NOVA's scheduler publishes at the right time. */
  async schedulePost() {
    return null;
  }

  async getPost(account: AccountRef, token: TokenSet, externalId: string): Promise<RemotePost | null> {
    const m = await get<{ id: string; caption?: string; media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp: string }>(`/${externalId}`, token.accessToken, {
      fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
    });
    return { externalId: m.id, caption: m.caption ?? null, permalink: m.permalink ?? null, mediaUrl: m.thumbnail_url ?? m.media_url ?? null, publishedAt: new Date(m.timestamp) };
  }

  async getPosts(account: AccountRef, token: TokenSet, opts: { since?: Date; limit?: number }): Promise<RemotePost[]> {
    const res = await get<{ data: { id: string; caption?: string; media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp: string }[] }>(`/${account.externalId}/media`, token.accessToken, {
      fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
      limit: String(Math.min(opts.limit ?? 25, 50)),
    });
    return res.data
      .map((m) => ({ externalId: m.id, caption: m.caption ?? null, permalink: m.permalink ?? null, mediaUrl: m.thumbnail_url ?? m.media_url ?? null, format: m.media_type === "CAROUSEL_ALBUM" ? ("CAROUSEL" as const) : m.media_type === "VIDEO" ? ("REEL" as const) : ("POST" as const), publishedAt: new Date(m.timestamp) }))
      .filter((p) => !opts.since || p.publishedAt >= opts.since);
  }

  /** Needs instagram_business_manage_insights; returns null (never invented numbers) when it isn't granted. */
  async getMetrics(account: AccountRef, token: TokenSet, externalId: string): Promise<NormalizedMetrics | null> {
    try {
      const res = await get<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(`/${externalId}/insights`, token.accessToken, { metric: "reach,likes,comments,shares,saved,views" });
      const v = (n: string) => {
        const m = res.data.find((d) => d.name === n);
        return m ? (m.total_value?.value ?? m.values?.[0]?.value ?? null) : null;
      };
      return { ...emptyMetrics({ insights: res.data }), reach: v("reach"), impressions: v("views"), likes: v("likes"), comments: v("comments"), shares: v("shares"), saves: v("saved"), videoViews: v("views") };
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "permission") return null;
      throw err;
    }
  }

  /**
   * Read-only live checks for the admin diagnostics (insights / comments / messages). Each call needs its
   * permission; nothing is written, replied to or published.
   */
  async featureCheck(account: AccountRef, token: TokenSet, feature: "insights" | "comments" | "messages"): Promise<string> {
    const id = account.externalId;
    if (feature === "insights") {
      const r = await get<{ data: { name: string }[] }>(`/${id}/insights`, token.accessToken, { metric: "reach", period: "day" });
      return `insights: ${r.data.map((d) => d.name).join(", ") || "no data yet"}`;
    }
    if (feature === "comments") {
      const media = await get<{ data: { id: string; comments_count?: number }[] }>(`/${id}/media`, token.accessToken, { fields: "id,comments_count", limit: "1" });
      if (!media.data.length) return "comments: no media yet (permission accepted)";
      const c = await get<{ data: unknown[] }>(`/${media.data[0].id}/comments`, token.accessToken, { limit: "5" });
      return `comments: read ${c.data.length} on latest media`;
    }
    const conv = await get<{ data: unknown[] }>(`/${id}/conversations`, token.accessToken, { platform: "instagram", limit: "1" });
    return `messages: ${conv.data.length} conversation(s) readable`;
  }

  async getAccountMetrics(account: AccountRef, token: TokenSet): Promise<AccountMetrics | null> {
    const me = await this.me(token.accessToken);
    return { followers: me.followers_count ?? null, reach: null, impressions: null, profileViews: null, raw: { media_count: me.media_count ?? null } };
  }
}
