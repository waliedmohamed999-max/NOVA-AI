import { db } from "../db/client";
import { oauthSetupSummary } from "../integrations/registry";
import { META_CAPABILITY_SCOPES, metaScopeConfig } from "../integrations/providers/meta-scopes";

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

  return setup.map((s) => {
    const attempt = last(s.id);
    const granted = new Set(attempt?.granted ?? []);
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
      return { id: "meta", configured: s.configured, redirectUri: s.redirectUri, redirectProblem: s.problem, mode: meta.mode, loginConfigId: Boolean(meta.configId), requested: meta.requested, optional: meta.optional, rejected: meta.rejected, lastAttempt: attempt, capabilities };
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
