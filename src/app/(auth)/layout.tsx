import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { LegalLinks } from "@/features/legal/legal-page";
import { Check } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LocaleSwitch } from "@/components/shell/locale-switch";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("auth.side");
  const c = await getTranslations("common");
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <main className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Home">
            <Logo subtitle={c("subtitle")} />
          </Link>
          <LocaleSwitch />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px] animate-fade-up">{children}</div>
        </div>
        <LegalLinks locale={(await getLocale()) === "ar" ? "ar" : "en"} />
      </main>

      <aside className="relative hidden overflow-hidden border-s border-line bg-canvas text-ink lg:flex lg:flex-col lg:justify-between lg:p-12" data-theme="dark">
        <div className="absolute inset-0 opacity-70 ai-aura" aria-hidden />
        <div className="absolute -end-40 -top-40 size-[520px] rounded-full border border-white/5" aria-hidden />
        <div className="absolute -end-20 -top-20 size-[360px] rounded-full border border-white/5" aria-hidden />
        <div className="relative space-y-4 pt-10">
          {(["one", "two", "three"] as const).map((k) => (
            <div key={k} className="flex items-center gap-3 text-[15px] text-ink-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-accent/20 text-accent">
                <Check className="size-3.5" />
              </span>
              {t(`points.${k}`)}
            </div>
          ))}
        </div>
        <figure className="relative space-y-5">
          <blockquote className="font-display text-[34px] leading-[1.15] tracking-[-0.01em] text-ink text-balance">“{t("quote")}”</blockquote>
          <figcaption className="text-sm text-ink-3">{t("quoteBy")}</figcaption>
        </figure>
      </aside>
    </div>
  );
}
