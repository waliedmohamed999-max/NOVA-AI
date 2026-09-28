import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { getUsage } from "../billing/entitlements";
import { INTEGRATION_CATALOG, SOCIAL_PROVIDERS } from "./registry";
import { upgradeScopes } from "./providers/meta-scopes";
import type { Capability } from "./types";

function capabilitiesOf(metadata: unknown): Capability[] | null {
  const c = (metadata as { capabilities?: unknown } | null)?.capabilities;
  return Array.isArray(c) ? (c as Capability[]) : null;
}

/** "identity" = Meta sign-in worked (Facebook profile = login only) but no manageable Page/Instagram yet. */
export type ConnectionState = "idle" | "connected" | "reconnect" | "choose" | "unavailable" | "identity";

export type ConnectionCard = {
  platform: string;
  oauth: string;
  available: boolean;
  state: ConnectionState;
  integrationId: string | null;
  accounts: { id: string; name: string; handle: string | null; avatarUrl: string | null; isActive: boolean; capabilities: Capability[] | null }[];
  healthKey: string | null;
  /**
   * Meta step-by-step access: the permission request that unlocks this channel next
   * (e.g. "FACEBOOK:discovery" = access to the Facebook Pages the user manages).
   * null when nothing more can be requested (not enabled for the app, or not needed).
   */
  nextStep: { upgrade: string; kind: "pages" } | null;
  /** Identity state detail: Page access granted but the account manages no Page. */
  noManagedPages: boolean;
  /** Instagram Direct: the connected Professional account type (Business or Creator). */
  professionalType: "BUSINESS" | "CREATOR" | null;
  /** Meta identity is connected but Page access (pages_show_list) isn't enabled for the app — needs Meta approval. */
  pagesPermissionUnavailable: boolean;
};

/** Google / Microsoft account connection (identity + email sending + calendar). Not a social channel. */
export type AccountConnectionState = "idle" | "connected" | "reconnect" | "missing_permission" | "unavailable";
export type AccountConnectionCard = {
  provider: "GOOGLE" | "MICROSOFT";
  oauth: "google" | "microsoft";
  available: boolean;
  state: AccountConnectionState;
  integrationId: string | null;
  email: string | null;
  healthKey: string | null;
  /** Per capability: granted, missing (can be requested now) or not enabled for the app. */
  capabilities: { key: "email_send" | "calendar_read" | "calendar_write"; status: "granted" | "missing" | "not_enabled" }[];
};

export type ConnectionsView = {
  cards: ConnectionCard[];
  accounts: AccountConnectionCard[];
  website: { url: string | null; status: string | null };
  plan: { used: number; limit: number };
  isDemo: boolean;
};

const PRIMARY = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "TIKTOK"];

/**
 * Customer-facing connection state. Deliberately contains no credential, env or
 * configuration detail — only whether a channel can be connected right now.
 */
