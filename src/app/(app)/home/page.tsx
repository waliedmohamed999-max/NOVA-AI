import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowRight, CalendarClock, CheckCheck, Flame, Lightbulb, Plug, Sparkles, TimerReset, TrendingDown, TrendingUp, AlertTriangle, Brain, CalendarCheck } from "lucide-react";
import { requireTenant } from "@/server/context";
import { loadHome, type PriorityItem } from "@/server/home";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/badge";
import { AgentMark } from "@/components/agents/agent-mark";
import { cn } from "@/lib/cn";
import { QuickActions, RefreshBriefButton } from "@/features/home/home-client";

export const metadata: Metadata = { title: "Home" };

const ICON: Record<PriorityItem["key"], typeof Sparkles> = {
  approvals: CheckCheck,
  followups: TimerReset,
  hot_leads: Flame,
  performance: TrendingUp,
  opportunity: Lightbulb,
  meetings: CalendarCheck,
  integrations: Plug,
  failed_publishing: AlertTriangle,
  setup_knowledge: Brain,
  connect_accounts: Plug,
};

const TONE: Record<PriorityItem["tone"], string> = {
  accent: "bg-accent-soft text-accent-ink",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-sunken text-ink-2",
};

const STATUS_TONE = { WORKING: "accent", WAITING_APPROVAL: "warning", MONITORING: "success", IDLE: "neutral", PAUSED: "neutral" } as const;

export default async function HomePage() {
  const ctx = await requireTenant();
  const t = await getTranslations("app.home");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const home = await loadHome(ctx);
  const first = (ctx.user.name ?? ctx.user.email.split("@")[0]).split(" ")[0];

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-8">
        {/* Greeting */}
        <section className="animate-fade-up space-y-2 pt-2">
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[42px]">{tc(`greeting.${home.period}` as "greeting.morning", { name: first })}</h1>
          <p className="text-lg text-ink-3">{home.actionable ? t("readyCount", { count: home.actionable }) : t("allClear")}</p>
        </section>

        {/* Priority feed */}
        <section aria-labelledby="priority" className="space-y-3">
          <h2 id="priority" className="sr-only">
            {t("priorityTitle")}
          </h2>
          {home.items.length === 0 ? (
            <Card className="p-6 text-ink-3">{t("nothingUrgent")}</Card>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {home.items.map((item, i) => {
                const Icon = item.key === "performance" && (item.value ?? 0) < 0 ? TrendingDown : ICON[item.key];
                return (
                  <li key={item.key} className="animate-fade-up" style={{ animationDelay: `${60 + i * 50}ms` }}>
                    <Link href={item.href} className="group flex h-full items-start gap-4 rounded-[22px] border border-line bg-surface p-5 shadow-xs transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md">
                      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", TONE[item.tone])}>
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="block font-semibold leading-snug text-ink">
                          {item.key === "performance"
                            ? t(`priority.${(item.value ?? 0) >= 0 ? "performance_up" : "performance_down"}`, { value: Math.abs(Math.round((item.value ?? 0) * 100)) })
                            : item.key === "opportunity"
                              ? t("priority.opportunity")
                              : t(`priority.${item.key}` as "priority.approvals", { count: item.count ?? 0 })}
                        </span>
                        <span className="line-clamp-2 block text-sm text-ink-3">{item.title ?? t(`priorityHint.${item.key}` as "priorityHint.approvals")}</span>
                      </span>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-ink flip-rtl" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Daily brief */}
        <section aria-labelledby="brief">
          <Card className="relative overflow-hidden p-6 sm:p-8">
            <div className="pointer-events-none absolute inset-0 ai-aura opacity-70" aria-hidden />
            <div className="relative space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 id="brief" className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-ink-3">
                  <Sparkles className="size-4 text-accent" /> {t("briefTitle")}
                </h2>
                <RefreshBriefButton />
              </div>
              <p className="max-w-3xl font-display text-[24px] leading-[1.4] text-ink text-pretty sm:text-[28px]">
                {home.brief?.narrative ?? t("briefEmpty")}
              </p>
              {home.brief && (
                <p className="text-xs text-ink-4">
                  {t("briefGenerated", { time: format.relativeTime(home.brief.createdAt) })}
                  {home.brief.generatedBy.includes("offline") && ` · ${tc("aiOffline.badge")}`}
                </p>
              )}
            </div>
          </Card>
        </section>

        {/* Quick actions */}
        <section aria-labelledby="quick" className="space-y-3">
          <h2 id="quick" className="text-sm font-semibold text-ink-2">
            {t("quickTitle")}
          </h2>
          <QuickActions />
        </section>
      </div>

      {/* Context panel */}
      <aside className="space-y-6">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("teamTitle")}</h2>
            <Link href="/team" className="text-xs font-medium text-ink-3 hover:text-ink">
              {tc("actions.viewAll")}
            </Link>
          </div>
          <ul className="space-y-3.5">
            {home.agents.map((a) => (
              <li key={a.id} className="flex items-center gap-3">
                <AgentMark agent={a.key} size={34} working={a.status === "WORKING"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{tc(`agents.${a.key}.name`)}</div>
                  <div className="truncate text-xs text-ink-3">{a.currentTask ?? tc(`agentStatus.${a.status}`)}</div>
                </div>
                <StatusDot tone={a.enabled ? STATUS_TONE[a.status] : "neutral"} pulse={a.status === "WORKING"} />
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("upcomingTitle")}</h2>
            <Link href="/calendar" className="text-xs font-medium text-ink-3 hover:text-ink">
              {tc("nav.calendar")}
            </Link>
          </div>
          {home.data.upcomingPosts.length === 0 ? (
            <p className="text-sm text-ink-3">{t("upcomingEmpty")}</p>
          ) : (
            <ul className="space-y-3">
              {home.data.upcomingPosts.map((p) => (
                <li key={p.id}>
                  <Link href={`/content/${p.id}`} className="flex items-center gap-3 rounded-xl p-1 -m-1 hover:bg-sunken">
                    <span className="flex size-9 shrink-0 flex-col items-center justify-center rounded-xl bg-sunken text-[10px] font-semibold leading-tight text-ink-2">
                      <CalendarClock className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.title}</span>
                      <span className="block text-xs text-ink-3">
                        {tc(`platforms.${p.platform}` as "platforms.INSTAGRAM")} · {format.dateTime(new Date(p.scheduledAt), { weekday: "short", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {home.data.hotLeads.length > 0 && (
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold">{t("hotLeadsTitle")}</h2>
            <ul className="space-y-3">
              {home.data.hotLeads.map((l) => (
                <li key={l.id}>
                  <Link href={`/leads/${l.id}`} className="flex items-start gap-3 rounded-xl p-1 -m-1 hover:bg-sunken">
                    <Flame className="mt-0.5 size-4 shrink-0 text-accent" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {l.name}
                        {l.company && <span className="font-normal text-ink-3"> · {l.company}</span>}
                      </span>
                      {l.nextAction && <span className="block truncate text-xs text-ink-3">{l.nextAction}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </aside>
    </div>
  );
}
