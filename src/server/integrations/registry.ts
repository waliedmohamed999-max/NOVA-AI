import type { Provider } from "@/generated/prisma/enums";
import { MetaProvider } from "./providers/meta";
import { InstagramProvider } from "./providers/instagram";
import { GoogleProvider } from "./providers/google";
import { MicrosoftProvider } from "./providers/microsoft";
import { LinkedInProvider } from "./providers/linkedin";
import { TikTokProvider } from "./providers/tiktok";
import type { SocialProvider } from "./types";

const meta = new MetaProvider();
const instagram = new InstagramProvider();
const google = new GoogleProvider();
const microsoft = new MicrosoftProvider();
const linkedin = new LinkedInProvider();
const tiktok = new TikTokProvider();

export const SOCIAL_PROVIDERS: Record<SocialProvider["id"], SocialProvider> = { meta, instagram, linkedin, tiktok, google, microsoft };

/** Test hook. */
export function setSocialProvider(id: SocialProvider["id"], p: SocialProvider) {
  SOCIAL_PROVIDERS[id] = p;
}

export type CatalogEntry = { provider: Provider; oauth: SocialProvider["id"] | null; stage: "available" | "future"; docs: string };

/** What the Integration Center shows. Future connectors are listed but not connectable. */
export const INTEGRATION_CATALOG: CatalogEntry[] = [
  // Instagram Direct (Instagram API with Instagram Login) — its own provider, not a child of a Facebook Page.
  { provider: "INSTAGRAM", oauth: "instagram", stage: "available", docs: "INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET" },
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

const REDIRECT_ENV: Record<SocialProvider["id"], string> = { meta: "META_REDIRECT_URI", instagram: "INSTAGRAM_REDIRECT_URI", linkedin: "LINKEDIN_REDIRECT_URI", tiktok: "TIKTOK_REDIRECT_URI", google: "GOOGLE_REDIRECT_URI", microsoft: "MICROSOFT_REDIRECT_URI" };

/**
 * The exact callback URL registered with the provider. `<PROVIDER>_REDIRECT_URI` wins (it must match
 * the provider console character-for-character); otherwise it is derived from APP_URL.
 */
export function redirectUriFor(id: SocialProvider["id"]) {
  const explicit = process.env[REDIRECT_ENV[id]]?.trim().replace(/^["']|["']$/g, "");
  if (explicit) {
    // Returned literally (not re-serialized) so the authorization request and the token exchange send
    // exactly the string registered in the provider console. It must be the backend OAuth callback —
    // never an in-app page like /settings/connected-accounts (that is where NOVA returns afterwards).
    const u = new URL(explicit);
    if (!/^https?:$/.test(u.protocol) || u.search || u.hash || u.pathname !== `/api/integrations/${id}/callback`) {
      throw new Error(`${REDIRECT_ENV[id]} must be <origin>/api/integrations/${id}/callback with no query or fragment`);
    }
    return explicit;
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
    { id: "meta", label: "Facebook Pages (Meta)", stage: "live", platforms: ["FACEBOOK"], provider: SOCIAL_PROVIDERS.meta },
    { id: "instagram", label: "Instagram Direct", stage: "live", platforms: ["INSTAGRAM"], provider: SOCIAL_PROVIDERS.instagram },
    { id: "linkedin", label: "LinkedIn", stage: "live", platforms: ["LINKEDIN"], provider: SOCIAL_PROVIDERS.linkedin },
    { id: "tiktok", label: "TikTok", stage: "live", platforms: ["TIKTOK"], provider: SOCIAL_PROVIDERS.tiktok },
    { id: "google", label: "Google (Gmail + Calendar)", stage: "live", platforms: ["GOOGLE"], provider: SOCIAL_PROVIDERS.google },
    { id: "microsoft", label: "Microsoft (Outlook + Calendar)", stage: "live", platforms: ["MICROSOFT"], provider: SOCIAL_PROVIDERS.microsoft },
  ];
}

/** Non-secret OAuth setup summary for logs and admin diagnostics. Never includes secrets or tokens. */
export function oauthSetupSummary() {
  return (["linkedin", "meta", "instagram", "tiktok", "google", "microsoft"] as const).map((id) => {
    let redirectUri: string | null = null;
    let problem: string | null = null;
    try {
      redirectUri = redirectUriFor(id);
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
    return { id, configured: SOCIAL_PROVIDERS[id].isConfigured(), redirectUri, explicit: Boolean(process.env[REDIRECT_ENV[id]]?.trim()), problem, scopes: SOCIAL_PROVIDERS[id].scopes };
  });
}

export type CallbackEntry = { kind: "oauth" | "webhook" | "auth" | "legal"; name: string; url: string; registerAt: string; problem: "not_https" | "localhost" | "invalid" | null };

/**
 * Every URL that must be registered with an external provider (or reviewed by one) for staging/production.
 * Flags anything that is not public HTTPS — providers reject or silently break on localhost/http.
 */
export function callbackMatrix(appUrl = process.env.APP_URL ?? "http://localhost:3000"): CallbackEntry[] {
  const base = appUrl.replace(/\/$/, "");
  const judge = (u: string): CallbackEntry["problem"] => {
    try {
      const url = new URL(u);
      if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname) || url.hostname.endsWith(".local")) return "localhost";
      return url.protocol === "https:" ? null : "not_https";
    } catch {
      return "invalid";
    }
  };
  const oauth = (id: SocialProvider["id"], registerAt: string): CallbackEntry => {
    let url: string;
    try {
      url = redirectUriFor(id);
    } catch {
      return { kind: "oauth", name: id, url: process.env[REDIRECT_ENV[id]] ?? "", registerAt, problem: "invalid" };
    }
    return { kind: "oauth", name: id, url, registerAt, problem: judge(url) };
  };
  const plain = (kind: CallbackEntry["kind"], name: string, path: string, registerAt: string): CallbackEntry => ({ kind, name, url: `${base}${path}`, registerAt, problem: judge(`${base}${path}`) });
  return [
    oauth("meta", "Meta App → Facebook Login for Business → Valid OAuth Redirect URIs"),
    oauth("instagram", "Meta App → Instagram API with Instagram Login → Business login settings → OAuth redirect URIs"),
    oauth("linkedin", "LinkedIn Developer App → Auth → Authorized redirect URLs"),
    oauth("tiktok", "TikTok for Developers → Login Kit → Redirect URI"),
    oauth("google", "Google Cloud → Credentials → OAuth client → Authorized redirect URIs"),
    oauth("microsoft", "Microsoft Entra → App registrations → Authentication → Web redirect URIs"),
    plain("auth", "google_sign_in", "/api/auth/google/callback", "Google Cloud → same OAuth client → Authorized redirect URIs"),
    plain("auth", "magic_link", "/magic", "Email links (no registration; APP_URL must be the public HTTPS origin)"),
    plain("webhook", "whatsapp", "/api/webhooks/whatsapp", "Meta App → WhatsApp → Configuration → Callback URL (+ WHATSAPP_VERIFY_TOKEN)"),
    plain("webhook", "stripe", "/api/webhooks/stripe", "Stripe Dashboard → Developers → Webhooks → endpoint (copy whsec_ to STRIPE_WEBHOOK_SECRET)"),
    plain("legal", "privacy", "/privacy", "Meta / LinkedIn / TikTok / Google app settings → Privacy policy URL"),
    plain("legal", "terms", "/terms", "App settings → Terms of service URL"),
    plain("legal", "data_deletion", "/data-deletion", "Meta App → Settings → Basic → Data deletion instructions URL"),
  ];
}
