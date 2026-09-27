import type { Capability, CapabilityKey } from "../types";

/**
 * Incremental scopes for account connections (Google / Microsoft): sign-in identity first, then mailbox
 * sending and calendar access only when a feature needs them. Which extra scopes may be requested is
 * configuration (`<PREFIX>_OPTIONAL_SCOPES`, defaults below) — never everything at once.
 */
export type AccountScopeSpec = {
  base: string[];
  capabilities: Partial<Record<CapabilityKey, string[]>>;
  envPrefix: "GOOGLE" | "MICROSOFT";
  defaultOptional: string[];
};

export function optionalScopes(spec: AccountScopeSpec, env: NodeJS.ProcessEnv = process.env) {
  const raw = env[`${spec.envPrefix}_OPTIONAL_SCOPES`];
  const list = raw === undefined || raw === "" ? spec.defaultOptional : raw.split(/[\s,]+/).filter(Boolean);
  const allowed = new Set(Object.values(spec.capabilities).flat());
  return list.filter((s) => allowed.has(s));
}

export function accountUpgradeScopes(spec: AccountScopeSpec, capability: string, granted: string[], env: NodeJS.ProcessEnv = process.env): string[] | null {
  const need = spec.capabilities[capability as CapabilityKey];
  if (!need) return null;
  const enabled = new Set([...spec.base, ...optionalScopes(spec, env)]);
  if (!need.every((s) => enabled.has(s))) return null;
  return [...new Set([...spec.base, ...granted.filter((s) => enabled.has(s)), ...need])];
}

export function accountCapabilities(spec: AccountScopeSpec, granted: string[]): Capability[] {
  return (Object.entries(spec.capabilities) as [CapabilityKey, string[]][]).map(([key, need]) =>
    need.every((s) => granted.includes(s)) ? { key, available: true } : { key, available: false, reason: "permission_missing" },
  );
}
