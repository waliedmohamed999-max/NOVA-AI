"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Building2, Link2, Check, CheckCircle2, ChevronDown, Circle, FileText, Globe, Loader2, Tag, Target, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/brand/logo";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { NotificationBell } from "@/components/shell/notification-bell";
import { UserMenu } from "@/components/shell/user-menu";
import { Dialog, DialogTrigger, SheetContent } from "@/components/ui/dialog";
import { SETUP_STEPS, type SetupStep } from "@/lib/onboarding-setup";
import { useSetup } from "./state";
import { PartnerCard, ProgressRing } from "./visuals";

export const STEP_ICONS: Record<SetupStep, typeof Building2> = { business: Building2, audience: Users, brand: Tag, goals: Target, channels: Link2, review: FileText };

/** A step is reachable once every step before it has its required answers. */
export function useStepStatus() {
  const s = useSetup();
  const completed = s.answers.setup?.completed ?? [];
  return (step: SetupStep) => {
    const i = SETUP_STEPS.indexOf(step);
    const reachable = SETUP_STEPS.slice(0, i).every((p) => s.ready(p));
    const state: "done" | "active" | "upcoming" = step === s.step ? "active" : completed.includes(step) && s.ready(step) ? "done" : "upcoming";
    return { state, reachable: reachable && s.hasOrg };
  };
}

export function TopBar({ user, unread }: { user: { name: string | null; email: string; isPlatformAdmin: boolean }; unread: number | null }) {
  const t = useTranslations("onboarding.setup");
  const s = useSetup();
  const n = SETUP_STEPS.indexOf(s.step) + 1;
  return (
    <header className="sticky top-0 z-30 border-b border-nova-line/80 bg-surface/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Logo />
        <div className="mx-auto hidden w-full max-w-md items-center gap-3 md:flex">
          <span className="shrink-0 text-xs font-semibold text-ink-3">{t("stepOf", { n, total: SETUP_STEPS.length })}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.progress.percent} aria-label={t("stepOf", { n, total: SETUP_STEPS.length })}>
            <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent),var(--nova-blue))] transition-[width] duration-700 ease-out" style={{ width: `${s.progress.percent}%` }} />
          </div>
          <span className="w-10 shrink-0 text-end text-xs font-bold text-ink" dir="ltr">
            {s.progress.percent}%
          </span>
        </div>
        <div className="ms-auto flex items-center gap-1.5 sm:gap-2.5 md:ms-0">
          <MobileProgress />
          <LocaleSwitch compact />
          {unread !== null && <NotificationBell unread={unread} />}
          <span className="hidden text-sm font-semibold text-ink lg:inline">{(user.name ?? user.email).split(/\s+/)[0]}</span>
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}

function MobileProgress() {
  const t = useTranslations("onboarding.setup");
  const s = useSetup();
  return (
    <Dialog>
      <DialogTrigger className="inline-flex h-9 items-center gap-1.5 rounded-full border border-nova-line bg-surface px-3 text-xs font-bold text-ink shadow-xs xl:hidden" aria-label={t("openProgress")}>
        <span dir="ltr">{s.progress.percent}%</span>
        <ChevronDown className="size-3.5 text-ink-3" />
      </DialogTrigger>
      <SheetContent title={t("sidebar.title")}>
        <SidebarBody compact />
      </SheetContent>
    </Dialog>
  );
}

