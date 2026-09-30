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

      <section className="mx-auto grid max-w-[1200px] items-center gap-x-6 gap-y-7 px-5 pb-14 pt-5 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:pt-20">
        <div className="min-w-0 text-center lg:text-start">
          <a
            href="#how"
            className="animate-fade-up hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface py-1.5 pe-2.5 ps-3.5 text-[15px] font-medium text-ink transition-colors sm:inline-flex duration-150 hover:border-line-strong"
          >
            {t("announce.text")} <LogoMark size={18} className="ms-0.5" /> <span className="font-semibold">{t("announce.label")}</span>
            <ChevronRight className="size-4 text-ink-3 flip-rtl" aria-hidden />
          </a>
          <h1 className="animate-fade-up mx-auto max-w-[1000px] sm:mt-6 text-display font-bold lg:mx-0 lg:mt-7 text-balance [animation-delay:60ms] lg:text-[clamp(3rem,0.6rem+3.9vw,4.4rem)]">
            {t("hero.title")}
            <span className="tone-tail mt-1 block text-[0.66em] leading-[1.1] tracking-[-0.04em]">{t("hero.tail")}</span>
          </h1>
          <div className="animate-fade-up mt-8 flex flex-col items-center gap-3 [animation-delay:120ms] sm:flex-row sm:justify-center sm:gap-4 lg:mt-10 lg:justify-start">
            <Link href={signedIn ? "/home" : "/sign-up"} className={buttonClass("primary", "lg", "h-[56px] w-full max-w-[340px] px-7 text-[19px] sm:w-auto")}>
              {t("hero.primary")}
            </Link>
            <p className="text-[14px] leading-snug text-ink-3 sm:text-start">
              {t("hero.note1")}
              <br className="hidden sm:block" /> {t("hero.note2")}
            </p>
          </div>
        </div>
        {/* Phones/tablets: the sphere leads, the headline follows. */}
        <HeroOrbit className="animate-fade-up order-first lg:order-none lg:[animation-delay:160ms]" />
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
