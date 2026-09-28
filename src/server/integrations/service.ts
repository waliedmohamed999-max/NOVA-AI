import { createHash } from "node:crypto";
import { reportError } from "../observability";
import type { IntegrationStatus, Provider, SocialPlatform } from "@/generated/prisma/enums";
import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { decryptSecret, encryptSecret, hashToken, randomToken } from "../crypto";
import { audit } from "../audit";
import { notify } from "../notifications/service";
import { logger } from "../logger";
import { UserFacingError } from "../errors";
import { assertWithinLimit } from "../billing/entitlements";
import { SOCIAL_PROVIDERS, redirectUriFor } from "./registry";
import { ProviderError, type AccountRef, type SocialProvider, type TokenSet } from "./types";

const STATE_TTL_MS = 10 * 60_000;

/** Meta sign-in succeeded but no Page is manageable yet; not a channel (doesn't count toward plan limits). */
export const META_IDENTITY_ONLY = "identity_only";

/** Where customers manage accounts after onboarding. */
export const CONNECTED_ACCOUNTS_PATH = "/settings/connected-accounts";
export const ONBOARDING_CONNECT_PATH = "/onboarding/connect";

/**
 * OAuth return context. Only these two in-app destinations are ever used after a callback,
 * so a crafted `return` parameter can never become an open redirect.
 */
export type ConnectReturn = "onboarding" | "settings";
const RETURN_PATHS: Record<ConnectReturn, string> = { onboarding: ONBOARDING_CONNECT_PATH, settings: CONNECTED_ACCOUNTS_PATH };

export function returnPathFor(context: string | null | undefined): string {
  return RETURN_PATHS[context as ConnectReturn] ?? CONNECTED_ACCOUNTS_PATH;
}

function safeStoredReturn(path: string | null | undefined) {
  return path && Object.values(RETURN_PATHS).includes(path) ? path : CONNECTED_ACCOUNTS_PATH;
}

/**
 * Step 1 of OAuth: store a one-time state (+ PKCE verifier, encrypted) and return the provider URL.
 * With `upgrade`, asks only for what that capability needs on top of what is configured/granted
 * (Meta `auth_type=rerequest`) — used when a feature needs a permission the account doesn't have yet.
 */
export async function startConnect(
  scope: TenantScope,
  userId: string,
  providerId: SocialProvider["id"],
  returnTo: ConnectReturn = "settings",
  upgrade?: { platform: string; capability: string },
) {
  const provider = SOCIAL_PROVIDERS[providerId];
  if (!provider?.isConfigured()) throw new UserFacingError("integration_not_configured");
  // Refuse before creating any state: an invalid callback (e.g. http/localhost outside development) never
  // reaches the provider. The admin sees the reason on /admin/providers.
  let redirectUri: string;
  try {
    redirectUri = redirectUriFor(providerId);
  } catch (err) {
    logger.error({ provider: providerId, err: err instanceof Error ? err.message : String(err) }, "oauth callback rejected by callback audit");
    throw new UserFacingError("integration_not_configured", { cause: err });
  }
  const already = await db.integration.count({ where: { ...scope, provider: { in: provider.platforms as never[] }, status: { not: "DISCONNECTED" } } });
  if (!already && provider.countsAsChannel !== false) await assertWithinLimit(scope.organizationId, "socialChannels");
  let scopes: string[] | undefined;
  if (upgrade) {
    if (!provider.upgradeScopes || !provider.platforms.includes(upgrade.platform as SocialPlatform)) throw new UserFacingError("capability_unavailable");
    const current = await db.integration.findFirst({ where: { ...scope, provider: upgrade.platform as Provider } });
    // Only permissions the operator enabled for the app (…_OAUTH_SCOPES / …_OPTIONAL_SCOPES) can be requested.
    scopes = provider.upgradeScopes(upgrade.platform, upgrade.capability, current?.scopes ?? []) ?? undefined;
    if (!scopes) throw new UserFacingError("capability_unavailable");
  }
  const state = randomToken(24);
  const verifier = randomToken(48);
  await db.oAuthState.create({
    data: {
      stateHash: hashToken(state),
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      userId,
      provider: providerId,
      codeVerifierEnc: encryptSecret(verifier),
      redirectTo: returnPathFor(returnTo),
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
      requestedScopes: scopes ?? provider.scopes,
      outcome: "started",
    },
  });
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return provider.connect({ state, redirectUri, codeChallenge: challenge, scopes, rerequest: Boolean(upgrade) });
}

