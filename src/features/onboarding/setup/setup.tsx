"use client";

import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { SetupProvider, useSetup, type SetupInit } from "./state";
import { Sidebar, Stepper, TopBar } from "./chrome";
import { HeroGraphic } from "./visuals";
import { StatusChip } from "./ui";
import { BusinessStep } from "./step-business";
import { AudienceStep } from "./step-audience";
import { BrandStep } from "./step-brand";
import { GoalsStep } from "./step-goals";
import { ChannelsStep } from "./step-channels";
import { ReviewStep } from "./step-review";

type User = { name: string | null; email: string; isPlatformAdmin: boolean };

/** Guided company setup: top bar · hero · stepper · the current step · progress sidebar (drawer on mobile). */
export function SetupExperience({ init, user, unread }: { init: SetupInit; user: User; unread: number | null }) {
  return (
    <SetupProvider init={init}>
      <div className="min-h-dvh bg-setup-bg">
        <TopBar user={user} unread={unread} />
        <div className="mx-auto grid max-w-[1320px] gap-6 px-4 pb-16 pt-6 sm:px-6 xl:grid-cols-[minmax(0,1fr)_340px] lg:px-8 lg:pt-8">
          <main className="min-w-0 space-y-6">
            <Hero />
            <Stepper />
            <CurrentStep />
          </main>
          <Sidebar />
        </div>
      </div>
    </SetupProvider>
  );
}

function Hero() {
  const t = useTranslations("onboarding.setup");
  const s = useSetup();
  const name = s.userName.split(/\s+/)[0];
  const [before, after] = t("hero.title", { name: "\u0000" }).split("\u0000");
  return (
    <section className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,var(--nova-hero-from)_0%,var(--nova-hero-to)_100%)] px-5 py-6 ring-1 ring-nova-line sm:px-8 sm:py-8">
      <div className="grid items-center gap-4 md:grid-cols-[minmax(0,1fr)_260px] lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          <h1 className="text-balance text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-[34px]">
            {before}
            <span className="text-nova-blue">{name}</span>
            {after}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-ink-2 max-sm:line-clamp-2 sm:text-base">{t("hero.subtitle")}</p>
          <Chips />
        </div>
        <HeroGraphic className="hidden md:block" />
      </div>
    </section>
  );
}

function Chips() {
  const t = useTranslations("onboarding.setup.chips");
  const s = useSetup();
  const audience = Boolean(s.answers.customerType && s.answers.customers?.trim());
  const chips = [
    s.site.phase === "applied" && <StatusChip key="w">{t("websiteAnalyzed")}</StatusChip>,
    s.brainUpdated && <StatusChip key="b" tone="info">{t("brainUpdated")}</StatusChip>,
    audience && <StatusChip key="a" tone="accent">{t("audienceDetected")}</StatusChip>,
    s.strategy && <StatusChip key="s">{t("strategyReady")}</StatusChip>,
  ].filter(Boolean);
  if (!chips.length) return null;
  return <div className="flex flex-wrap gap-2 pt-1" data-testid="setup-chips">{chips}</div>;
}

function CurrentStep() {
  const s = useSetup();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={s.step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
        {s.step === "business" && <BusinessStep />}
        {s.step === "audience" && <AudienceStep />}
        {s.step === "brand" && <BrandStep />}
        {s.step === "goals" && <GoalsStep />}
        {s.step === "channels" && <ChannelsStep />}
        {s.step === "review" && <ReviewStep />}
      </motion.div>
    </AnimatePresence>
  );
}
