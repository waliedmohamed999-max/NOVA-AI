import type { CapabilityKey } from "../types";

/**
 * Instagram API with Instagram Login ("Instagram Direct"): permissions are configuration.
 *   INSTAGRAM_OAUTH_SCOPES    → requested at login (default: instagram_business_basic only)
 *   INSTAGRAM_OPTIONAL_SCOPES → enabled for the app, requested only when a feature needs them
 * Only the current instagram_business_* permission names are accepted (the retired
 * business_basic / business_content_publish … names are rejected).
 */
export const INSTAGRAM_CAPABILITY_SCOPES: Partial<Record<CapabilityKey, string[]>> = {
  identity: ["instagram_business_basic"],
  instagram_publishing: ["instagram_business_basic", "instagram_business_content_publish"],
  metrics: ["instagram_business_basic", "instagram_business_manage_insights"],
  comments: ["instagram_business_basic", "instagram_business_manage_comments"],
  messages: ["instagram_business_basic", "instagram_business_manage_messages"],
};

const KNOWN = new Set([
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
]);

function parse(raw: string | undefined) {
  const scopes: string[] = [];
  const rejected: string[] = [];
  for (const p of (raw ?? "").replace(/^["']|["']$/g, "").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (!KNOWN.has(p)) rejected.push(p);
    else if (!scopes.includes(p)) scopes.push(p);
  }
  return { scopes, rejected };
}

export function instagramScopeConfig(env: NodeJS.ProcessEnv = process.env) {
  const configured = parse(env.INSTAGRAM_OAUTH_SCOPES);
  const optional = parse(env.INSTAGRAM_OPTIONAL_SCOPES);
  const requested = [...new Set(["instagram_business_basic", ...configured.scopes])];
  return { requested, optional: optional.scopes.filter((s) => !requested.includes(s)), rejected: [...configured.rejected, ...optional.rejected] };
}

/** Scopes to request to unlock a capability — only when the operator enabled them. */
export function instagramUpgradeScopes(capability: string, alreadyGranted: string[] = [], env: NodeJS.ProcessEnv = process.env): string[] | null {
  const need = INSTAGRAM_CAPABILITY_SCOPES[capability as CapabilityKey];
  if (!need) return null;
  const cfg = instagramScopeConfig(env);
  const enabled = new Set([...cfg.requested, ...cfg.optional]);
  if (!need.every((s) => enabled.has(s))) return null;
  return [...new Set([...cfg.requested, ...alreadyGranted.filter((s) => enabled.has(s)), ...need])];
}