export type ConnectResult = {
  redirectTo: string;
  scope?: TenantScope;
  connected?: string[];
  /** Platforms where several accounts came back — the customer must choose; nothing is auto-selected. */
  needsSelection?: string[];
  /** Platforms skipped because the plan's channel limit was reached. */
  limited?: string[];
  /** Meta sign-in worked but returned no manageable Page yet (Facebook profile = login only). */
  identity?: boolean;
  error?: "oauth_denied" | "integration_error" | "no_accounts" | "no_page_permission" | "meta_invalid_scope" | "linkedin_invalid_scope" | "instagram_invalid_scope" | "instagram_personal_account" | "oauth_invalid_scope";
};

/** Step 2 of OAuth (backend callback): verify state, exchange code, store encrypted tokens and accounts. */
export async function completeConnect(
  providerId: SocialProvider["id"],
  params: { code: string | null; state: string | null; error?: string | null; errorDescription?: string | null },
  /** The signed-in user finishing the flow. When given, it must be the user who started it (login-CSRF guard). */
  actorUserId?: string | null,
): Promise<ConnectResult> {
  if (!params.state) throw new UserFacingError("oauth_state");
  const stored = await db.oAuthState.findUnique({ where: { stateHash: hashToken(params.state) }, omit: { codeVerifierEnc: false } });
  if (!stored || stored.consumedAt || stored.expiresAt < new Date() || stored.provider !== providerId) throw new UserFacingError("oauth_state");
  // Consumed before any other check: a mismatched attempt burns the state too.
  await db.oAuthState.update({ where: { id: stored.id }, data: { consumedAt: new Date() } });
  if (actorUserId !== undefined && actorUserId !== stored.userId) throw new UserFacingError("oauth_state");
  const redirectTo = safeStoredReturn(stored.redirectTo);
  const finish = (outcome: string, grantedScopes?: string[]) => db.oAuthState.update({ where: { id: stored.id }, data: { outcome, ...(grantedScopes ? { grantedScopes } : {}) } });
  if (params.error || !params.code) {
    // A permission the app isn't allowed to request. Customers get a plain message; the detail goes to logs.
    const invalidScope = /invalid[_ ]?scope|unauthorized_scope/i.test(`${params.error ?? ""} ${params.errorDescription ?? ""}`);
    if (invalidScope) {
      logger.warn({ provider: providerId, error_type: "invalid_scope", requested_scopes: stored.requestedScopes, provider_error: params.error, provider_description: params.errorDescription?.slice(0, 300) }, "oauth rejected requested scopes");
      await finish("invalid_scope");
      return { redirectTo, error: providerId === "linkedin" ? "linkedin_invalid_scope" : providerId === "instagram" ? "instagram_invalid_scope" : providerId === "meta" ? "meta_invalid_scope" : "oauth_invalid_scope" };
    }
    await finish("denied");
    return { redirectTo, error: "oauth_denied" };
  }

  const scope = { organizationId: stored.organizationId, workspaceId: stored.workspaceId };
  const provider = SOCIAL_PROVIDERS[providerId];
  let tokens: TokenSet;
  let accounts: Awaited<ReturnType<SocialProvider["listAccounts"]>>;
  try {
    tokens = await provider.exchangeCode({ code: params.code, redirectUri: redirectUriFor(providerId), codeVerifier: stored.codeVerifierEnc ? decryptSecret(stored.codeVerifierEnc) : undefined });
    accounts = await provider.listAccounts(tokens);
  } catch (err) {
    logger.warn({ provider: providerId, detail: err instanceof ProviderError ? err.detail : err instanceof Error ? err.message : String(err) }, "oauth exchange failed");
    reportError(err, "oauth", { provider: providerId, stage: "exchange", organizationId: stored.organizationId });
    // Instagram Direct only supports professional (Business/Creator) accounts — say so plainly.
    if (err instanceof ProviderError && err.detail === "personal_account") {
      await finish("personal_account");
      return { redirectTo, error: "instagram_personal_account" };
    }
    await finish("exchange_failed");
    return { redirectTo, error: "integration_error" };
  }
  await finish("authorized", tokens.scopes ?? []);

  const byPlatform = new Map<SocialPlatform, typeof accounts>();
  for (const a of accounts) byPlatform.set(a.platform, [...(byPlatform.get(a.platform) ?? []), a]);
  for (const platform of provider.platforms) if (!byPlatform.has(platform)) byPlatform.set(platform, []);

  const connected: string[] = [];
  const needsSelection: string[] = [];
  const limited: string[] = [];
  for (const [platform, list] of byPlatform) {
    if (list.length === 0) continue; // nothing manageable on this platform (e.g. a Meta login with no Page yet)
    const existing = await db.integration.findUnique({
      where: { workspaceId_provider: { workspaceId: scope.workspaceId, provider: platform as Provider } },
      include: { accounts: { where: { isActive: true }, select: { externalId: true } } },
    });
    if (provider.countsAsChannel !== false && (!existing || existing.status === "DISCONNECTED" || existing.statusMessage === META_IDENTITY_ONLY)) {
      try {
        await assertWithinLimit(scope.organizationId, "socialChannels");
      } catch {
        limited.push(platform);
        continue;
      }
    }
    const integration = await db.integration.upsert({
      where: { workspaceId_provider: { workspaceId: scope.workspaceId, provider: platform as Provider } },
      create: { ...scope, provider: platform as Provider, status: "CONNECTED", scopes: tokens.scopes ?? provider.scopes, connectedById: stored.userId, connectedAt: new Date() },
      update: { status: "CONNECTED", statusMessage: null, scopes: tokens.scopes ?? provider.scopes, connectedById: stored.userId, connectedAt: new Date(), lastErrorAt: null },
    });
    await saveCredential(scope, integration.id, null, tokens);
    // One account: use it. Several: keep what the customer chose before, otherwise ask — never guess.
    const previous = new Set(existing?.status === "DISCONNECTED" ? [] : (existing?.accounts.map((a) => a.externalId) ?? []));
    let active = 0;
    for (const a of list) {
      const isActive = (list.length === 1 && providerId !== "meta") || previous.has(a.externalId);
      if (isActive) active++;
      const metadata = { ...(a.metadata ?? {}), capabilities: provider.capabilities?.(a, tokens.scopes ?? []) ?? null } as object;
      const account = await db.integrationAccount.upsert({
        where: { integrationId_externalId: { integrationId: integration.id, externalId: a.externalId } },
        create: { ...scope, integrationId: integration.id, platform, externalId: a.externalId, name: a.name, handle: a.handle ?? null, avatarUrl: a.avatarUrl ?? null, accountType: a.accountType ?? null, metadata, isActive },
        update: { name: a.name, handle: a.handle ?? null, avatarUrl: a.avatarUrl ?? null, accountType: a.accountType ?? null, metadata, isActive },
      });
      if (a.token) await saveCredential(scope, integration.id, account.id, a.token);
    }
    if (list.length > 0 && active === 0) needsSelection.push(platform);
    connected.push(platform);
    await audit({
      ...scope,
      category: "SECURITY",
      actorType: "USER",
      actorId: stored.userId,
      action: "integration.connected",
      entityType: "Integration",
      entityId: integration.id,
      summary: `Connected ${platform} (${list.length} account${list.length === 1 ? "" : "s"})`,
    });
  }
  if (!connected.length && !limited.length) {
    if (providerId === "meta") {
      // Phase 1: the Meta login itself succeeded. A Facebook profile is only an identity (Meta doesn't allow
      // publishing to personal profiles), so keep it as "identity connected" and ask for Page access next.
      const integration = await db.integration.upsert({
        where: { workspaceId_provider: { workspaceId: scope.workspaceId, provider: "FACEBOOK" } },
        create: { ...scope, provider: "FACEBOOK", status: "CONNECTED", statusMessage: META_IDENTITY_ONLY, scopes: tokens.scopes ?? [], connectedById: stored.userId, connectedAt: new Date() },
        update: { status: "CONNECTED", statusMessage: META_IDENTITY_ONLY, scopes: tokens.scopes ?? [], connectedById: stored.userId, connectedAt: new Date(), lastErrorAt: null },
      });
      await saveCredential(scope, integration.id, null, tokens);
      await db.integrationAccount.updateMany({ where: { integrationId: integration.id }, data: { isActive: false } });
      await audit({ ...scope, category: "SECURITY", actorType: "USER", actorId: stored.userId, action: "integration.identity_connected", entityType: "Integration", entityId: integration.id, summary: "Meta identity connected (no manageable Page yet)" });
      await finish("identity_connected");
      return { redirectTo, scope, connected: [], identity: true };
    }
    await finish("no_accounts");
    return { redirectTo, scope, error: "no_accounts" };
  }
  await finish(needsSelection.length ? "connected_pending_selection" : "connected");
  return { redirectTo, connected, needsSelection, limited, scope };
}