export async function loadConnections(scope: TenantScope, isDemo: boolean): Promise<ConnectionsView> {
  const [rows, site, org, usage] = await Promise.all([
    db.integration.findMany({ where: scope, include: { accounts: { orderBy: { createdAt: "asc" } } } }),
    db.knowledgeSource.findFirst({ where: { ...scope, type: "WEBSITE" }, orderBy: { updatedAt: "desc" } }),
    db.organization.findUniqueOrThrow({ where: { id: scope.organizationId }, select: { website: true } }),
    getUsage(scope.organizationId),
  ]);
  const fbRow = rows.find((r) => r.provider === "FACEBOOK" && r.status !== "DISCONNECTED") ?? null;
  const metaIdentity = fbRow?.statusMessage === "identity_only" ? fbRow : null;
  const metaGranted = fbRow?.scopes ?? [];

  const cards = INTEGRATION_CATALOG.filter((c) => PRIMARY.includes(c.provider) && c.oauth).map<ConnectionCard>((c) => {
    const row = rows.find((r) => r.provider === c.provider);
    const available = SOCIAL_PROVIDERS[c.oauth!].isConfigured();
    const live = row && row.status !== "DISCONNECTED";
    const identityOnly = live && row.statusMessage === "identity_only";
    const accounts = live && !identityOnly ? row.accounts.map((a) => ({ id: a.id, name: a.name, handle: a.handle, avatarUrl: a.avatarUrl, isActive: a.isActive, capabilities: capabilitiesOf(a.metadata) })) : [];
    let state: ConnectionState = "idle";
    if (live && row.status !== "CONNECTED") state = "reconnect";
    else if (identityOnly) state = "identity";
    else if (live && accounts.length > 0 && !accounts.some((a) => a.isActive)) state = "choose";
    else if (live) state = "connected";
    else if (c.provider === "FACEBOOK" && metaIdentity) state = "identity";
    else if (!available) state = "unavailable";

    // What to ask Meta for next — only when the operator enabled it for the app.
    let nextStep: ConnectionCard["nextStep"] = null;
    // Facebook Pages: after the Meta login, Page access (pages_show_list) is requested only on the customer's click.
    if (c.provider === "FACEBOOK" && available && state === "identity" && !metaGranted.includes("pages_show_list") && upgradeScopes("FACEBOOK", "discovery", metaGranted)) {
      nextStep = { upgrade: "FACEBOOK:discovery", kind: "pages" };
    }
    const igType = c.provider === "INSTAGRAM" ? ((row?.accounts.find((a) => a.isActive)?.metadata as { professionalType?: string } | null)?.professionalType ?? null) : null;
    return {
      platform: c.provider,
      oauth: c.oauth!,
      available,
      state,
      integrationId: live ? row.id : null,
      accounts,
      healthKey: state === "reconnect" ? (row?.statusMessage ?? "unknown") : null,
      nextStep,
      noManagedPages: state === "identity" && metaGranted.includes("pages_show_list") && c.provider === "FACEBOOK",
      professionalType: igType === "BUSINESS" || igType === "CREATOR" ? igType : null,
      pagesPermissionUnavailable: c.provider === "FACEBOOK" && state === "identity" && !metaGranted.includes("pages_show_list") && !nextStep,
    };
  });

  const accountCards = (["GOOGLE", "MICROSOFT"] as const).map<AccountConnectionCard>((p) => {
    const oauth = p === "GOOGLE" ? "google" : "microsoft";
    const provider = SOCIAL_PROVIDERS[oauth];
    const available = provider.isConfigured();
    const row = rows.find((r) => r.provider === p && r.status !== "DISCONNECTED");
    const granted = row?.scopes ?? [];
    const capabilities = (["email_send", "calendar_read", "calendar_write"] as const).map((key) => {
      const has = provider.capabilities?.({ platform: p }, granted).find((c) => c.key === key)?.available;
      return { key, status: has ? ("granted" as const) : provider.upgradeScopes?.(p, key, granted) ? ("missing" as const) : ("not_enabled" as const) };
    });
    let state: AccountConnectionState = available ? "idle" : "unavailable";
    if (row && row.status !== "CONNECTED") state = "reconnect";
    else if (row) state = capabilities.some((c) => c.status === "missing") ? "missing_permission" : "connected";
    const account = row?.accounts.find((a) => a.isActive) ?? row?.accounts[0];
    return { provider: p, oauth, available, state, integrationId: row?.id ?? null, email: account?.handle ?? null, healthKey: state === "reconnect" ? (row?.statusMessage ?? "unknown") : null, capabilities };
  });
  return {
    cards,
    accounts: accountCards,
    website: { url: site?.url ?? org.website ?? null, status: site?.status ?? null },
    plan: { used: usage.socialChannels.used, limit: usage.socialChannels.limit },
    isDemo,
  };
}

const PLATFORM_LIST = /^[A-Z]+(,[A-Z]+){0,6}$/;

/** Parses the post-OAuth query (platform names and a short error code only). */
export function parseConnectFlash(sp: Record<string, string | string[] | undefined>) {
  const list = (k: string) => {
    const v = sp[k];
    return typeof v === "string" && PLATFORM_LIST.test(v) ? v.split(",") : [];
  };
  const error = typeof sp.error === "string" && /^[a-z_]{1,40}$/.test(sp.error) ? sp.error : null;
  const up = typeof sp.upgrade === "string" ? /^([A-Z]{2,12}):([a-z_]{2,40})$/.exec(sp.upgrade) : null;
  return {
    connected: list("connected"),
    choose: list("choose"),
    limited: list("limited"),
    error,
    upgrade: up ? { platform: up[1], capability: up[2] } : null,
    identity: sp.identity === "meta",
  };
}
