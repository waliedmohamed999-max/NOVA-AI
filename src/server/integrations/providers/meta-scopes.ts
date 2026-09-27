import type { CapabilityKey } from "../types";

/**
 * Meta permissions are configuration, not code. Meta rejects the whole login ("Invalid Scopes")
 * when a single requested permission isn't enabled for the app, so NOVA only asks for what the
 * operator has explicitly configured.
 *
 *   META_PERMISSION_MODE=minimal (default) → public_profile + META_OAUTH_SCOPES
 *   META_PERMISSION_MODE=configured        → exactly META_OAUTH_SCOPES
 *   META_OPTIONAL_SCOPES                   → enabled in the app, requested only when a feature needs them
 *   META_LOGIN_CONFIG_ID                   → Facebook Login for Business configuration (sent instead of scope)
 */

/** Capability → the Meta permissions it needs. Nothing here is requested until that capability is used. */
export const META_CAPABILITY_SCOPES: Record<string, Partial<Record<CapabilityKey | "discovery" | "business_assets", string[]>>> = {
  FACEBOOK: {
    discovery: ["pages_show_list"],
    identity: ["pages_show_list"],
    publish: ["pages_show_list", "pages_manage_posts"],
    metrics: ["pages_show_list", "read_insights"],
    page_management: ["pages_manage_metadata"],
    messages: ["pages_messaging"],
    leads: ["leads_retrieval"],
    business_assets: ["business_management"],
  },
};

/** Known Meta permission names; anything else (typos, retired names like manage_pages) is dropped with a warning. */
const KNOWN = new Set([
  "public_profile",
  "email",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_metadata",
  "pages_manage_engagement",
  "pages_read_user_content",
  "pages_messaging",
  "read_insights",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "instagram_manage_comments",
  "instagram_manage_messages",
  "business_management",
  "leads_retrieval",
  "ads_read",
]);

export function parseScopes(raw: string | undefined | null): { scopes: string[]; rejected: string[] } {
  const parts = (raw ?? "")
    .replace(/^["']|["']$/g, "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const scopes: string[] = [];
  const rejected: string[] = [];
  for (const p of parts) {
    if (!/^[a-z_]+$/.test(p) || !KNOWN.has(p)) rejected.push(p);
    else if (!scopes.includes(p)) scopes.push(p);
  }
  return { scopes, rejected };
}

export type MetaScopeConfig = { mode: "minimal" | "configured"; requested: string[]; optional: string[]; rejected: string[]; configId: string | null };

export function metaScopeConfig(env: NodeJS.ProcessEnv = process.env): MetaScopeConfig {
  const mode = env.META_PERMISSION_MODE?.trim().toLowerCase() === "configured" ? "configured" : "minimal";
  const configured = parseScopes(env.META_OAUTH_SCOPES);
  const optional = parseScopes(env.META_OPTIONAL_SCOPES);
  const base = mode === "minimal" ? ["public_profile"] : [];
  const requested = [...new Set([...base, ...configured.scopes])];
  // Phase 2 of the minimal flow: Page discovery is always allowed, but only requested when the
  // customer clicks "Grant access to Pages" (never in the first login).
  const onDemand = mode === "minimal" ? ["pages_show_list", ...optional.scopes] : optional.scopes;
  return {
    mode,
    requested: requested.length ? requested : ["public_profile"],
    optional: [...new Set(onDemand)].filter((s) => !requested.includes(s)),
    rejected: [...configured.rejected, ...optional.rejected],
    configId: env.META_LOGIN_CONFIG_ID?.trim() || null,
  };
}

/** Scopes a capability needs on a platform, or null when NOVA has no mapping for it. */
export function scopesForCapability(platform: string, capability: string): string[] | null {
  return META_CAPABILITY_SCOPES[platform]?.[capability as CapabilityKey] ?? null;
}

/**
 * The scopes to request to unlock a capability: everything already requested plus that capability's
 * scopes — but only if the operator enabled them (requested or optional). Otherwise null.
 */
export function upgradeScopes(platform: string, capability: string, alreadyGranted: string[] = [], env: NodeJS.ProcessEnv = process.env): string[] | null {
  const need = scopesForCapability(platform, capability);
  if (!need) return null;
  const cfg = metaScopeConfig(env);
  const enabled = new Set([...cfg.requested, ...cfg.optional]);
  if (!need.every((s) => enabled.has(s))) return null;
  return [...new Set([...cfg.requested, ...alreadyGranted.filter((s) => enabled.has(s)), ...need])];
}
