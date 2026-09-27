import { form, providerFetch } from "../http";
import { metaScopeConfig } from "./meta-scopes";
import { emptyMetrics, ProviderError, type AccountMetrics, type AccountRef, type Capability, type ConnectedAccount, type ConnectionCheck, type NormalizedMetrics, type ProviderProfile, type PublishInput, type RemotePost, type SocialProvider, type TokenSet } from "../types";

/**
 * Meta Graph API: Facebook Pages + Instagram professional accounts linked to
 * those Pages. Requires a Meta app with the listed permissions approved.
 */
const V = () => process.env.META_GRAPH_VERSION ?? "v23.0";
const GRAPH = () => `https://graph.facebook.com/${V()}`;

type GraphError = { error?: { code?: number; error_subcode?: number; type?: string; message?: string } };

function classify(status: number, body: unknown) {
  const e = (body as GraphError)?.error;
  if (!e) return null;
  if (e.code === 190 || e.type === "OAuthException") return e.code === 10 || e.code === 200 ? "permission" : "expired";
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return "rate_limited";
  if (e.code === 10 || ((e.code ?? 0) >= 200 && (e.code ?? 0) < 300)) return "permission";
  if (e.code === 9004 || e.code === 36003) return "invalid_media";
  return null;
}

const get = <T>(path: string, token: string, params: Record<string, string> = {}) =>
  providerFetch<T>(`${GRAPH()}${path}?${new URLSearchParams({ ...params, access_token: token })}`, { classify });
const post = <T>(path: string, token: string, data: Record<string, string>) => providerFetch<T>(`${GRAPH()}${path}`, { ...form({ ...data, access_token: token }), classify });

function isInstagram(a: AccountRef) {
  return a.accountType === "instagram_business";
}

function sumInsight(data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[], name: string): number | null {
  const m = data.find((d) => d.name === name);
  if (!m) return null;
  return m.total_value?.value ?? m.values?.[0]?.value ?? null;
}

export class MetaProvider implements SocialProvider {
  readonly id = "meta" as const;
  readonly platforms: SocialProvider["platforms"] = ["FACEBOOK", "INSTAGRAM"];
  /** Configured, never hardcoded: see meta-scopes.ts (META_PERMISSION_MODE / META_OAUTH_SCOPES). */
  get scopes() {
    return metaScopeConfig().requested;
  }

  isConfigured() {
    return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
  }

