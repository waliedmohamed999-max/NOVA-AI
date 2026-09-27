"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, Check, CircleAlert, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { approveCampaignFromRun, approveRunContent, getRun, type RunDTO } from "@/features/command/actions";

/** Polls an agent run until it finishes. */
export function useRun(runId: string | null, intervalMs = 900) {
  const [run, setRun] = useState<RunDTO | null>(null);
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await getRun({ id: runId });
      if (!alive) return;
      if (res.ok) {
        setRun(res.data);
        if (res.data.status === "COMPLETED" || res.data.status === "FAILED" || res.data.status === "CANCELLED") return;
      }
      timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [runId, intervalMs]);
  return run;
}

/** High-level progress only — never model reasoning. */
export function RunSteps({ run, className }: { run: RunDTO | null; className?: string }) {
  const t = useTranslations("app.steps");
  const steps = run?.steps.filter((s) => s.status !== "skipped") ?? [];
  return (
    <ol className={cn("space-y-2.5", className)} aria-live="polite">
      {steps.map((s, i) => (
        <motion.li
          key={s.key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: s.status === "pending" ? 0.45 : 1, y: 0 }}
          transition={{ delay: i * 0.04, duration: 0.3 }}
          className="flex items-center gap-3 text-[15px]"
        >
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full border",
              s.status === "done" && "border-success/30 bg-success-soft text-success",
              s.status === "running" && "border-accent/30 bg-accent-soft text-accent",
              s.status === "failed" && "border-danger/30 bg-danger-soft text-danger",
              s.status === "pending" && "border-line bg-surface text-ink-4",
            )}
          >
            {s.status === "done" ? <Check className="size-3.5" strokeWidth={3} /> : s.status === "running" ? <Spinner className="size-3.5" /> : s.status === "failed" ? <CircleAlert className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}
          </span>
          <span className={cn(s.status === "running" ? "font-medium text-ink" : "text-ink-2")}>{t.has(s.key) ? t(s.key as "understanding_goal") : s.key}</span>
        </motion.li>
      ))}
    </ol>
  );
}

const STAT_KEYS = ["posts", "videos", "carousels", "days", "open", "value", "hot", "stalled", "score", "temperature"];

/** The actionable object produced by an agent: title, summary, numbers, items and buttons. */
export function RunResultCard({ run, onNavigate }: { run: RunDTO; onNavigate?: () => void }) {
  const t = useTranslations("app.result");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const r = run.result;
  if (!r) return null;

  const statLabel = (label: string) => {
    if (label.startsWith("format:")) return tc(`formats.${label.slice(7)}` as "formats.POST");
    return STAT_KEYS.includes(label) ? t(`stats.${label}` as "stats.posts") : label;
  };

  const doAction = (a: NonNullable<typeof r.actions>[number]) =>
    start(async () => {
      if (a.action === "approve_all_content") {
        const res = await approveRunContent({ runId: run.id });
        if (res.ok) toast(t("approvedCount", { count: res.data.approved }));
        else toast.error(t("actionFailed"));
      } else if (a.action === "approve_campaign" && a.entityId) {
        const res = await approveCampaignFromRun({ campaignId: a.entityId });
        if (res.ok) toast(t("campaignApproved"));
        else toast.error(t("actionFailed"));
      }
      router.refresh();
    });

  return (
    <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden rounded-3xl border border-line bg-surface shadow-md">
      <div className="relative border-b border-line px-6 pb-5 pt-6">
        <div className="absolute inset-0 ai-aura opacity-60" aria-hidden />
        <div className="relative space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">
              <Sparkles className="size-3" /> {t(`types.${r.type}` as "types.answer")}
            </Badge>
            {r.offline && <Badge tone="outline">{tc("aiOffline.badge")}</Badge>}
          </div>
          <h3 className="text-xl font-semibold tracking-tight text-balance">{r.title}</h3>
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-2 text-pretty">{r.summary}</p>
        </div>
      </div>

      {r.stats && r.stats.length > 0 && (
        <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
          {r.stats.map((s) => (
            <div key={s.label} className="bg-surface px-5 py-4">
              <dt className="text-xs text-ink-3">{statLabel(s.label)}</dt>
              <dd className="mt-1 text-2xl font-semibold tracking-tight tabular">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {r.items && r.items.length > 0 && (
        <ul className="divide-y divide-line">
          {r.items.slice(0, 8).map((item, i) => {
            const inner = (
              <>
                <div className="min-w-0 flex-1">
                  {item.subtitle && ["keyMessage", "audience", "cta", "creativeDirection"].includes(item.subtitle) ? (
                    <>
                      <div className="text-xs font-medium text-ink-3">{t(`fields.${item.subtitle}` as "fields.cta")}</div>
                      <div className="text-sm text-ink">{item.title}</div>
                    </>
                  ) : (
                    <>
                      <div className="truncate text-sm font-medium text-ink">{item.title}</div>
                      {item.subtitle && <div className="line-clamp-1 text-xs text-ink-3">{t.has(`dispositions.${item.subtitle}`) ? t(`dispositions.${item.subtitle}` as "dispositions.draft") : item.subtitle}</div>}
                    </>
                  )}
                </div>
                {item.badge && <Badge tone={item.badge === "HOT" ? "accent" : "neutral"}>{tc.has(`platforms.${item.badge}`) ? tc(`platforms.${item.badge}` as "platforms.X") : t.has(`badges.${item.badge}`) ? t(`badges.${item.badge}` as "badges.HOT") : item.badge}</Badge>}
                {item.href && <ArrowRight className="size-4 shrink-0 text-ink-4 flip-rtl" />}
              </>
            );
            return (
              <li key={i}>
                {item.href ? (
                  <Link href={item.href} onClick={onNavigate} className="flex items-center gap-3 px-6 py-3 transition hover:bg-surface-2">
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-6 py-3">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {r.actions && r.actions.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line bg-surface-2 px-6 py-4">
          {r.actions.map((a) =>
            a.href ? (
              <Link key={a.label} href={a.href} onClick={onNavigate} className={buttonClass(a.primary ? "primary" : "secondary", "sm")}>
                {t(`actions.${a.label}` as "actions.review")}
              </Link>
            ) : (
              <Button key={a.label} size="sm" variant={a.primary ? "primary" : "secondary"} loading={pending} onClick={() => doAction(a)}>
                {t(`actions.${a.label}` as "actions.review")}
              </Button>
            ),
          )}
        </div>
      )}
    </motion.div>
  );
}

/** Full progress → result experience for one run. */
export function RunView({ runId, onNavigate }: { runId: string; onNavigate?: () => void }) {
  const run = useRun(runId);
  const t = useTranslations("app");
  const te = useTranslations("errors");
  const done = run?.status === "COMPLETED";
  const failed = run?.status === "FAILED";
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (done) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [done]);
  return (
    <div className="space-y-5" ref={ref}>
      <AnimatePresence mode="wait">
        {!done && (
          <motion.div key="progress" exit={{ opacity: 0, y: -8 }} className="rounded-3xl border border-line bg-surface-2 p-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium text-ink-3">
              {failed ? <CircleAlert className="size-4 text-danger" /> : <Spinner className="size-4 text-accent" />}
              {failed ? te(run?.error as "ai_failed") : t("run.working")}
            </div>
            <RunSteps run={run} />
          </motion.div>
        )}
      </AnimatePresence>
      {done && run && <RunResultCard run={run} onNavigate={onNavigate} />}
    </div>
  );
}
