import Link from "next/link";
import { getLocale } from "next-intl/server";
import { LegalLinks } from "@/features/legal/legal-page";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Check, PlayCircle } from "lucide-react";
import { AGENTS } from "@/config/agents";
import { PLAN_ORDER } from "@/config/plans";
import { buttonClass } from "@/components/ui/button";
import { AgentMark } from "@/components/agents/agent-mark";
import { Logo } from "@/components/brand/logo";
import { LandingNav } from "@/features/landing/nav";
import { HeroWorkspace, ActivityStrip, BrainDiagram } from "@/features/landing/visuals";
import { getSession } from "@/server/auth/session";

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const tc = await getTranslations("common");
  const signedIn = Boolean(await getSession());
  const brainItems = t.raw("brain.items") as string[];

  return (
    <div className="overflow-x-clip">
      <LandingNav signedIn={signedIn} />

      {/* Hero */}
      <section className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[720px] ai-aura opacity-80" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[720px] dot-grid opacity-40 [mask-image:radial-gradient(60%_60%_at_50%_30%,black,transparent)]" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-16 sm:pt-24 lg:grid-cols-[1.05fr_1fr] lg:px-8">
          <div className="animate-fade-up space-y-8">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs font-medium text-ink-2 shadow-xs backdrop-blur">
              <span className="size-1.5 rounded-full bg-accent" /> {t("hero.eyebrow")}
            </span>
            <h1 className="text-display font-semibold text-balance">
              {t("hero.line1")}
              <br />
              <span className="text-gradient font-extrabold">{t("hero.line2")}</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-ink-2 text-pretty">{t("hero.body")}</p>
            <div className="flex flex-wrap gap-3">
              <Link href={signedIn ? "/home" : "/sign-up"} className={buttonClass("primary", "lg")}>
                {t("hero.primary")} <ArrowRight className="size-4 flip-rtl" />
              </Link>
              <a href="#how" className={buttonClass("secondary", "lg")}>
                <PlayCircle className="size-4" /> {t("hero.secondary")}
              </a>
            </div>
            <p className="text-sm text-ink-3">{t("hero.note")}</p>
          </div>
          <HeroWorkspace />
        </div>
        <ActivityStrip />
      </section>

      {/* AI team */}
      <section id="team" className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
        <div className="max-w-2xl space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent-ink">{t("team.eyebrow")}</p>
          <h2 className="text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl">{t("team.title")}</h2>
          <p className="text-lg text-ink-3">{t("team.body")}</p>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((a) => (
            <article key={a.key} className="group rounded-[20px] border border-line bg-surface p-7 shadow-xs transition hover:-translate-y-1 hover:shadow-md">
              <AgentMark agent={a.key} size={48} />
              <h3 className="mt-6 text-lg font-semibold tracking-tight">{tc(`agents.${a.key}.name`)}</h3>
              <p className="mt-1.5 text-[15px] text-ink-3">{tc(`agents.${a.key}.role`)}</p>
              <p className="mt-5 border-t border-line pt-4 text-sm text-ink-2">{t(`team.examples.${a.key}` as "team.examples.SOCIAL_MANAGER")}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Company brain */}
      <section id="brain" className="border-y border-line bg-surface-2">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-24 lg:grid-cols-2 lg:px-8">
          <div className="space-y-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent-ink">{t("brain.eyebrow")}</p>
            <h2 className="text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl">{t("brain.title")}</h2>
            <p className="text-lg text-ink-3">{t("brain.body")}</p>
            <ul className="flex flex-wrap gap-2 pt-2">
              {brainItems.map((x) => (
                <li key={x} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink-2">{x}</li>
              ))}
            </ul>
          </div>
          <BrainDiagram items={brainItems.slice(0, 8)} center={t("brain.center")} />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
        <h2 className="max-w-2xl text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl">{t("how.title")}</h2>
        <ol className="mt-14 grid gap-4 md:grid-cols-4">
          {(["connect", "understand", "create", "grow"] as const).map((k, i) => (
            <li key={k} className="rounded-[20px] border border-line bg-surface p-7">
              <span className="font-display text-5xl font-extrabold tracking-[-0.04em] text-accent">{i + 1}</span>
              <h3 className="mt-6 text-lg font-semibold">{t(`how.steps.${k}.title`)}</h3>
              <p className="mt-2 text-[15px] text-ink-3">{t(`how.steps.${k}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-line bg-surface-2">
        <div className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
          <div className="mx-auto max-w-2xl space-y-4 text-center">
            <h2 className="text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">{t("pricing.title")}</h2>
            <p className="text-lg text-ink-3">{t("pricing.body")}</p>
          </div>
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {PLAN_ORDER.map((p) => (
              <div key={p} className={`rounded-[20px] border p-8 ${p === "GROWTH" ? "border-ink bg-ink text-ink-inverse shadow-lg" : "border-line bg-surface"}`}>
                <h3 className="text-xl font-semibold">{t(`pricing.plans.${p}.name`)}</h3>
                <p className={`mt-2 text-sm ${p === "GROWTH" ? "opacity-70" : "text-ink-3"}`}>{t(`pricing.plans.${p}.tagline`)}</p>
                <ul className="mt-8 space-y-3 text-[15px]">
                  {(t.raw(`pricing.plans.${p}.features`) as string[]).map((f) => (
                    <li key={f} className="flex gap-3">
                      <Check className={`mt-0.5 size-4 shrink-0 ${p === "GROWTH" ? "text-accent" : "text-success"}`} /> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/sign-up" className={`mt-8 ${buttonClass(p === "GROWTH" ? "accent" : "secondary", "md", "w-full")}`}>{t("pricing.cta")}</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
        <div className="relative overflow-hidden rounded-[20px] bg-ink px-8 py-16 text-center text-ink-inverse sm:px-16">
          <div className="absolute inset-0 ai-aura opacity-90" aria-hidden />
          <div className="relative mx-auto max-w-2xl space-y-6">
            <h2 className="text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl">{t("final.title")}</h2>
            <p className="text-lg opacity-75">{t("final.body")}</p>
            <Link href="/sign-up" className={buttonClass("accent", "lg")}>
              {t("hero.primary")} <ArrowRight className="size-4 flip-rtl" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 py-10 text-sm text-ink-3 sm:flex-row lg:px-8">
          <Logo subtitle={tc("subtitle")} />
          <p>{t("footer")}</p>
          <LegalLinks locale={(await getLocale()) === "ar" ? "ar" : "en"} />
        </div>
      </footer>
    </div>
  );
}
