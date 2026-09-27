import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { Card, PageHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/misc";
import { LeadBoard } from "@/features/sales/board";
import { loadLeadCards, stageLabels } from "@/server/sales/queries";
import { FollowUpList } from "@/features/sales/followups";

export const metadata: Metadata = { title: "Sales" };

export default async function SalesPage() {
  const ctx = await requireTenant({ permission: "leads:read" });
  const t = await getTranslations("leads.sales");
  const format = await getFormatter();
  const [leads, labels, stages, followUps] = await Promise.all([
    loadLeadCards(ctx),
    stageLabels(ctx),
    ctx.db.pipelineStage.findMany(),
    ctx.db.salesActivity.findMany({ where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 12, include: { lead: { select: { id: true, name: true, company: true } } } }),
  ]);
  const prob = Object.fromEntries(stages.map((s) => [s.stage, s.probability]));
  const open = leads.filter((l) => !["WON", "LOST"].includes(l.stage));
  const currency = leads[0]?.currency ?? "USD";
  const money = (c: number) => format.number(c / 100, { style: "currency", currency, maximumFractionDigits: 0 });
  const pipelineValue = open.reduce((a, l) => a + (l.valueCents ?? 0), 0);
  const weighted = open.reduce((a, l) => a + ((l.valueCents ?? 0) * (prob[l.stage] ?? 0)) / 100, 0);
  const won = leads.filter((l) => l.stage === "WON");
  const closed = leads.filter((l) => ["WON", "LOST"].includes(l.stage)).length;

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <Card className="grid grid-cols-2 gap-6 p-6 lg:grid-cols-4">
        <Stat label={t("pipeline")} value={money(pipelineValue)} hint={t("openDeals", { count: open.length })} />
        <Stat label={t("weighted")} value={money(weighted)} hint={t("weightedHint")} />
        <Stat label={t("won")} value={money(won.reduce((a, l) => a + (l.valueCents ?? 0), 0))} hint={t("wonDeals", { count: won.length })} />
        <Stat label={t("winRate")} value={closed ? `${Math.round((won.length / closed) * 100)}%` : "—"} />
      </Card>
      <LeadBoard leads={leads} stageLabels={labels} mode="board" canManage={ctx.can("leads:manage")} pipeline />
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("followUps")}</h2>
          <Link href="/leads" className="text-xs font-medium text-ink-3 hover:text-ink">{t("allLeads")}</Link>
        </div>
        <FollowUpList items={followUps.map((f) => ({ id: f.id, title: f.title, type: f.type, dueAt: f.dueAt?.toISOString() ?? null, lead: f.lead, byAgent: Boolean(f.createdByAgent) }))} />
      </section>
    </div>
  );
}
