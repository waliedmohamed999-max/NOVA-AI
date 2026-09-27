import { createHash } from "node:crypto";
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

/** Step 1 of OAuth: store a one-time state (+ PKCE verifier, encrypted) and return the provider URL. */
export async function startConnect(scope: TenantScope, userId: string, providerId: SocialProvider["id"], redirectTo = "/integrations") {
  const provider = SOCIAL_PROVIDERS[providerId];
  if (!provider?.isConfigured()) throw new UserFacingError("integration_not_configured");
  const already = await db.integration.count({ where: { ...scope, provider: { in: provider.platforms as never[] }, status: { not: "DISCONNECTED" } } });
  if (!already) await assertWithinLimit(scope.organizationId, "socialChannels");
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
      redirectTo: redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/integrations",
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return provider.connect({ state, redirectUri: redirectUriFor(providerId), codeChallenge: challenge });
}

/** Step 2 of OAuth (backend callback): verify state, exchange code, store encrypted tokens and accounts. */
export async function completeConnect(providerId: SocialProvider["id"], params: { code: string | null; state: string | null; error?: string | null }) {
  if (!params.state) throw new UserFacingError("oauth_state");
  const stored = await db.oAuthState.findUnique({ where: { stateHash: hashToken(params.state) }, omit: { codeVerifierEnc: false } });
  if (!stored || stored.consumedAt || stored.expiresAt < new Date() || stored.provider !== providerId) throw new UserFacingError("oauth_state");
  await db.oAuthState.update({ where: { id: stored.id }, data: { consumedAt: new Date() } });
  const redirectTo = stored.redirectTo ?? "/integrations";
  if (params.error || !params.code) return { redirectTo, error: "oauth_denied" as const };

  const scope = { organizationId: stored.organizationId, workspaceId: stored.workspaceId };
  const provider = SOCIAL_PROVIDERS[providerId];
  const tokens = await provider.exchangeCode({ code: params.code, redirectUri: redirectUriFor(providerId), codeVerifier: stored.codeVerifierEnc ? decryptSecret(stored.codeVerifierEnc) : undefined });
  const accounts = await provider.listAccounts(tokens);

  const byPlatform = new Map<SocialPlatform, typeof accounts>();
  for (const a of accounts) byPlatform.set(a.platform, [...(byPlatform.get(a.platform) ?? []), a]);
  for (const platform of provider.platforms) if (!byPlatform.has(platform)) byPlatform.set(platform, []);

  const connected: string[] = [];
  for (const [platform, list] of byPlatform) {
    if (list.length === 0 && provider.platforms.length > 1) continue; // e.g. no Instagram account linked to the Page
    const integration = await db.integration.upsert({
      where: { workspaceId_provider: { workspaceId: scope.workspaceId, provider: platform as Provider } },
      create: { ...scope, provider: platform as Provider, status: "CONNECTED", scopes: tokens.scopes ?? provider.scopes, connectedById: stored.userId, connectedAt: new Date() },
      update: { status: "CONNECTED", statusMessage: null, scopes: tokens.scopes ?? provider.scopes, connectedById: stored.userId, connectedAt: new Date(), lastErrorAt: null },
    });
    await saveCredential(scope, integration.id, null, tokens);
    for (const a of list) {
      const account = await db.integrationAccount.upsert({
        where: { integrationId_externalId: { integrationId: integration.id, externalId: a.externalId } },
        create: { ...scope, integrationId: integration.id, platform, externalId: a.externalId, name: a.name, handle: a.handle ?? null, avatarUrl: a.avatarUrl ?? null, accountType: a.accountType ?? null, metadata: (a.metadata ?? {}) as object },
        update: { name: a.name, handle: a.handle ?? null, avatarUrl: a.avatarUrl ?? null, accountType: a.accountType ?? null, metadata: (a.metadata ?? {}) as object, isActive: true },
      });
      if (a.token) await saveCredential(scope, integration.id, account.id, a.token);
    }
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
  return { redirectTo, connected, scope };
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

export function accountRef(a: { externalId: string; accountType: string | null; metadata: unknown }): AccountRef {
  return { externalId: a.externalId, accountType: a.accountType, metadata: (a.metadata ?? {}) as Record<string, unknown> };
}

export async function disconnectIntegration(scope: TenantScope, integrationId: string, userId: string) {
  const integration = await db.integration.findFirst({ where: { id: integrationId, ...scope } });
  if (!integration) throw new UserFacingError("item_not_found");
  const provider = SOCIAL_PROVIDERS[providerIdFor(integration.provider)];
  const cred = await db.integrationCredential.findFirst({ where: { integrationId, accountId: null }, omit: { accessTokenEnc: false } });
  if (provider && cred) await provider.disconnect({ accessToken: decryptSecret(cred.accessTokenEnc) }).catch((err) => logger.warn({ err }, "provider revoke failed"));
  await db.integrationCredential.deleteMany({ where: { integrationId } });
  await db.integrationAccount.updateMany({ where: { integrationId }, data: { isActive: false } });
  await db.integration.update({ where: { id: integrationId }, data: { status: "DISCONNECTED", statusMessage: null } });
  await db.socialPublication.updateMany({ where: { ...scope, platform: integration.provider as SocialPlatform, status: "PENDING" }, data: { integrationAccountId: null } });
  await audit({ ...scope, category: "SECURITY", actorType: "USER", actorId: userId, action: "integration.disconnected", entityType: "Integration", entityId: integrationId, summary: `Disconnected ${integration.provider}` });
}

export function providerIdFor(p: Provider): SocialProvider["id"] {
  return p === "LINKEDIN" ? "linkedin" : p === "TIKTOK" ? "tiktok" : "meta";
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
      link: "/integrations",
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
