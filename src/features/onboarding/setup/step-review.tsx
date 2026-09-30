"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, FileText, Link2, Loader2, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { useRun, RunSteps } from "@/features/agents/run-view";
import { BUSINESS_TYPES, CUSTOMER_TYPES, GOALS, SETUP_STEPS, TONES, VISUAL_STYLES, countryName, label, type SetupStep } from "@/lib/onboarding-setup";
import { finishSetupAction, skipSetupAction } from "../actions";
import { useSetup } from "./state";
import { StepCard } from "./ui";

export function ReviewStep() {
  const t = useTranslations("onboarding.setup");
  const tr = useTranslations("onboarding.setup.review");
  const te = useTranslations("errors");
  const s = useSetup();
  const a = s.answers;
  const [runId, setRunId] = useState<string | null>(a.runId && s.answers.setup?.completed?.includes("review") ? a.runId : null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const missing = SETUP_STEPS.filter((x) => x !== "review" && !s.ready(x));
  const join = (xs: (string | null | undefined)[], sep = " · ") => xs.filter(Boolean).join(sep);

  const enter = () =>
    start(async () => {
      setError(null);
      const ok = await s.flush();
      if (!ok) return setError(s.saveError ?? "unexpected");
      const r = await finishSetupAction();
      if (r.ok) setRunId(r.data.runId);
      else setError(r.error ?? "unexpected");
    });

  return (
    <>
      <StepCard icon={<FileText />} title={tr("title")} subtitle={tr("subtitle")}>
        <div className="grid gap-3 md:grid-cols-2">
          <Section title={tr("sections.company")} step="business">
            {join([s.companyName, a.industry, a.country && countryName(a.country, s.lang), a.markets])}
            {a.description && <p className="mt-1 text-ink-3">{a.description}</p>}
          </Section>
          <Section title={tr("sections.website")} step="business">
            {a.noWebsite ? t("business.website.none") : a.website ? <span dir="ltr">{a.website}</span> : null}
          </Section>
          <Section title={tr("sections.businessType")} step="business">
            {join([a.businessType && label(BUSINESS_TYPES[a.businessType], s.lang), a.offerings?.slice(0, 6).join("، ")])}
          </Section>
          <Section title={tr("sections.audience")} step="audience">
            {join([a.customerType && label(CUSTOMER_TYPES[a.customerType], s.lang), a.customers, a.audience?.locations])}
          </Section>
          <Section title={tr("sections.brand")} step="brand">
            <span className="flex flex-wrap items-center gap-2">
              {a.brand?.tones?.map((k) => label(TONES[k], s.lang)).join("، ")}
              {a.brand?.visualStyle && <span className="text-ink-3">· {label(VISUAL_STYLES[a.brand.visualStyle], s.lang)}</span>}
              {(a.colors ?? []).map((c) => (
                <span key={c} className="inline-block size-5 rounded-md ring-1 ring-line" style={{ background: c }} aria-hidden />
              ))}
            </span>
          </Section>
          <Section title={tr("sections.goals")} step="goals">
            {join([a.goalKeys?.map((k) => label(GOALS[k], s.lang)).join("، "), a.goal90])}
          </Section>
          <Section title={tr("sections.strategy")} step="goals" wide>
            {s.strategy ? join([s.strategy.title, t("goals.strategy.draft")]) : null}
          </Section>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-3xl border border-dashed border-nova-blue-line bg-nova-blue-soft/40 p-4 sm:p-5">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-surface text-nova-blue ring-1 ring-nova-blue-line">
            <Link2 className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">{tr("connect.title")}</p>
            <p className="text-xs text-ink-3">{tr("connect.body")}</p>
          </div>
          <Link href="/onboarding/connect" onClick={() => void s.flush()} className="inline-flex h-10 items-center rounded-2xl border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-nova-blue-line">
            {tr("connect.cta")}
          </Link>
        </div>

        <div className="relative overflow-hidden rounded-3xl bg-[linear-gradient(150deg,#0b1224_0%,#12204a_100%)] p-6 text-white sm:p-8">
          <div className="absolute -end-10 -top-10 size-48 rounded-full bg-accent/25 blur-3xl" aria-hidden />
          <div className="relative space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-accent text-white">
                <Sparkles className="size-5" />
              </span>
              <h3 className="text-xl font-bold">{tr("ready.title")}</h3>
            </div>
            <p className="max-w-xl text-sm text-white/75">{tr("ready.body")}</p>
            {!s.aiConfigured && <p className="text-xs text-white/60">{t("aiOptional")}</p>}
            {missing.length > 0 && (
              <p role="alert" className="text-sm font-medium text-[#ffb08f]">
                {tr("incomplete", { steps: missing.map((m) => t(`steps.${m}.title`)).join("، ") })}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm font-medium text-[#ffb08f]">
                {te(error as "unexpected")}
              </p>
            )}
            <div className="flex flex-wrap gap-3 pt-1">
              <button type="button" onClick={enter} disabled={pending || missing.length > 0} data-testid="enter-nova" className="inline-flex h-12 items-center gap-3 rounded-2xl bg-white ps-6 pe-4 text-[15px] font-bold text-[#0b1224] transition hover:-translate-y-0.5 disabled:opacity-50">
                {tr("enter")}
                <span className="flex size-7 items-center justify-center rounded-full bg-accent text-white">{pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowLeft className="size-4 ltr:rotate-180" />}</span>
              </button>
              <button type="button" onClick={() => void s.goTo("business")} className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/20 px-5 text-sm font-semibold text-white/90 hover:bg-white/10">
                <RotateCcw className="size-4" /> {tr("again")}
              </button>
            </div>
          </div>
        </div>
      </StepCard>
      {runId && <FinishOverlay runId={runId} onRetry={enter} />}
    </>
  );
}

function Section({ title, step, children, wide }: { title: string; step: SetupStep; children: ReactNode; wide?: boolean }) {
  const tr = useTranslations("onboarding.setup.review");
  const s = useSetup();
  const empty = children === null || children === "" || children === undefined || children === false;
  return (
    <div className={`rounded-2xl border border-line bg-surface-2 p-4 ${wide ? "md:col-span-2" : ""}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-3">{title}</h3>
        <button type="button" onClick={() => void s.goTo(step)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-nova-blue hover:bg-nova-blue-soft" aria-label={`${tr("edit")} — ${title}`}>
          <Pencil className="size-3" /> {tr("edit")}
        </button>
      </div>
      <div className="text-sm text-ink">{empty ? <span className="text-ink-4">{tr("notSet")}</span> : children}</div>
    </div>
  );
}

/** Real run steps (no simulated progress); on completion the owner enters NOVA. */
function FinishOverlay({ runId, onRetry }: { runId: string; onRetry: () => void }) {
  const t = useTranslations("onboarding.setup.finish");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const s = useSetup();
  const router = useRouter();
  const run = useRun(runId);
  const [skipping, startSkip] = useTransition();
  const partial = run?.steps.some((x) => x.status === "incomplete") ?? false;
  useEffect(() => {
    if (run?.status !== "COMPLETED") return;
    // A little longer when something was skipped, so the note can be read.
    const id = setTimeout(() => router.push("/home"), partial ? 2600 : 900);
    return () => clearTimeout(id);
  }, [run?.status, partial, router]);
  const skip = () =>
    startSkip(async () => {
      const r = await skipSetupAction();
      if (r.ok) router.push("/home");
    });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-setup-bg/95 px-4 backdrop-blur" role="dialog" aria-modal="true" aria-labelledby="finish-title">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-line bg-surface p-7 shadow-lg">
        <div className="space-y-2 text-center">
          <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-accent text-white shadow-[0_0_60px_var(--accent-glow)] motion-safe:animate-[nova-glow_2.4s_ease-in-out_infinite]">
            <Sparkles className="size-7" />
          </span>
          <h2 id="finish-title" className="pt-2 text-2xl font-bold tracking-tight text-ink">
            {run?.status === "COMPLETED" ? t("done") : t("title")}
          </h2>
          <p className="text-sm text-ink-3">{t("subtitle")}</p>
        </div>
        <RunSteps run={run} />
        {!s.aiConfigured && <p className="rounded-2xl bg-sunken px-4 py-3 text-xs text-ink-3">{t("noAi")}</p>}
        {partial && run?.status !== "FAILED" && <p className="rounded-2xl bg-warning-soft px-4 py-3 text-xs text-warning">{t("partial")}</p>}
        {run?.status === "FAILED" && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-danger">{te((run.error ?? "ai_failed") as "ai_failed")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={onRetry} disabled={skipping} className="inline-flex h-10 items-center rounded-2xl border border-line px-4 text-sm font-semibold">
                {tc("actions.retry")}
              </button>
              <button type="button" onClick={skip} disabled={skipping} data-testid="skip-setup" className="inline-flex h-10 items-center gap-2 rounded-2xl bg-ink px-4 text-sm font-semibold text-ink-inverse disabled:opacity-60">
                {skipping && <Loader2 className="size-4 animate-spin" />}
                {t("skip")}
              </button>
            </div>
            <p className="text-xs text-ink-3">{t("skipHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
