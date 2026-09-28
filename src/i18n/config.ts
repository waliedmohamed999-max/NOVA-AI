export const locales = ["en", "ar"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
export const rtlLocales: readonly Locale[] = ["ar"];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return rtlLocales.includes(locale) ? "rtl" : "ltr";
}

/** Namespaces are split into files under ./messages/{locale}/{namespace}.json */
export const namespaces = [
  "common",
  "landing",
  "auth",
  "onboarding",
  "app",
  "content",
  "leads",
  "sales",
  "analytics",
  "settings",
  "brain",
  "errors",
] as const;
