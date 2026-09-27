import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { brand } from "@/config/brand";
import { defaultLocale, isLocale, type Locale } from "./config";
import { loadMessages } from "./load";
import { resolveTenant } from "@/server/context";

async function resolveLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(brand.localeCookie)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const accept = (await headers()).get("accept-language") ?? "";
  return accept.toLowerCase().startsWith("ar") ? "ar" : defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  // Dates render in the company time zone so schedules match what the owner expects.
  const tenant = await resolveTenant().catch(() => null);
  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: tenant?.organization.timezone ?? "UTC",
    now: new Date(),
  };
});
