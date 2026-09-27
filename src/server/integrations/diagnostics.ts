import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { audit } from "../audit";
import { logger } from "../logger";
import { UserFacingError } from "../errors";
import { SOCIAL_PROVIDERS } from "./registry";
import { accountRef, providerIdFor, tokenForAccount } from "./service";
import { decryptSecret } from "../crypto";
import { ProviderError, type Capability } from "./types";

/**
 * Platform-admin connection diagnostics for the admin's OWN workspace connections.
 * Read-only by default; publishing a test post is a separate, explicitly confirmed action.
 * Tokens never leave the server — results contain only names, scopes and capabilities.
 */
export const TEST_POST_TEXT = "NOVA integration test — this post can be deleted.";
export const TEST_POST_CONFIRMATION = "PUBLISH";

export type ConnectionTestResult = {
  provider: string;
  valid: boolean;
  expiresAt: string | null;
  scopes: string[];
  profile: { name: string; email?: string | null } | null;
  accounts: { id: string | null; platform: string; name: string; handle: string | null; linked: boolean; active: boolean; capabilities: Capability[] }[];
  error: string | null;
};

export async function testConnection(scope: TenantScope, integrationId: string): Promise<ConnectionTestResult> {
  const integration = await db.integration.findFirst({ where: { id: integrationId, ...scope } });
  if (!integration) throw new UserFacingError("item_not_found");
  const providerId = providerIdFor(integration.provider);
  const provider = SOCIAL_PROVIDERS[providerId];
  const cred = await db.integrationCredential.findFirst({ where: { integrationId, accountId: null }, omit: { accessTokenEnc: false } });
  const base: ConnectionTestResult = { provider: providerId, valid: false, expiresAt: null, scopes: [], profile: null, accounts: [], error: null };
  if (!provider.isConfigured()) return { ...base, error: "integration_not_configured" };
  if (!cred) return { ...base, error: "no_credentials" };
  const token = { accessToken: decryptSecret(cred.accessTokenEnc), expiresAt: cred.expiresAt };
  try {
    const check = provider.checkConnection ? await provider.checkConnection(token) : { valid: true, scopes: integration.scopes, expiresAt: cred.expiresAt };
    const scopes = check.scopes.length ? check.scopes : integration.scopes;
    const profile = check.profile ?? (provider.getProfile ? await provider.getProfile(token).catch(() => null) : null);
    // Live listing: Meta → every Page and the Instagram accounts linked to them; LinkedIn → the member (and orgs if approved).
    const live = check.valid ? await provider.listAccounts({ ...token, scopes }) : [];
    const storedAll = await db.integrationAccount.findMany({ where: { ...scope, platform: { in: provider.platforms } } });
    const accounts = live
      .map((a) => {
        const stored = storedAll.find((x) => x.externalId === a.externalId && x.platform === a.platform) ?? null;
        return {
          id: stored?.id ?? null,
          platform: a.platform,
          name: a.name,
          handle: a.handle ?? null,
          linked: Boolean(stored),
          active: Boolean(stored?.isActive),
          capabilities: provider.capabilities?.(a, scopes) ?? [],
        };
      });
    return { ...base, valid: check.valid, expiresAt: check.expiresAt ? check.expiresAt.toISOString() : null, scopes, profile: profile ? { name: profile.name, email: profile.email ?? null } : null, accounts, error: check.valid ? null : "token_invalid" };
  } catch (err) {
    logger.warn({ provider: providerId, err: err instanceof ProviderError ? { kind: err.kind, status: err.status, detail: err.detail } : String(err) }, "connection test failed");
    return { ...base, error: err instanceof ProviderError ? err.kind : "unknown" };
  }
}

/** Publishes the fixed test text to one active account. Requires typing the confirmation word. */
export async function publishTestPost(scope: TenantScope, userId: string, accountId: string, confirmation: string) {
  if (confirmation !== TEST_POST_CONFIRMATION) throw new UserFacingError("validation");
  const account = await db.integrationAccount.findFirst({ where: { id: accountId, ...scope, isActive: true }, include: { integration: true } });
  if (!account || account.integration.status !== "CONNECTED") throw new UserFacingError("item_not_found");
  if (account.platform === "INSTAGRAM" || account.platform === "TIKTOK") throw new UserFacingError("test_post_needs_media");
  const provider = SOCIAL_PROVIDERS[providerIdFor(account.integration.provider)];
  const token = await tokenForAccount(account.integrationId, account.id);
  if (!token) throw new UserFacingError("integration_error");
  const format = account.platform === "LINKEDIN" ? "LINKEDIN_POST" : "POST";
  let result: { externalId: string; permalink?: string | null };
  try {
    result = await provider.publishPost(accountRef(account), token, { format, caption: TEST_POST_TEXT, mediaUrls: [] });
  } catch (err) {
    logger.warn({ accountId, err: err instanceof ProviderError ? { kind: err.kind, status: err.status, detail: err.detail } : String(err) }, "test post failed");
    throw new UserFacingError("integration_error");
  }
  if (!result.externalId) throw new UserFacingError("integration_error");
  const meta = (account.metadata ?? {}) as { testPosts?: unknown[] };
  const testPosts = [...(Array.isArray(meta.testPosts) ? meta.testPosts : []), { externalId: result.externalId, permalink: result.permalink ?? null, at: new Date().toISOString() }].slice(-10);
  await db.integrationAccount.update({ where: { id: account.id }, data: { metadata: { ...meta, testPosts } as object } });
  await audit({ ...scope, category: "SECURITY", actorType: "USER", actorId: userId, action: "integration.test_post", entityType: "IntegrationAccount", entityId: account.id, summary: `Published integration test post ${result.externalId} on ${account.platform}` });
  return result;
}
