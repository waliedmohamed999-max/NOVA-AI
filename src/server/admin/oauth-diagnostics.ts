import { db } from "../db/client";
import { oauthSetupSummary } from "../integrations/registry";
import { META_CAPABILITY_SCOPES, metaScopeConfig } from "../integrations/providers/meta-scopes";
import { metaCredentialProblem } from "../integrations/providers/meta";

/**
 * Platform-admin OAuth diagnostics: redirect URIs (not secret), requested vs granted permissions and
 * which capabilities they unlock. Attempts are read from the admin's own organization only.
 * Never includes client secrets, codes or tokens.
 */
export type CapabilityRow = { platform: string; capability: string; scopes: string[]; status: "available" | "not_granted" | "not_enabled" };

export type ProviderDiagnostics = {
  id: "meta" | "linkedin";
  configured: boolean;
  redirectUri: string | null;
  redirectProblem: string | null;
  mode: string | null;
  loginConfigId: boolean;
  requested: string[];
  optional: string[];
  rejected: string[];
  lastAttempt: { at: string; outcome: string | null; requested: string[]; granted: string[]; missing: string[] } | null;
  capabilities: CapabilityRow[];
  /** Meta only: what the admin's workspace actually has. */
  credentialProblem?: string | null;
  assets?: { identity: boolean; pages: number | null; instagram: number | null; granted: string[]; selectedPages: string[]; selectedInstagram: string[] };
};

const LINKEDIN_CAPABILITIES: { capability: string; scopes: string[]; approval?: boolean }[] = [
  { capability: "identity", scopes: ["openid", "profile"] },
  { capability: "member_publishing", scopes: ["w_member_social"] },
  { capability: "organization_publishing", scopes: ["w_organization_social"], approval: true },
];

export async function oauthDiagnostics(organizationId: string | null): Promise<ProviderDiagnostics[]> {
  const setup = oauthSetupSummary();
  const meta = metaScopeConfig();
  const attempts = organizationId
    ? await db.oAuthState.findMany({ where: { organizationId, provider: { in: ["meta", "linkedin"] } }, orderBy: { createdAt: "desc" }, take: 20, select: { provider: true, createdAt: true, outcome: true, requestedScopes: true, grantedScopes: true } })
    : [];
  const last = (id: string) => {
    const a = attempts.find((x) => x.provider === id && x.outcome && x.outcome !== "started") ?? attempts.find((x) => x.provider === id);
    if (!a) return null;
    return { at: a.createdAt.toISOString(), outcome: a.outcome, requested: a.requestedScopes, granted: a.grantedScopes, missing: a.requestedScopes.filter((s) => !a.grantedScopes.includes(s)) };
  };

  // Meta assets in the admin's own workspace (names only — never tokens).
  const metaRows = organizationId
    ? await db.integration.findMany({ where: { organizationId, provider: { in: ["FACEBOOK", "INSTAGRAM"] }, status: { not: "DISCONNECTED" } }, include: { accounts: { select: { name: true, handle: true, isActive: true } } } })
    : [];
  const fb = metaRows.find((r) => r.provider === "FACEBOOK");
  const igRow = metaRows.find((r) => r.provider === "INSTAGRAM");
  const metaGranted = [...new Set(metaRows.flatMap((r) => r.scopes))];
  const metaAssets = {
    identity: metaRows.length > 0,
    pages: metaGranted.includes("pages_show_list") ? (fb?.statusMessage === "identity_only" ? 0 : (fb?.accounts.length ?? 0)) : null,
    instagram: metaGranted.includes("instagram_basic") ? (igRow?.accounts.length ?? 0) : null,
    granted: metaGranted,
    selectedPages: fb?.accounts.filter((a) => a.isActive).map((a) => a.name) ?? [],
    selectedInstagram: igRow?.accounts.filter((a) => a.isActive).map((a) => a.handle ?? a.name) ?? [],
  };

  return setup.map((s) => {
    const attempt = last(s.id);
    const granted = new Set([...(attempt?.granted ?? []), ...(s.id === "meta" ? metaGranted : [])]);
    if (s.id === "meta") {
      const enabled = new Set([...meta.requested, ...meta.optional]);
      const capabilities: CapabilityRow[] = [];
      for (const [platform, caps] of Object.entries(META_CAPABILITY_SCOPES)) {
        for (const [capability, scopes] of Object.entries(caps)) {
          if (!scopes) continue;
          const status = scopes.every((x) => granted.has(x)) ? "available" : scopes.every((x) => enabled.has(x)) ? "not_granted" : "not_enabled";
          capabilities.push({ platform, capability, scopes, status });
        }
      }
      return { id: "meta", configured: s.configured, redirectUri: s.redirectUri, redirectProblem: s.problem, mode: meta.mode, loginConfigId: Boolean(meta.configId), requested: meta.requested, optional: meta.optional, rejected: meta.rejected, lastAttempt: attempt, capabilities, assets: metaAssets, credentialProblem: metaCredentialProblem() };
    }
    const requested = s.scopes;
    return {
      id: "linkedin",
      configured: s.configured,
      redirectUri: s.redirectUri,
      redirectProblem: s.problem,
      mode: null,
      loginConfigId: false,
      requested,
      optional: [],
      rejected: [],
      lastAttempt: attempt,
      capabilities: LINKEDIN_CAPABILITIES.map((c) => ({
        platform: "LINKEDIN",
        capability: c.capability,
        scopes: c.scopes,
        status: c.scopes.every((x) => granted.has(x)) ? "available" : c.approval || !c.scopes.every((x) => requested.includes(x)) ? "not_enabled" : "not_granted",
      })),
    };
  });
}
