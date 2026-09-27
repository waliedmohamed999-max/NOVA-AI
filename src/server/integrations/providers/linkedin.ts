import { form, providerFetch } from "../http";
import { emptyMetrics, ProviderError, type AccountMetrics, type AccountRef, type ConnectedAccount, type NormalizedMetrics, type PublishInput, type RemotePost, type SocialProvider, type TokenSet } from "../types";

/**
 * LinkedIn: member posting via Sign In with LinkedIn (OpenID) + w_member_social.
 * Organization pages and share statistics require the Community Management API
 * (w_organization_social, r_organization_social, rw_organization_admin).
 */
const API = "https://api.linkedin.com";
const VERSION = () => process.env.LINKEDIN_API_VERSION ?? "202506";

function headers(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "linkedin-version": VERSION(),
    "x-restli-protocol-version": "2.0.0",
    "content-type": "application/json",
  };
}

const orgAccess = () => process.env.LINKEDIN_ORGANIZATION_ACCESS === "true";

export class LinkedInProvider implements SocialProvider {
  readonly id = "linkedin" as const;
  readonly platforms: SocialProvider["platforms"] = ["LINKEDIN"];
  get scopes() {
    return ["openid", "profile", "email", "w_member_social", ...(orgAccess() ? ["w_organization_social", "r_organization_social", "rw_organization_admin"] : [])];
  }

  isConfigured() {
    return Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
  }

  connect({ state, redirectUri }: { state: string; redirectUri: string }) {
    const p = new URLSearchParams({ response_type: "code", client_id: process.env.LINKEDIN_CLIENT_ID!, redirect_uri: redirectUri, state, scope: this.scopes.join(" ") });
    return `https://www.linkedin.com/oauth/v2/authorization?${p}`;
  }

