import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, Check } from "lucide-react";
import type { AgentKey } from "@/generated/prisma/enums";
import { requireTenant } from "@/server/context";
import { Card } from "@/components/ui/card";
import { Badge, StatusDot } from "@/components/ui/badge";
import { AgentMark } from "@/components/agents/agent-mark";
import { AGENTS } from "@/config/agents";
import { currentPeriod } from "@/server/ai/budget";
import { AgentSettings } from "@/features/team/agent-settings";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage(props: PageProps<"/team/[key]">) {
  const { key } = await props.params;
  const agentKey = key.toUpperCase() as AgentKey;
  if (!AGENTS.some((a) => a.key === agentKey)) notFound();
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("app.team");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const agent = await ctx.db.agent.findFirst({ where: { key: agentKey } });
  if (!agent) notFound();
  const [tasks, runs, usage] = await Promise.all([
    ctx.db.agentTask.findMany({ where: { agentId: agent.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    ctx.db.agentRun.findMany({ where: { agentId: agent.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    ctx.db.aiUsage.findFirst({ where: { period: currentPeriod(), agentKey } }),
  ]);
  const settings = (agent.settings ?? {}) as { guidance?: string };

  return (
    <div className="space-y-6">
      <Link href="/team" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"><ArrowLeft className="size-4 flip-rtl" /> {tc("nav.team")}</Link>
      <header className="flex flex-wrap items-center gap-5">
        <AgentMark agent={agent.key} size={64} working={agent.status === "WORKING"} />
        <div className="space-y-1">
          <h1 className="text-[30px] font-semibold tracking-[-0.02em]">{tc(`agents.${agent.key}.name`)}</h1>
          <p className="text-ink-3">{tc(`agents.${agent.key}.role`)}</p>
        </div>
        <span className="ms-auto inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm">
          <StatusDot tone={agent.status === "WORKING" ? "accent" : agent.status === "WAITING_APPROVAL" ? "warning" : "success"} pulse={agent.status === "WORKING"} />
          {tc(`agentStatus.${agent.status}`)}
        </span>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold">{t("work")}</h2>
            {tasks.length === 0 ? (
              <p className="text-sm text-ink-3">{t("noTasks")}</p>
            ) : (
              <ol className="space-y-3">
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-3 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    <span className="flex-1">{task.title}</span>
                    <span className="text-xs text-ink-4">{format.relativeTime(task.completedAt ?? task.createdAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card className="p-6">
            <h2 className="mb-4 text-sm font-semibold">{t("runs")}</h2>
            <ul className="divide-y divide-line">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Badge tone={r.status === "COMPLETED" ? "success" : r.status === "FAILED" ? "danger" : "info"}>{t(`runStatus.${r.status}` as "runStatus.COMPLETED")}</Badge>
                  <span className="min-w-0 flex-1 truncate">{r.input ?? t(`kinds.${r.kind}` as "kinds.command")}</span>
                  <span className="text-xs text-ink-4">{format.relativeTime(r.createdAt)}</span>
                </li>
              ))}
              {runs.length === 0 && <li className="py-2 text-sm text-ink-3">{t("noRuns")}</li>}
            </ul>
          </Card>
        </div>
        <aside className="space-y-6">
          <Card className="space-y-2 p-5">
            <h2 className="text-sm font-semibold">{t("usage")}</h2>
            <p className="text-2xl font-semibold tabular">{usage?.requests ?? 0}</p>
            <p className="text-xs text-ink-3">{t("usageHint")}</p>
          </Card>
          <AgentSettings agentId={agent.id} enabled={agent.enabled} guidance={settings.guidance ?? ""} canConfigure={ctx.can("agents:configure")} />
        </aside>
      </div>
    </div>
  );
}