export function Stepper() {
  const t = useTranslations("onboarding.setup");
  const s = useSetup();
  const status = useStepStatus();
  const list = useRef<HTMLOListElement>(null);
  // On narrow screens the stepper scrolls sideways: keep the current step in view.
  useEffect(() => {
    const ol = list.current;
    const el = ol?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!ol || !el || ol.scrollWidth <= ol.clientWidth) return;
    const box = ol.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    ol.scrollBy({ left: r.left + r.width / 2 - (box.left + box.width / 2), behavior: "smooth" });
  }, [s.step]);
  return (
    <nav aria-label={t("sidebar.title")} className="rounded-[20px] border border-nova-line bg-surface px-3 py-5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] sm:px-6">
      <ol ref={list} className="-mx-1 flex snap-x items-start overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {SETUP_STEPS.map((step, i) => {
          const { state, reachable } = status(step);
          const Icon = STEP_ICONS[step];
          return (
            <li key={step} className="relative flex min-w-[88px] flex-1 snap-start flex-col items-center">
              {i > 0 && <span className={cn("absolute top-6 h-0.5 rounded-full", SETUP_STEPS.indexOf(s.step) >= i ? "bg-nova-blue/40" : "bg-nova-line")} style={{ insetInlineStart: "calc(-50% + 32px)", insetInlineEnd: "calc(50% + 32px)" }} aria-hidden />}
              <button
                type="button"
                disabled={!reachable}
                onClick={() => void s.goTo(step)}
                aria-current={state === "active" ? "step" : undefined}
                className="group flex flex-col items-center gap-2 rounded-2xl px-1 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-nova-blue disabled:cursor-default"
              >
                <span
                  className={cn(
                    "relative z-10 flex size-12 items-center justify-center rounded-full border-2 bg-surface transition",
                    state === "active" && "border-accent text-accent shadow-[0_0_0_6px_var(--accent-soft)]",
                    state === "done" && "border-success bg-success text-white",
                    state === "upcoming" && "border-nova-line text-ink-3 group-enabled:group-hover:border-nova-blue-line",
                  )}
                >
                  {state === "done" ? <Check className="size-5" strokeWidth={3} /> : <Icon className="size-5" />}
                </span>
                <span className={cn("flex size-6 items-center justify-center rounded-full text-[11px] font-bold", state === "active" ? "bg-accent text-white" : "bg-sunken text-ink-3")}>{i + 1}</span>
                <span className={cn("whitespace-nowrap text-[13px] font-semibold sm:text-sm", state === "active" ? "text-ink" : "text-ink-3")}>{t(`steps.${step}.label`)}</span>
                <span className="sr-only">{t(`state.${state}`)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

type TaskState = "done" | "working" | "pending" | "skipped" | "failed";

function useTasks(): { key: "website" | "profile" | "strategy"; Icon: typeof Globe; state: TaskState }[] {
  const s = useSetup();
  const site: TaskState =
    s.site.phase === "applied" || s.websiteSource === "READY"
      ? "done"
      : s.site.phase === "running" || s.site.phase === "review" || s.websiteSource === "PROCESSING" || s.websiteSource === "PENDING"
        ? "working"
        : s.site.phase === "failed"
          ? "failed"
          : s.answers.noWebsite
            ? "skipped"
            : "pending";
  const businessStarted = Boolean(s.companyName.trim() || s.answers.businessType || s.answers.industry);
  const profile: TaskState = s.ready("business") && s.ready("audience") ? "done" : businessStarted ? "working" : "pending";
  const strategy: TaskState = s.strategy ? "done" : "pending";
  return [
    { key: "website", Icon: Globe, state: site },
    { key: "profile", Icon: FileText, state: profile },
    { key: "strategy", Icon: Target, state: strategy },
  ];
}

function TaskIcon({ state }: { state: TaskState }) {
  if (state === "done") return <CheckCircle2 className="size-5 text-success" />;
  if (state === "working") return <Loader2 className="size-5 animate-spin text-nova-blue" />;
  if (state === "failed") return <AlertCircle className="size-5 text-warning" />;
  return <Circle className="size-5 text-line-strong" strokeDasharray="3 3" />;
}

export function SidebarBody({ compact }: { compact?: boolean }) {
  const t = useTranslations("onboarding.setup");
  const s = useSetup();
  const status = useStepStatus();
  const tasks = useTasks();
  return (
    <div className="space-y-4">
      <div className={cn("flex items-center gap-4", compact ? "" : "px-6 pt-6")}>
        <ProgressRing value={s.progress.percent} label={t("sidebar.title")} />
        <div className="space-y-1">
          <p className="text-lg font-bold text-ink">{t("sidebar.title")}</p>
          <p className="text-sm text-ink-3">{t("sidebar.done", { done: s.progress.doneSteps, total: SETUP_STEPS.length })}</p>
        </div>
      </div>
      <ol className={cn("space-y-1.5", compact ? "" : "px-4")}>
        {SETUP_STEPS.map((step, i) => {
          const { state, reachable } = status(step);
          return (
            <li key={step}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => void s.goTo(step)}
                aria-current={state === "active" ? "step" : undefined}
                className={cn("flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start transition focus-visible:outline-2 focus-visible:outline-nova-blue", state === "active" ? "bg-nova-blue-soft ring-1 ring-nova-blue-line" : "enabled:hover:bg-sunken")}
              >
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold", state === "active" ? "bg-nova-blue text-white" : state === "done" ? "bg-success-soft text-success" : "bg-sunken text-ink-3")}>{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm font-semibold", state === "active" ? "text-nova-blue" : "text-ink")}>{t(`steps.${step}.title`)}</span>
                  <span className="block truncate text-xs text-ink-3">{t(`steps.${step}.desc`)}</span>
                </span>
                {state === "done" ? <CheckCircle2 className="size-5 shrink-0 text-success" /> : <Circle className={cn("size-5 shrink-0", state === "active" ? "text-nova-blue" : "text-line-strong")} />}
                <span className="sr-only">{t(`state.${state}`)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className={cn("space-y-3 rounded-3xl border border-nova-line p-4", compact ? "" : "mx-4 mb-4")}>
        <p className="text-sm font-bold text-ink">{t("sidebar.willDo")}</p>
        <ul className="space-y-3">
          {tasks.map(({ key, Icon, state }) => (
            <li key={key} className="flex items-center gap-3" data-testid={`task-${key}`} data-state={state}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-nova-blue-soft text-nova-blue">
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">{t(`sidebar.tasks.${key}.title`)}</span>
                <span className="block text-xs text-ink-3">{t(`sidebar.taskState.${state}`)}</span>
              </span>
              <TaskIcon state={state} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden xl:block">
      <div className="sticky top-[88px] overflow-hidden rounded-[20px] border border-nova-line bg-surface shadow-[0_1px_2px_rgb(15_23_42/0.04),0_18px_50px_-24px_rgb(15_23_42/0.18)]">
        <PartnerCard />
        <SidebarBody />
      </div>
    </aside>
  );
}

