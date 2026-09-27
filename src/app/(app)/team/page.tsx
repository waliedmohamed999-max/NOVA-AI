import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowRight, Check } from "lucide-react";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { AgentMark } from "@/components/agents/agent-mark";
import { AGENT_BY_KEY } from "@/config/agents";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "AI Team" };

const TONE = { WORKING: "accent", WAITING_APPROVAL: "warning", MONITORING: "success", IDLE: "neutral", PAUSED: "neutral" } as const;

export default async function TeamPage() {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("app.team");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const agents = await ctx.db.agent.findMany({ orderBy: { createdAt: "asc" }, include: { tasks: { where: { status: "DONE" }, orderBy: { completedAt: "desc" }, take: 3 } } });

  const groups = [
    { key: "social", items: agents.filter((a) => AGENT_BY_KEY[a.key].team === "social") },
    { key: "sales", items: agents.filter((a) => AGENT_BY_KEY[a.key].team === "sales") },
  ] as const;

  return (
    <div className="space-y-10">
      <PageHeader title={t("title")} description={t("description")} />
      {groups.map((g) => (
        <section key={g.key} className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-3">{t(`groups.${g.key}`)}</h2>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {g.items.map((a) => (
              <li key={a.id}>
                <Link href={`/team/${a.key.toLowerCase()}`} className={cn("group flex h-full flex-col rounded-[26px] border border-line bg-surface p-6 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md", !a.enabled && "opacity-60")}>
                  <div className="flex items-start justify-between">
                    <AgentMark agent={a.key} size={48} working={a.status === "WORKING"} />
                    <span className="inline-flex items-center gap-2 text-xs font-medium text-ink-2">
                      <StatusDot tone={a.enabled ? TONE[a.status] : "neutral"} pulse={a.status === "WORKING"} />
                      {a.enabled ? tc(`agentStatus.${a.status}`) : t("notInPlan")}
                    </span>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight">{tc(`agents.${a.key}.name`)}</h3>
                  <p className="text-sm text-ink-3">{tc(`agents.${a.key}.role`)}</p>
                  <div className="mt-4 rounded-2xl bg-surface-2 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">{t("currentTask")}</div>
                    <div className="mt-0.5 truncate text-sm">{a.currentTask ?? t(`idleTask.${a.status}` as "idleTask.IDLE")}</div>
                  </div>
                  <div className="mt-4 flex-1 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">{t("recent")}</div>
                    {a.tasks.length ? (
                      a.tasks.map((task) => (
                        <div key={task.id} className="flex items-start gap-2 text-sm text-ink-2">
                          <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                          <span className="line-clamp-1 flex-1">{task.title}</span>
                          {task.completedAt && <span className="shrink-0 text-xs text-ink-4">{format.relativeTime(task.completedAt)}</span>}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-ink-4">{t("noTasks")}</p>
                    )}
                  </div>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink-3 group-hover:text-ink">
                    {t("open")} <ArrowRight className="size-4 flip-rtl" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-sm text-ink-3"><Badge tone="outline">{t("brainBadge")}</Badge> <span className="ms-2">{t("brainNote")}</span></p>
    </div>
  );
}
