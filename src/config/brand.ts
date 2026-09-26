/**
 * Central product branding. Rename the product here — nothing else in the
 * codebase should hardcode the product name, tagline or support addresses.
 */
export const brand = {
  name: "NOVA",
  subtitle: {
    en: "AI Growth Team",
    ar: "فريق النمو الذكي",
  },
  tagline: {
    en: "Your AI Growth Team. Content, social media, leads and sales — working together.",
    ar: "فريق النمو الذكي لشركتك. المحتوى والتواصل الاجتماعي والعملاء والمبيعات — يعملون معًا.",
  },
  domain: "nova.ai",
  supportEmail: "support@nova.ai",
  legalName: "NOVA Technologies",
  sessionCookie: "nova_session",
  localeCookie: "nova_locale",
  sidebarCookie: "nova_sidebar",
  themeCookie: "nova_theme",
} as const;

export type BrandConfig = typeof brand;
