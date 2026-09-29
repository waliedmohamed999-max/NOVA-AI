import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Inter, Plus_Jakarta_Sans, Sometype_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTimeZone } from "next-intl/server";
import { brand } from "@/config/brand";
import { dirFor, isLocale } from "@/i18n/config";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

/** Plus Jakarta Sans for display + UI, Inter for supporting copy, Sometype Mono for meta labels; Arabic: IBM Plex Sans Arabic. */
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], display: "swap" });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const sometype = Sometype_Mono({ variable: "--font-sometype", subsets: ["latin"], weight: ["400", "500"], display: "swap" });
const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});


export const metadata: Metadata = {
  title: { default: `${brand.name} — ${brand.subtitle.en}`, template: `%s · ${brand.name}` },
  description: brand.tagline.en,
  applicationName: brand.name,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0e" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const messages = await getMessages();
  const timeZone = await getTimeZone();
  const theme = (await cookies()).get(brand.themeCookie)?.value === "dark" ? "dark" : "light";
  const dir = dirFor(isLocale(locale) ? locale : "en");

  return (
    <html
      lang={locale}
      dir={dir}
      data-theme={theme}
      className={`${jakarta.variable} ${inter.variable} ${sometype.variable} ${plexArabic.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <NextIntlClientProvider locale={locale} messages={messages} now={new Date()} timeZone={timeZone}>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
