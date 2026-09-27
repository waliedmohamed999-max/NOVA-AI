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

export function redirectUriFor(id: SocialProvider["id"]) {
  return `${process.env.APP_URL ?? "http://localhost:3000"}/api/integrations/${id}/callback`;
}