  connect({ state, redirectUri, scopes, rerequest }: { state: string; redirectUri: string; scopes?: string[]; rerequest?: boolean }) {
    const cfg = metaScopeConfig();
    const p = new URLSearchParams({ client_id: process.env.META_APP_ID!, redirect_uri: redirectUri, state, response_type: "code" });
    // Facebook Login for Business: the permission set lives in the login configuration, not in `scope`.
    if (cfg.configId && !scopes) p.set("config_id", cfg.configId);
    else p.set("scope", (scopes ?? cfg.requested).join(","));
    // Re-prompt for permissions the user previously declined (permission upgrades).
    if (rerequest) p.set("auth_type", "rerequest");
    return `https://www.facebook.com/${V()}/dialog/oauth?${p}`;
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }): Promise<TokenSet> {
    const short = await providerFetch<{ access_token: string }>(
      `${GRAPH()}/oauth/access_token?${new URLSearchParams({ client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, redirect_uri: redirectUri, code })}`,
      { classify },
    );
    // Exchange for a long-lived (~60 day) user token.
    const long = await providerFetch<{ access_token: string; expires_in?: number }>(
      `${GRAPH()}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, fb_exchange_token: short.access_token })}`,
      { classify },
    );
    const token: TokenSet = { accessToken: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null };
    // Store what the user actually granted — they can untick permissions in the Meta dialog.
    token.scopes = await this.grantedScopes(token);
    return token;
  }

  async grantedScopes(token: TokenSet): Promise<string[]> {
    const res = await get<{ data: { permission: string; status: string }[] }>("/me/permissions", token.accessToken);
    return res.data.filter((p) => p.status === "granted").map((p) => p.permission);
  }

  /**
   * Derived from granted permissions and, for Pages, the user's tasks on that Page.
   * Nothing is reported as available unless the permission was actually granted.
   */
  capabilities(account: { platform: string; accountType?: string | null; metadata?: Record<string, unknown> }, scopes: string[]): Capability[] {
    const has = (...p: string[]) => p.every((x) => scopes.includes(x));
    const cap = (key: Capability["key"], ok: boolean, reason = "permission_missing"): Capability => (ok ? { key, available: true } : { key, available: false, reason });
    if (account.accountType === "instagram_business" || account.platform === "INSTAGRAM") {
      return [
        cap("identity", has("instagram_basic")),
        cap("instagram_publishing", has("instagram_basic", "instagram_content_publish")),
        cap("metrics", has("instagram_basic", "instagram_manage_insights")),
        cap("messages", has("instagram_manage_messages"), "requires_approval"),
      ];
    }
    const tasks = Array.isArray(account.metadata?.tasks) ? (account.metadata.tasks as string[]) : null;
    const task = (t: string) => tasks === null || tasks.includes(t) || tasks.includes("MANAGE");
    return [
      cap("identity", has("pages_show_list")),
      cap("publish", has("pages_manage_posts") && task("CREATE_CONTENT"), has("pages_manage_posts") ? "page_role" : "permission_missing"),
      cap("metrics", (has("read_insights") || has("pages_read_engagement")) && task("ANALYZE")),
      cap("page_management", has("pages_manage_metadata") && task("MANAGE"), "requires_approval"),
      cap("messages", has("pages_messaging") && task("MESSAGING"), "requires_approval"),
      cap("leads", has("leads_retrieval"), "requires_approval"),
    ];
  }

  async getProfile(token: TokenSet): Promise<ProviderProfile> {
    const me = await get<{ id: string; name?: string; picture?: { data?: { url?: string } } }>("/me", token.accessToken, { fields: "id,name,picture{url}" });
    return { id: me.id, name: me.name ?? "Meta user", avatarUrl: me.picture?.data?.url ?? null };
  }

  /** Validates the token with Meta's debug_token (app access token, server-side only). */
  async checkConnection(token: TokenSet): Promise<ConnectionCheck> {
    const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
    const res = await get<{ data: { is_valid: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; error?: { message?: string } } }>("/debug_token", appToken, { input_token: token.accessToken });
    const d = res.data;
    return {
      valid: Boolean(d.is_valid),
      expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null,
      scopes: d.scopes ?? [],
      detail: d.is_valid ? undefined : "token_invalid",
    };
  }

  async listAccounts(token: TokenSet): Promise<ConnectedAccount[]> {
    // Page discovery needs pages_show_list; without it Meta returns nothing useful, so don't ask.
    if (token.scopes && !token.scopes.includes("pages_show_list")) return [];
    const pages = await get<{ data: { id: string; name: string; access_token: string; tasks?: string[]; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } }[] }>(
      "/me/accounts",
      token.accessToken,
      { fields: "id,name,access_token,tasks,picture{url},instagram_business_account{id,username,profile_picture_url}", limit: "50" },
    );
    const out: ConnectedAccount[] = [];
    for (const p of pages.data) {
      // Page tokens derived from a long-lived user token do not expire.
      const pageToken: TokenSet = { accessToken: p.access_token, expiresAt: null };
      out.push({ externalId: p.id, platform: "FACEBOOK", name: p.name, avatarUrl: p.picture?.data?.url ?? null, accountType: "facebook_page", token: pageToken, metadata: p.tasks ? { tasks: p.tasks } : {} });
      // Not every Page has an Instagram professional account linked — only add one when Meta returns it.
      if (p.instagram_business_account) {
        const ig = p.instagram_business_account;
        out.push({
          externalId: ig.id,
          platform: "INSTAGRAM",
          name: ig.username ?? p.name,
          handle: ig.username ? `@${ig.username}` : null,
          avatarUrl: ig.profile_picture_url ?? null,
          accountType: "instagram_business",
          token: pageToken,
          metadata: { pageId: p.id },
        });
      }
    }
    return out;
  }

  async refreshToken(token: TokenSet): Promise<TokenSet | null> {
    // Long-lived user tokens can be re-exchanged before they expire.
    const res = await providerFetch<{ access_token: string; expires_in?: number }>(
      `${GRAPH()}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, fb_exchange_token: token.accessToken })}`,
      { classify },
    );
    return { accessToken: res.access_token, expiresAt: res.expires_in ? new Date(Date.now() + res.expires_in * 1000) : null };
  }

  async disconnect(token: TokenSet) {
    await providerFetch(`${GRAPH()}/me/permissions?access_token=${encodeURIComponent(token.accessToken)}`, { method: "DELETE", classify }).catch(() => undefined);
  }

  async publishPost(account: AccountRef, token: TokenSet, input: PublishInput) {
    if (isInstagram(account)) return this.publishInstagram(account, token, input);
    if (input.mediaUrls.length === 1 && !/\.(mp4|mov)$/i.test(input.mediaUrls[0])) {
      const res = await post<{ id: string; post_id?: string }>(`/${account.externalId}/photos`, token.accessToken, { url: input.mediaUrls[0], caption: input.caption });
      return { externalId: res.post_id ?? res.id, permalink: `https://www.facebook.com/${res.post_id ?? res.id}` };
    }
    const res = await post<{ id: string }>(`/${account.externalId}/feed`, token.accessToken, { message: input.caption, ...(input.link ? { link: input.link } : {}) });
    return { externalId: res.id, permalink: `https://www.facebook.com/${res.id}` };
  }

  private async publishInstagram(account: AccountRef, token: TokenSet, input: PublishInput) {
    if (input.mediaUrls.length === 0) throw new ProviderError("invalid_media", "Instagram posts require at least one image or video");
    const ig = account.externalId;
    let creationId: string;
    const isVideo = (u: string) => /\.(mp4|mov)$/i.test(u);
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

  async schedulePost(account: AccountRef, token: TokenSet, input: PublishInput, at: Date) {
    // Facebook Pages support native scheduling (10 min – 30 days ahead); Instagram does not.
    if (isInstagram(account) || input.mediaUrls.length) return null;
    const res = await post<{ id: string }>(`/${account.externalId}/feed`, token.accessToken, {
      message: input.caption,
      published: "false",
      scheduled_publish_time: String(Math.floor(at.getTime() / 1000)),
    });
    return { externalId: res.id };
  }

  async getPost(account: AccountRef, token: TokenSet, externalId: string): Promise<RemotePost | null> {
    const fields = isInstagram(account) ? "id,caption,permalink,media_url,media_type,timestamp" : "id,message,permalink_url,full_picture,created_time";
    const p = await get<Record<string, string>>(`/${externalId}`, token.accessToken, { fields });
    return this.toRemote(account, p);
  }

  private toRemote(account: AccountRef, p: Record<string, string>): RemotePost {
    if (isInstagram(account)) {
      const t = p.media_type;
      return { externalId: p.id, caption: p.caption ?? null, permalink: p.permalink ?? null, mediaUrl: p.media_url ?? null, format: t === "CAROUSEL_ALBUM" ? "CAROUSEL" : t === "VIDEO" ? "REEL" : "POST", publishedAt: new Date(p.timestamp) };
    }
    return { externalId: p.id, caption: p.message ?? null, permalink: p.permalink_url ?? null, mediaUrl: p.full_picture ?? null, format: "POST", publishedAt: new Date(p.created_time) };
  }

  async getPosts(account: AccountRef, token: TokenSet, opts: { since?: Date; limit?: number }) {
    const limit = String(Math.min(opts.limit ?? 25, 50));
    const res = isInstagram(account)
      ? await get<{ data: Record<string, string>[] }>(`/${account.externalId}/media`, token.accessToken, { fields: "id,caption,permalink,media_url,media_type,timestamp", limit })
      : await get<{ data: Record<string, string>[] }>(`/${account.externalId}/posts`, token.accessToken, { fields: "id,message,permalink_url,full_picture,created_time", limit });
    return res.data.map((p) => this.toRemote(account, p)).filter((p) => !opts.since || p.publishedAt >= opts.since);
  }

  async getMetrics(account: AccountRef, token: TokenSet, externalId: string): Promise<NormalizedMetrics | null> {
    if (isInstagram(account)) {
      const res = await get<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(`/${externalId}/insights`, token.accessToken, {
        metric: "reach,likes,comments,shares,saved,views,total_interactions",
      });
      return {
        ...emptyMetrics({ insights: res.data }),
        reach: sumInsight(res.data, "reach"),
        impressions: sumInsight(res.data, "views"),
        likes: sumInsight(res.data, "likes"),
        comments: sumInsight(res.data, "comments"),
        shares: sumInsight(res.data, "shares"),
        saves: sumInsight(res.data, "saved"),
        videoViews: sumInsight(res.data, "views"),
      };
    }
    const [insights, social] = await Promise.all([
      get<{ data: { name: string; values?: { value: number }[] }[] }>(`/${externalId}/insights`, token.accessToken, { metric: "post_impressions,post_impressions_unique,post_clicks" }).catch(() => ({ data: [] })),
      get<{ reactions?: { summary?: { total_count: number } }; comments?: { summary?: { total_count: number } }; shares?: { count: number } }>(`/${externalId}`, token.accessToken, {
        fields: "reactions.summary(total_count),comments.summary(total_count),shares",
      }),
    ]);
    return {
      ...emptyMetrics({ insights: insights.data, social }),
      impressions: sumInsight(insights.data, "post_impressions"),
      reach: sumInsight(insights.data, "post_impressions_unique"),
      clicks: sumInsight(insights.data, "post_clicks"),
      likes: social.reactions?.summary?.total_count ?? null,
      comments: social.comments?.summary?.total_count ?? null,
      shares: social.shares?.count ?? 0,
    };
  }

  async getAccountMetrics(account: AccountRef, token: TokenSet): Promise<AccountMetrics | null> {
    if (isInstagram(account)) {
      const res = await get<{ followers_count?: number }>(`/${account.externalId}`, token.accessToken, { fields: "followers_count" });
      return { followers: res.followers_count ?? null, reach: null, impressions: null, profileViews: null, raw: res };
    }
    const res = await get<{ followers_count?: number; fan_count?: number }>(`/${account.externalId}`, token.accessToken, { fields: "followers_count,fan_count" });
    return { followers: res.followers_count ?? res.fan_count ?? null, reach: null, impressions: null, profileViews: null, raw: res };
  }
}