/**
 * One picker for everything a sign-in returned (e.g. Facebook Pages + Instagram accounts).
 * A platform with nothing chosen is released (no provider revoke while a sibling still uses the grant).
 */
export async function selectAccountsBatch(scope: TenantScope, userId: string, selections: { integrationId: string; accountIds: string[] }[]) {
  if (!selections.some((x) => x.accountIds.length > 0)) throw new UserFacingError("validation");
  let chosen = 0;
  for (const sel of selections) {
    if (sel.accountIds.length) chosen += await selectAccounts(scope, userId, sel.integrationId, sel.accountIds);
    else await disconnectIntegration(scope, sel.integrationId, userId);
  }
  return chosen;
}

/** The customer picks which returned accounts NOVA manages. Strictly scoped to the caller's workspace. */
export async function selectAccounts(scope: TenantScope, userId: string, integrationId: string, accountIds: string[]) {
  const integration = await db.integration.findFirst({ where: { id: integrationId, ...scope, status: { not: "DISCONNECTED" } }, include: { accounts: { select: { id: true } } } });
  if (!integration) throw new UserFacingError("item_not_found");
  const owned = new Set(integration.accounts.map((a) => a.id));
  const chosen = [...new Set(accountIds)];
  if (!chosen.length || chosen.some((id) => !owned.has(id))) throw new UserFacingError("validation");
  await db.integrationAccount.updateMany({ where: { integrationId, id: { in: chosen } }, data: { isActive: true } });
  await db.integrationAccount.updateMany({ where: { integrationId, id: { notIn: chosen } }, data: { isActive: false } });
  await audit({ ...scope, category: "SECURITY", actorType: "USER", actorId: userId, action: "integration.accounts_selected", entityType: "Integration", entityId: integrationId, summary: `Selected ${chosen.length} ${integration.provider} account(s)` });
  return chosen.length;
}

