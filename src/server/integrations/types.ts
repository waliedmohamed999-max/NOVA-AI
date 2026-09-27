import type { ContentFormat, SocialPlatform } from "@/generated/prisma/enums";

export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
  scopes?: string[];
};

export type ConnectedAccount = {
  externalId: string;
  platform: SocialPlatform;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  accountType?: string;
  /** Account-specific token (e.g. Facebook Page token). Falls back to the user token. */
  token?: TokenSet;
  metadata?: Record<string, unknown>;
};

export type AccountRef = { externalId: string; accountType?: string | null; metadata: Record<string, unknown> };

export type PublishInput = {
  format: ContentFormat;
  caption: string;
  /** Publicly reachable media URLs (platforms fetch media themselves). */
  mediaUrls: string[];
  link?: string | null;
};

export type PublishResult = { externalId: string; permalink?: string | null };

/** Normalized metrics. `null` = the platform does not expose this metric. */
export type NormalizedMetrics = {
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  videoViews: number | null;
  followersGained: number | null;
  raw: Record<string, unknown>;
};

export type RemotePost = {
  externalId: string;
  permalink?: string | null;
  caption?: string | null;
  mediaUrl?: string | null;
  format?: ContentFormat | null;
  publishedAt: Date;
  metrics?: NormalizedMetrics | null;
};

export type AccountMetrics = { followers: number | null; reach: number | null; impressions: number | null; profileViews: number | null; raw: Record<string, unknown> };

/**
 * Social provider abstraction. Implementations call official platform APIs
 * only — never scraping or password automation.
 */
export interface SocialProvider {
  readonly id: "meta" | "linkedin" | "tiktok";
  readonly platforms: SocialPlatform[];
  readonly scopes: string[];
  isConfigured(): boolean;
  /** Builds the authorization URL (the OAuth "connect" step). */
  connect(opts: { state: string; redirectUri: string; codeChallenge?: string }): string;
  exchangeCode(opts: { code: string; redirectUri: string; codeVerifier?: string }): Promise<TokenSet>;
  listAccounts(token: TokenSet): Promise<ConnectedAccount[]>;
  refreshToken(token: TokenSet): Promise<TokenSet | null>;
  disconnect(token: TokenSet): Promise<void>;
  publishPost(account: AccountRef, token: TokenSet, input: PublishInput): Promise<PublishResult>;
  /** Native scheduling where the platform supports it; otherwise NOVA's scheduler publishes at the right time. */
  schedulePost(account: AccountRef, token: TokenSet, input: PublishInput, at: Date): Promise<PublishResult | null>;
  getPost(account: AccountRef, token: TokenSet, externalId: string): Promise<RemotePost | null>;
  getPosts(account: AccountRef, token: TokenSet, opts: { since?: Date; limit?: number }): Promise<RemotePost[]>;
  getMetrics(account: AccountRef, token: TokenSet, externalId: string): Promise<NormalizedMetrics | null>;
  getAccountMetrics(account: AccountRef, token: TokenSet): Promise<AccountMetrics | null>;
}

export type ProviderErrorKind = "expired" | "permission" | "rate_limited" | "invalid_media" | "not_supported" | "unavailable" | "unknown";

/** Carries a normalized kind so the UI can show human-friendly messages; raw detail goes to logs only. */
export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    message: string,
    public status?: number,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function emptyMetrics(raw: Record<string, unknown> = {}): NormalizedMetrics {
  return { reach: null, impressions: null, likes: null, comments: null, shares: null, saves: null, clicks: null, videoViews: null, followersGained: null, raw };
}
