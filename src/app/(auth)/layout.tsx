import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { LegalLinks } from "@/features/legal/legal-page";
import { Check } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LocaleSwitch } from "@/components/shell/locale-switch";

/**
 * Auth pages in the reference language: a white form column with a display headline, and a black panel
 * with the aurora glow, a silver claim and the real product (the demo workspace screenshot) rising from
 * the bottom.
 */
export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("auth.side");
  const locale = (await getLocale()) === "ar" ? "ar" : "en";
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,620px)]">
      <main className="flex flex-col px-5 py-5 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Home">
            <Logo />
          </Link>
          <LocaleSwitch />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px] animate-fade-up">{children}</div>
        </div>
        <LegalLinks locale={locale} />
      </main>

      <aside className="on-dark relative hidden overflow-hidden bg-black text-white lg:flex lg:flex-col lg:px-12 lg:pt-14" data-theme="dark">
        <div className="pointer-events-none absolute inset-x-[-20%] bottom-[-10%] h-[70%] aurora opacity-80 blur-3xl" aria-hidden />
        <ul className="relative space-y-3">
          {(["one", "two", "three"] as const).map((k) => (
            <li key={k} className="flex items-center gap-2.5 text-[15px] text-white/75">
              <Check className="size-[18px] text-[#0091ff]" strokeWidth={2.5} aria-hidden />
              {t(`points.${k}`)}
            </li>
          ))}
        </ul>
        <figure className="relative mt-12">
          <blockquote className="text-silver text-[36px] font-bold leading-[1.1] tracking-[-0.035em] text-balance">“{t("quote")}”</blockquote>
          <figcaption className="mt-4 font-mono text-[12px] uppercase tracking-[0.1em] text-white/45">{t("quoteBy")}</figcaption>
        </figure>
        <div className="relative mt-auto translate-y-6 pt-12">
          {/* eslint-disable-next-line @next/next/no-img-element -- static product screenshot */}
          <img
            src={`/landing/${locale}-home.jpg`}
            alt=""
            className="w-[760px] max-w-none rounded-t-[14px] border border-b-0 border-white/10 shadow-[0_-20px_60px_-20px_rgba(118,18,250,.55)] ltr:ml-0 rtl:mr-0"
          />
        </div>
      </aside>
    </div>
  );
}