async function saveCredential(scope: TenantScope, integrationId: string, accountId: string | null, t: TokenSet) {
  const data = {
    accessTokenEnc: encryptSecret(t.accessToken),
    refreshTokenEnc: t.refreshToken ? encryptSecret(t.refreshToken) : null,
    expiresAt: t.expiresAt ?? null,
    refreshExpiresAt: t.refreshExpiresAt ?? null,
  };
  const existing = await db.integrationCredential.findFirst({ where: { integrationId, accountId } });
  if (existing) await db.integrationCredential.update({ where: { id: existing.id }, data });
  else await db.integrationCredential.create({ data: { ...scope, integrationId, accountId, ...data } });
}

/** Decrypts the best credential for an account. Server-side only; never returned to clients. */
export async function tokenForAccount(integrationId: string, accountId: string): Promise<TokenSet | null> {
  const rows = await db.integrationCredential.findMany({
    where: { integrationId, OR: [{ accountId }, { accountId: null }] },
    omit: { accessTokenEnc: false, refreshTokenEnc: false },
  });
  const row = rows.find((r) => r.accountId === accountId) ?? rows.find((r) => r.accountId === null);
  if (!row) return null;
  return {
    accessToken: decryptSecret(row.accessTokenEnc),
    refreshToken: row.refreshTokenEnc ? decryptSecret(row.refreshTokenEnc) : null,
    expiresAt: row.expiresAt,
    refreshExpiresAt: row.refreshExpiresAt,
  };
}

/**
 * A usable token: refreshed (and re-encrypted) when it expires within 2 minutes, or always when `force`.
 * Short-lived tokens (Google/Microsoft ≈ 1 hour) must not wait for the refresh job.
 */
