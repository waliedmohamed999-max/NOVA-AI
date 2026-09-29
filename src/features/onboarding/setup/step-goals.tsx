"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Award, Globe2, Loader2, MousePointerClick, PenLine, Repeat, Sparkles, Target, TrendingUp, UserPlus } from "lucide-react";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import { CHANNELS, CHANNEL_LABELS, CONTENT_STYLES, GOALS, TONES, label, type Goal } from "@/lib/onboarding-setup";
import { useSetup } from "./state";
import { StepFooter } from "./footer";
import { ChoiceCard, GroupLabel, Pill, QuestionRow, StatusChip, StepCard, inputClass } from "./ui";

const GOAL_ICONS: Record<Goal, typeof TrendingUp> = { sales: TrendingUp, leads: UserPlus, brand: Award, traffic: MousePointerClick, content: PenLine, followup: Repeat, expand: Globe2 };

export function GoalsStep() {
  const t = useTranslations("onboarding.setup");
  const tg = useTranslations("onboarding.setup.goals");
  const s = useSetup();
  const a = s.answers;
  const ids = { g90: useId(), focus: useId() };
  const toggle = <T extends string>(list: T[] | undefined, v: T) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);

  return (
    <StepCard icon={<Target />} title={tg("title")} subtitle={tg("subtitle")} footer={<StepFooter step="goals" />}>
      <div className="space-y-4">
        <GroupLabel hint={tg("goals.hint")}>{tg("goals.q")}</GroupLabel>
        <div role="group" aria-label={tg("goals.q")} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {(Object.keys(GOALS) as Goal[]).map((k) => {
            const Icon = GOAL_ICONS[k];
            return <ChoiceCard key={k} role="checkbox" selected={Boolean(a.goalKeys?.includes(k))} onClick={() => s.update("goals", { goals: toggle(a.goalKeys, k) }, { immediate: true })} icon={<Icon />} title={label(GOALS[k], s.lang)} />;
          })}
        </div>
      </div>

      <div className="space-y-5 rounded-3xl border border-nova-line p-4 sm:p-6">
        <QuestionRow label={tg("goal90.q")} hint={t("optional")} done={Boolean(a.goal90?.trim())} htmlFor={ids.g90}>
          <input id={ids.g90} value={a.goal90 ?? ""} onChange={(e) => s.update("goals", { goal90: e.target.value.slice(0, 300) })} placeholder={tg("goal90.placeholder")} className={inputClass} />
        </QuestionRow>
        <QuestionRow label={tg("channels.q")} hint={t("optional")} done={Boolean(a.channels?.length)}>
          <div className="flex flex-wrap gap-2" role="group" aria-label={tg("channels.q")}>
            {CHANNELS.map((c) => (
              <Pill key={c} selected={Boolean(a.channels?.includes(c))} onClick={() => s.update("goals", { channels: toggle(a.channels, c) }, { immediate: true })}>
                {label(CHANNEL_LABELS[c], s.lang)}
              </Pill>
            ))}
          </div>
        </QuestionRow>
        {(a.offerings?.length ?? 0) > 0 && (
          <QuestionRow label={tg("focus.q")} hint={t("optional")} done={Boolean(a.focusOffering)} htmlFor={ids.focus}>
            <select id={ids.focus} value={a.focusOffering ?? ""} onChange={(e) => s.update("goals", { focusOffering: e.target.value }, { immediate: true })} className={cn(inputClass, "appearance-none")}>
              <option value="">{tg("focus.none")}</option>
              {a.offerings!.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </QuestionRow>
        )}
      </div>

      <StrategyPreviewPanel />
    </StepCard>
  );
}

/** NOVA's first proposal: a DRAFT strategy in the brain, rebuilt on demand, never approved automatically. */
function StrategyPreviewPanel() {
  const t = useTranslations("onboarding.setup.goals.strategy");
  const te = useTranslations("errors");
  const s = useSetup();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const p = s.strategy;
  const a = s.answers;
  const contentDirection = p?.positioning || [a.brand?.tones?.map((k) => label(TONES[k], s.lang)).join("، "), a.brand?.contentStyles?.map((k) => label(CONTENT_STYLES[k], s.lang)).join("، ")].filter(Boolean).join(" · ");

  const build = () =>
    start(async () => {
      setError(null);
      const r = await s.buildStrategy();
      if (!r.ok) setError(r.error ?? "unexpected");
    });

  return (
    <section className="space-y-4 overflow-hidden rounded-3xl border border-nova-blue-line bg-[linear-gradient(160deg,var(--surface)_0%,var(--nova-blue-soft)_120%)] p-4 sm:p-6" aria-live="polite" data-testid="strategy-preview">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-nova-blue text-white">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-ink">{t("title")}</h3>
          {p && <p className="text-xs text-ink-3">{p.generatedBy === "ai" ? t("byAi") : t("byTemplate")}</p>}
        </div>
        <button type="button" onClick={build} disabled={pending || !s.ready("goals")} data-testid="build-strategy" className="inline-flex h-10 items-center gap-2 rounded-2xl bg-ink px-4 text-sm font-semibold text-ink-inverse transition hover:-translate-y-0.5 disabled:opacity-40">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4 text-accent" />}
          {pending ? t("building") : p ? t("rebuild") : t("build")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {te(error as "unexpected")}
        </p>
      )}
      {p && (
        <>
          <div className="flex flex-wrap gap-2">
            <StatusChip tone="info">{t("draft")}</StatusChip>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Item title={t("target")} value={p.target} empty={t("empty")} />
            <Item title={t("channels")} value={p.channels.join(" · ")} empty={t("empty")} />
            <Item title={t("content")} value={contentDirection} empty={t("empty")} />
            <Item title={t("sales")} value={p.objective} empty={t("empty")} />
            <Item title={t("next")} value={p.initiatives.length ? p.initiatives : null} empty={t("empty")} wide />
          </dl>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void s.goTo("review", "goals")} disabled={!s.ready("goals")} className="inline-flex h-10 items-center rounded-2xl bg-nova-blue px-4 text-sm font-semibold text-white disabled:opacity-40">
              {t("review")}
            </button>
            <button type="button" onClick={() => toast(t("laterDone"))} className="inline-flex h-10 items-center rounded-2xl border border-nova-line bg-surface px-4 text-sm font-semibold text-ink">
              {t("later")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Item({ title, value, empty, wide }: { title: string; value: string | string[] | null | undefined; empty: string; wide?: boolean }) {
  const has = Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
  return (
    <div className={cn("rounded-2xl border border-nova-line bg-surface/80 p-3.5", wide && "sm:col-span-2")}>
      <dt className="text-xs font-bold uppercase tracking-wide text-ink-3">{title}</dt>
      <dd className={cn("mt-1 text-sm", has ? "text-ink" : "text-ink-4")}>
        {!has ? empty : Array.isArray(value) ? (
          <ul className="list-inside list-disc space-y-0.5">
            {value.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
