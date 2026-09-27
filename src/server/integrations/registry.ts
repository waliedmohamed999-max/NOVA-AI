import type { Provider } from "@/generated/prisma/enums";
import { MetaProvider } from "./providers/meta";
import { LinkedInProvider } from "./providers/linkedin";
import { TikTokProvider } from "./providers/tiktok";
import type { SocialProvider } from "./types";

const meta = new MetaProvider();
const linkedin = new LinkedInProvider();
const tiktok = new TikTokProvider();

export const SOCIAL_PROVIDERS: Record<SocialProvider["id"], SocialProvider> = { meta, linkedin, tiktok };

/** Test hook. */
export function setSocialProvider(id: SocialProvider["id"], p: SocialProvider) {
  SOCIAL_PROVIDERS[id] = p;
}

export type CatalogEntry = { provider: Provider; oauth: SocialProvider["id"] | null; stage: "available" | "future"; docs: string };

/** What the Integration Center shows. Future connectors are listed but not connectable. */
export const INTEGRATION_CATALOG: CatalogEntry[] = [
  { provider: "INSTAGRAM", oauth: "meta", stage: "available", docs: "META_APP_ID / META_APP_SECRET" },
  { provider: "FACEBOOK", oauth: "meta", stage: "available", docs: "META_APP_ID / META_APP_SECRET" },
  { provider: "LINKEDIN", oauth: "linkedin", stage: "available", docs: "LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET" },
  { provider: "TIKTOK", oauth: "tiktok", stage: "available", docs: "TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET" },
  { provider: "X", oauth: null, stage: "future", docs: "" },
  { provider: "YOUTUBE", oauth: null, stage: "future", docs: "" },
  { provider: "PINTEREST", oauth: null, stage: "future", docs: "" },
];

export function providerFor(provider: Provider): SocialProvider | null {
  const entry = INTEGRATION_CATALOG.find((c) => c.provider === provider);
  return entry?.oauth ? SOCIAL_PROVIDERS[entry.oauth] : null;
}

export function providerForPlatform(platform: string): SocialProvider | null {
  return providerFor(platform as Provider);
}

const REDIRECT_ENV: Record<SocialProvider["id"], string> = { meta: "META_REDIRECT_URI", linkedin: "LINKEDIN_REDIRECT_URI", tiktok: "TIKTOK_REDIRECT_URI" };

/**
 * The exact callback URL registered with the provider. `<PROVIDER>_REDIRECT_URI` wins (it must match
 * the provider console character-for-character); otherwise it is derived from APP_URL.
 */
export function redirectUriFor(id: SocialProvider["id"]) {
  const explicit = process.env[REDIRECT_ENV[id]]?.trim();
  if (explicit) {
    const u = new URL(explicit);
    if (!u.pathname.endsWith(`/api/integrations/${id}/callback`)) throw new Error(`${REDIRECT_ENV[id]} must point to /api/integrations/${id}/callback`);
    return u.toString();
  }
  return `${process.env.APP_URL ?? "http://localhost:3000"}/api/integrations/${id}/callback`;
}

export type RegistryEntry = {
  id: string;
  label: string;
  /** "live" = implemented against the official API; "planned" = listed, not connectable yet. */
  stage: "live" | "planned";
  platforms: string[];
  provider: SocialProvider | null;
};

/**
 * Central provider registry (the single place that knows every connector).
 * Google and Microsoft are planned email/identity connectors — OAuth only, never passwords.
 */
export function providerRegistry(): RegistryEntry[] {
  return [
    { id: "meta", label: "Meta", stage: "live", platforms: ["FACEBOOK", "INSTAGRAM"], provider: SOCIAL_PROVIDERS.meta },
    { id: "linkedin", label: "LinkedIn", stage: "live", platforms: ["LINKEDIN"], provider: SOCIAL_PROVIDERS.linkedin },
    { id: "tiktok", label: "TikTok", stage: "live", platforms: ["TIKTOK"], provider: SOCIAL_PROVIDERS.tiktok },
    { id: "google", label: "Google", stage: "planned", platforms: ["EMAIL"], provider: null },
    { id: "microsoft", label: "Microsoft", stage: "planned", platforms: ["EMAIL"], provider: null },
  ];
}