export async function freshToken(integrationId: string, accountId: string, opts: { force?: boolean } = {}): Promise<{ token: TokenSet; refreshed: boolean } | null> {
  const token = await tokenForAccount(integrationId, accountId);
  if (!token) return null;
  const expiring = token.expiresAt != null && token.expiresAt.getTime() < Date.now() + 120_000;
  if (!opts.force && !expiring) return { token, refreshed: false };
  if (!token.refreshToken) return expiring ? null : { token, refreshed: false };
  const integration = await db.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const scope = { organizationId: integration.organizationId, workspaceId: integration.workspaceId };
  const provider = SOCIAL_PROVIDERS[providerIdFor(integration.provider)];
  try {
    const next = await provider.refreshToken(token);
    if (!next) return expiring ? null : { token, refreshed: false };
    const cred = await db.integrationCredential.findFirst({ where: { integrationId, OR: [{ accountId }, { accountId: null }] }, orderBy: { accountId: { sort: "desc", nulls: "last" } } });
    await saveCredential(scope, integrationId, cred?.accountId ?? null, next);
    return { token: next, refreshed: true };
  } catch (err) {
    await markIntegrationError(scope, integrationId, err);
    return null;
  }
}

export function accountRef(a: { externalId: string; accountType: string | null; metadata: unknown }): AccountRef {
  return { externalId: a.externalId, accountType: a.accountType, metadata: (a.metadata ?? {}) as Record<string, unknown> };
}

export async function disconnectIntegration(scope: TenantScope, integrationId: string, userId: string) {
  const integration = await db.integration.findFirst({ where: { id: integrationId, ...scope } });
  if (!integration) throw new UserFacingError("item_not_found");
  const providerId = providerIdFor(integration.provider);
  const provider = SOCIAL_PROVIDERS[providerId];
  const cred = await db.integrationCredential.findFirst({ where: { integrationId, accountId: null }, omit: { accessTokenEnc: false } });
  // Instagram and Facebook share one Meta grant: revoking it for one would silently break the other.
  const siblings = await db.integration.count({ where: { ...scope, id: { not: integrationId }, provider: { in: provider.platforms as never[] }, status: { not: "DISCONNECTED" } } });
  if (provider && cred && siblings === 0) await provider.disconnect({ accessToken: decryptSecret(cred.accessTokenEnc) }).catch((err) => logger.warn({ provider: providerId, err: err instanceof Error ? err.message : String(err) }, "provider revoke failed"));
  // Posts, metrics and audit history are kept; only credentials go and accounts are deactivated.
  await db.integrationCredential.deleteMany({ where: { integrationId } });
  await db.integrationAccount.updateMany({ where: { integrationId }, data: { isActive: false } });
  await db.integration.update({ where: { id: integrationId }, data: { status: "DISCONNECTED", statusMessage: null } });
  await db.socialPublication.updateMany({ where: { ...scope, platform: integration.provider as SocialPlatform, status: "PENDING" }, data: { integrationAccountId: null } });
  await audit({ ...scope, category: "SECURITY", actorType: "USER", actorId: userId, action: "integration.disconnected", entityType: "Integration", entityId: integrationId, summary: `Disconnected ${integration.provider}` });
}

export function providerIdFor(p: Provider): SocialProvider["id"] {
  if (p === "GOOGLE") return "google";
  if (p === "MICROSOFT") return "microsoft";
  return p === "LINKEDIN" ? "linkedin" : p === "TIKTOK" ? "tiktok" : p === "INSTAGRAM" ? "instagram" : "meta";
}

const STATUS_FOR_ERROR: Partial<Record<ProviderError["kind"], IntegrationStatus>> = { expired: "EXPIRED", permission: "ACTION_REQUIRED" };

