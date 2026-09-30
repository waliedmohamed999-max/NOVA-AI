import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/logo";
import { SiteNav } from "@/features/landing/site-nav";
import { ProductShowcase } from "@/features/landing/showcase";
import { HeroOrbit } from "@/features/landing/hero-orbit";
import { BrainDarkSection, ChannelsStrip, FeatureGrid, FinalCta, PricingSection, ProblemSection, SiteFooter, TeamSection } from "@/features/landing/sections";
import { getSession } from "@/server/auth/session";

/**
 * Marketing page, built on the reference rhythm: announcement pill → nav → two-tone display headline + one
 * big ink CTA beside the NOVA sphere with the product's hubs in orbit → the real product → channels strip → problem → feature grid → team →
 * black Brain panel → pricing → black closing panel → footer.
 */
export default async function LandingPage() {
  const t = await getTranslations("landing.v2");
  const locale = (await getLocale()) === "ar" ? "ar" : "en";
  const signedIn = Boolean(await getSession());

  return (
    <div className="overflow-x-clip">
      <SiteNav signedIn={signedIn} />

      <section className="mx-auto grid max-w-[1200px] items-center gap-x-6 gap-y-10 px-5 pb-14 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:pt-20">
        <div className="min-w-0">
          <a
            href="#how"
            className="animate-fade-up inline-flex items-center gap-1.5 max-w-full whitespace-nowrap rounded-full border border-line bg-surface py-1.5 pe-2.5 ps-3.5 text-[12.5px] font-medium text-ink xs:text-[13.5px] sm:text-[15px] transition-colors duration-150 hover:border-line-strong"
          >
            {t("announce.text")} <LogoMark size={18} className="ms-0.5" /> <span className="font-semibold">{t("announce.label")}</span>
            <ChevronRight className="size-4 text-ink-3 flip-rtl" aria-hidden />
          </a>
          <h1 className="animate-fade-up mt-7 max-w-[1000px] text-display font-bold text-balance [animation-delay:60ms] lg:text-[clamp(3rem,0.6rem+3.9vw,4.4rem)]">
            {t("hero.title")}
            <span className="tone-tail mt-1 block text-[0.66em] leading-[1.1] tracking-[-0.04em]">{t("hero.tail")}</span>
          </h1>
          <div className="animate-fade-up mt-10 flex flex-wrap items-center gap-4 [animation-delay:120ms]">
            <Link href={signedIn ? "/home" : "/sign-up"} className={buttonClass("primary", "lg", "h-[56px] px-7 text-[19px]")}>
              {t("hero.primary")}
            </Link>
            <p className="text-[14px] leading-snug text-ink-3">
              {t("hero.note1")}
              <br />
              {t("hero.note2")}
            </p>
          </div>
        </div>
        <HeroOrbit className="animate-fade-up [animation-delay:160ms]" />
      </section>

      <ProductShowcase />
      <ChannelsStrip />
      <ProblemSection />
      <FeatureGrid />
      <TeamSection />
      <BrainDarkSection />
      <PricingSection />
      <FinalCta signedIn={signedIn} />
      <SiteFooter locale={locale} />
    </div>
  );
}