  async exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }): Promise<TokenSet> {
    const res = await providerFetch<{ access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number; scope?: string }>(
      "https://www.linkedin.com/oauth/v2/accessToken",
      form({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: process.env.LINKEDIN_CLIENT_ID!, client_secret: process.env.LINKEDIN_CLIENT_SECRET! }),
    );
    return {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? null,
      expiresAt: new Date(Date.now() + res.expires_in * 1000),
      refreshExpiresAt: res.refresh_token_expires_in ? new Date(Date.now() + res.refresh_token_expires_in * 1000) : null,
      scopes: res.scope?.split(/[ ,]/) ?? this.scopes,
    };
  }

  async listAccounts(token: TokenSet): Promise<ConnectedAccount[]> {
    const me = await providerFetch<{ sub: string; name?: string; picture?: string; email?: string }>(`${API}/v2/userinfo`, { headers: { authorization: `Bearer ${token.accessToken}` } });
    const accounts: ConnectedAccount[] = [{ externalId: `urn:li:person:${me.sub}`, platform: "LINKEDIN", name: me.name ?? "LinkedIn member", avatarUrl: me.picture ?? null, accountType: "linkedin_member" }];
    if (orgAccess()) {
      const orgs = await providerFetch<{ elements: { organization: string }[] }>(`${API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, { headers: headers(token.accessToken) }).catch(() => ({ elements: [] }));
      for (const o of orgs.elements) {
        const id = o.organization.split(":").pop()!;
        const org = await providerFetch<{ localizedName?: string }>(`${API}/rest/organizations/${id}`, { headers: headers(token.accessToken) }).catch(() => ({ localizedName: undefined }));
        accounts.push({ externalId: o.organization, platform: "LINKEDIN", name: org.localizedName ?? `Organization ${id}`, accountType: "linkedin_organization" });
      }
    }
    return accounts;
  }

  async refreshToken(token: TokenSet): Promise<TokenSet | null> {
    if (!token.refreshToken) return null; // programmatic refresh is only granted to approved LinkedIn partners
    const res = await providerFetch<{ access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number }>(
      "https://www.linkedin.com/oauth/v2/accessToken",
      form({ grant_type: "refresh_token", refresh_token: token.refreshToken, client_id: process.env.LINKEDIN_CLIENT_ID!, client_secret: process.env.LINKEDIN_CLIENT_SECRET! }),
    );
    return {
      accessToken: res.access_token,
      refreshToken: res.refresh_token ?? token.refreshToken,
      expiresAt: new Date(Date.now() + res.expires_in * 1000),
      refreshExpiresAt: res.refresh_token_expires_in ? new Date(Date.now() + res.refresh_token_expires_in * 1000) : token.refreshExpiresAt,
    };
  }

  async disconnect(token: TokenSet) {
    await providerFetch("https://www.linkedin.com/oauth/v2/revoke", form({ token: token.accessToken, client_id: process.env.LINKEDIN_CLIENT_ID!, client_secret: process.env.LINKEDIN_CLIENT_SECRET! })).catch(() => undefined);
  }

  async publishPost(account: AccountRef, token: TokenSet, input: PublishInput) {
    // Text posts go out directly. Media requires the Images API upload flow (initializeUpload → PUT), done here for a single image.
    let content: Record<string, unknown> | undefined;
    if (input.mediaUrls[0] && !/\.(mp4|mov)$/i.test(input.mediaUrls[0])) {
      const init = await providerFetch<{ value: { uploadUrl: string; image: string } }>(`${API}/rest/images?action=initializeUpload`, {
        method: "POST",
        headers: headers(token.accessToken),
        body: JSON.stringify({ initializeUploadRequest: { owner: account.externalId } }),
      });
      const media = await fetch(input.mediaUrls[0], { signal: AbortSignal.timeout(20_000) });
      await fetch(init.value.uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${token.accessToken}` }, body: Buffer.from(await media.arrayBuffer()) });
      content = { media: { id: init.value.image } };
    }
    const res = await fetch(`${API}/rest/posts`, {
      method: "POST",
      headers: headers(token.accessToken),
      body: JSON.stringify({
        author: account.externalId,
        commentary: input.caption,
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        ...(content ? { content } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const kind = res.status === 401 ? "expired" : res.status === 403 ? "permission" : res.status === 429 ? "rate_limited" : res.status >= 500 ? "unavailable" : "unknown";
      throw new ProviderError(kind, `LinkedIn post failed (${res.status})`, res.status, (await res.text()).slice(0, 500));
    }
    const id = res.headers.get("x-restli-id") ?? "";
    return { externalId: id, permalink: id ? `https://www.linkedin.com/feed/update/${id}` : null };
  }

  async schedulePost() {
    return null; // LinkedIn has no public scheduling endpoint; NOVA's scheduler publishes on time.
  }

  async getPost(_a: AccountRef, token: TokenSet, externalId: string): Promise<RemotePost | null> {
    const p = await providerFetch<{ id: string; commentary?: string; publishedAt?: number; createdAt?: number }>(`${API}/rest/posts/${encodeURIComponent(externalId)}`, { headers: headers(token.accessToken) });
    return { externalId: p.id, caption: p.commentary ?? null, permalink: `https://www.linkedin.com/feed/update/${p.id}`, publishedAt: new Date(p.publishedAt ?? p.createdAt ?? Date.now()), format: "LINKEDIN_POST" };
  }

  async getPosts(account: AccountRef, token: TokenSet, opts: { since?: Date; limit?: number }) {
    if (account.accountType !== "linkedin_organization") return []; // member post listing isn't available to third-party apps
    const res = await providerFetch<{ elements: { id: string; commentary?: string; publishedAt?: number; createdAt?: number }[] }>(
      `${API}/rest/posts?q=author&author=${encodeURIComponent(account.externalId)}&count=${Math.min(opts.limit ?? 25, 50)}`,
      { headers: headers(token.accessToken) },
    );
    return res.elements
      .map((p) => ({ externalId: p.id, caption: p.commentary ?? null, permalink: `https://www.linkedin.com/feed/update/${p.id}`, publishedAt: new Date(p.publishedAt ?? p.createdAt ?? 0), format: "LINKEDIN_POST" as const }))
      .filter((p) => !opts.since || p.publishedAt >= opts.since);
  }

  async getMetrics(account: AccountRef, token: TokenSet, externalId: string): Promise<NormalizedMetrics | null> {
    if (account.accountType !== "linkedin_organization") return null; // LinkedIn does not expose member post analytics via API
    const param = externalId.includes("ugcPost") ? "ugcPosts" : "shares";
    const res = await providerFetch<{ elements: { totalShareStatistics: { impressionCount?: number; uniqueImpressionsCount?: number; likeCount?: number; commentCount?: number; shareCount?: number; clickCount?: number } }[] }>(
      `${API}/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(account.externalId)}&${param}=List(${encodeURIComponent(externalId)})`,
      { headers: headers(token.accessToken) },
    );
    const s = res.elements[0]?.totalShareStatistics;
    if (!s) return null;
    return { ...emptyMetrics({ stats: s }), impressions: s.impressionCount ?? null, reach: s.uniqueImpressionsCount ?? null, likes: s.likeCount ?? null, comments: s.commentCount ?? null, shares: s.shareCount ?? null, clicks: s.clickCount ?? null };
  }

  async getAccountMetrics(account: AccountRef, token: TokenSet): Promise<AccountMetrics | null> {
    if (account.accountType !== "linkedin_organization") return null;
    const id = account.externalId.split(":").pop();
    const res = await providerFetch<{ firstDegreeSize?: number }>(`${API}/rest/networkSizes/urn:li:organization:${id}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, { headers: headers(token.accessToken) });
    return { followers: res.firstDegreeSize ?? null, reach: null, impressions: null, profileViews: null, raw: res };
  }
}