/** Records a provider failure on the integration's health and alerts admins when action is needed. */
export async function markIntegrationError(scope: TenantScope, integrationId: string, err: unknown) {
  const kind = err instanceof ProviderError ? err.kind : "unknown";
  const status: IntegrationStatus = STATUS_FOR_ERROR[kind] ?? "ERROR";
  const integration = await db.integration.update({ where: { id: integrationId }, data: { status, statusMessage: kind, lastErrorAt: new Date() } });
  logger.warn({ integrationId, kind, detail: err instanceof ProviderError ? err.detail : String(err) }, "integration error");
  if (status === "EXPIRED" || status === "ACTION_REQUIRED") {
    const org = await db.organization.findUnique({ where: { id: scope.organizationId } });
    const ar = org?.locale === "ar";
    await notify({
      ...scope,
      type: "INTEGRATION_DISCONNECTED",
      title: ar ? `انتهت صلاحية ربط ${integration.provider}` : `Your ${integration.provider.charAt(0) + integration.provider.slice(1).toLowerCase()} connection needs attention`,
      body: ar ? "أعد الربط لمتابعة النشر وجمع التحليلات." : "Reconnect it to continue publishing and collecting analytics.",
      link: CONNECTED_ACCOUNTS_PATH,
      roles: ["OWNER", "ADMIN"],
    });
  }
  return status;
}

/** Scheduler job: refresh credentials expiring in the next 7 days. */
export async function refreshExpiringTokens() {
  const soon = new Date(Date.now() + 7 * 86_400_000);
  const creds = await db.integrationCredential.findMany({ where: { expiresAt: { lte: soon } }, include: { integration: true }, omit: { accessTokenEnc: false, refreshTokenEnc: false }, take: 200 });
  let refreshed = 0;
  for (const c of creds) {
    if (c.integration.status === "DISCONNECTED") continue;
    const scope = { organizationId: c.organizationId, workspaceId: c.workspaceId };
    const provider = SOCIAL_PROVIDERS[providerIdFor(c.integration.provider)];
    try {
      const next = await provider.refreshToken({
        accessToken: decryptSecret(c.accessTokenEnc),
        refreshToken: c.refreshTokenEnc ? decryptSecret(c.refreshTokenEnc) : null,
        expiresAt: c.expiresAt,
        refreshExpiresAt: c.refreshExpiresAt,
      });
      if (!next) {
        if (c.expiresAt && c.expiresAt < new Date()) await markIntegrationError(scope, c.integrationId, new ProviderError("expired", "Token expired and cannot be refreshed"));
        continue;
      }
      await saveCredential(scope, c.integrationId, c.accountId, next);
      refreshed++;
    } catch (err) {
      await markIntegrationError(scope, c.integrationId, err);
    }
  }
  return { checked: creds.length, refreshed };
}

/**
 * Scheduler job: validates live connections with the provider (Meta debug_token, LinkedIn introspection).
 * Invalid ones become EXPIRED/ACTION_REQUIRED and the customer is notified; technical detail stays in logs.
 */
export async function checkConnectionsHealth(limit = 200) {
  const rows = await db.integration.findMany({ where: { status: "CONNECTED" }, orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } }, take: limit });
  let checked = 0;
  let unhealthy = 0;
  for (const i of rows) {
    const provider = SOCIAL_PROVIDERS[providerIdFor(i.provider)];
    if (!provider?.checkConnection || !provider.isConfigured()) continue;
    const scope = { organizationId: i.organizationId, workspaceId: i.workspaceId };
    const cred = await db.integrationCredential.findFirst({ where: { integrationId: i.id, accountId: null }, omit: { accessTokenEnc: false, refreshTokenEnc: false } });
    if (!cred) continue;
    checked++;
    try {
      const res = await provider.checkConnection({ accessToken: decryptSecret(cred.accessTokenEnc), refreshToken: cred.refreshTokenEnc ? decryptSecret(cred.refreshTokenEnc) : null, expiresAt: cred.expiresAt });
      await db.integration.update({ where: { id: i.id }, data: { lastCheckedAt: new Date(), ...(res.scopes.length ? { scopes: res.scopes } : {}) } });
      if (!res.valid) {
        unhealthy++;
        await markIntegrationError(scope, i.id, new ProviderError("expired", "Connection no longer valid", undefined, res.detail));
      }
    } catch (err) {
      await db.integration.update({ where: { id: i.id }, data: { lastCheckedAt: new Date() } });
      // Transient provider outages are not the customer's problem; only auth failures change status.
      if (err instanceof ProviderError && (err.kind === "expired" || err.kind === "permission")) {
        unhealthy++;
        await markIntegrationError(scope, i.id, err);
      } else logger.warn({ integrationId: i.id, err: err instanceof Error ? err.message : String(err) }, "connection health check failed");
    }
  }
  return { checked, unhealthy };
}
