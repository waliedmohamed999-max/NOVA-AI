"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Bookmark, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import { SETUP_STEPS, type SetupStep } from "@/lib/onboarding-setup";
import { useSetup } from "./state";

/** Continue (validates this step's required answers, saves, moves on) · next-step hint · save draft. Sticky on mobile. */
export function StepFooter({ step }: { step: Exclude<SetupStep, "review"> }) {
  const t = useTranslations("onboarding.setup");
  const te = useTranslations("errors");
  const s = useSetup();
  const [pending, start] = useTransition();
  const [tried, setTried] = useState(false);
  const next = SETUP_STEPS[SETUP_STEPS.indexOf(step) + 1];
  const ready = s.ready(step);

  const onContinue = () => {
    setTried(true);
    if (!ready) return;
    start(async () => {
      const ok = await s.goTo(next, step);
      if (!ok) toast(te((s.saveError ?? "unexpected") as "unexpected"), "error");
      else window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };
  const onDraft = () =>
    start(async () => {
      const ok = await s.flush();
      toast(ok ? t("save.draftSaved") : te((s.saveError ?? "unexpected") as "unexpected"), ok ? "success" : "error");
    });

  return (
    <div className="max-md:sticky max-md:bottom-0 max-md:-mx-5 max-md:-mb-5 max-md:rounded-b-[20px] max-md:border-t max-md:border-line max-md:bg-surface/95 max-md:px-5 max-md:py-4 max-md:backdrop-blur">
      {tried && !ready && (
        <p role="alert" className="mb-3 text-sm font-medium text-danger">
          {t("nav.missing")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onContinue}
          disabled={pending}
          data-testid="setup-continue"
          className={cn(
            "inline-flex h-12 items-center gap-3 rounded-2xl bg-ink ps-6 pe-4 text-[15px] font-semibold text-ink-inverse transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nova-blue disabled:opacity-70",
            !ready && "opacity-80",
          )}
        >
          {t("nav.continue")}
          <span className="flex size-7 items-center justify-center rounded-full bg-accent text-white">{pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowLeft className="size-4 ltr:rotate-180" />}</span>
        </button>
        <span className="hidden text-sm text-ink-3 sm:inline">{t("nav.next", { step: t(`steps.${next}.title`) })}</span>
        <button type="button" onClick={onDraft} disabled={pending} className="ms-auto inline-flex h-11 items-center gap-2 rounded-2xl border border-line bg-surface px-4 text-sm font-semibold text-ink-2 transition hover:border-line-strong">
          <Bookmark className="size-4" /> {t("save.draft")}
        </button>
      </div>
    </div>
  );
}
