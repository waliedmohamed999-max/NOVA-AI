import type { Metadata } from "next";
import { getFormatter } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { aiAvailability } from "@/server/ai";
import {
  deskSummary,
  DESK_VIEWS,
  FOLLOWUP_TABS,
  loadActivity,
  loadB2B,
  loadConversations,
  loadCustomers,
  loadFollowUps,
  loadForecast,
  loadFunnel,
  loadHotLeads,
  loadInsights,
  loadPipeline,
  loadQuotes,
  parseFilters,
  resolveSearch,
  teamMembers,
  type DeskView,
  type FollowUpTab,
} from "@/server/sales/desk";
import { SalesDesk } from "@/features/sales/desk/shell";
import { PipelineBoard } from "@/features/sales/desk/pipeline";
import { FollowUpCenter, FollowUpList } from "@/features/sales/desk/followups";
import { Section } from "@/features/sales/desk/shared";
import { ActivityFeed, B2BList, Conversations, Customers, DueBatch, ForecastPanel, Funnel, GettingStarted, HotLeads, Insights, MorningBrief, OpportunityLog, Quotes } from "@/features/sales/desk/views";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = { title: "Sales Desk" };

/**
 * Sales Desk: one workspace for customers and sales (/leads redirects here). Each view loads only its own
 * data; every number comes from the database.
 */
export default async function SalesPage(props: PageProps<"/sales">) {
  const ctx = await requireTenant({ permission: "leads:read" });
  const sp = await props.searchParams;
  const view = (DESK_VIEWS as readonly string[]).includes(String(sp.view)) ? (sp.view as DeskView) : "overview";
  const filters = await resolveSearch(ctx, parseFilters(sp));
  const page = Math.max(1, Math.min(500, Number(sp.page) || 1));
  const t = await getTranslations("sales");
  const format = await getFormatter();

  const [summary, members, stageRows, sourceRows] = await Promise.all([
    deskSummary(ctx, filters),
    teamMembers(ctx),
    ctx.db.pipelineStage.findMany({ orderBy: { position: "asc" }, select: { stage: true, label: true } }),
    ctx.db.lead.groupBy({ by: ["source"], where: { source: { not: null } }, _count: true, orderBy: { _count: { source: "desc" } }, take: 12 }),
  ]);
  const forecastForKpi = summary.gettingStarted.show ? null : await loadForecast(ctx, filters);
  const pipelineValue = forecastForKpi?.pipeline ? format.number(forecastForKpi.pipeline.cents / 100, { style: "currency", currency: forecastForKpi.pipeline.currency, maximumFractionDigits: 0, notation: "compact" }) : "—";
  const aiReady = aiAvailability().configured;

  let body: React.ReactNode = null;
  if (summary.gettingStarted.show) {
    body = <GettingStarted steps={summary.gettingStarted.steps} />;
  } else if (view === "overview") {
    const [funnel, hot, followups, insights, activity] = await Promise.all([
      loadFunnel(ctx, filters),
      loadHotLeads(ctx, filters, 6),
      loadFollowUps(ctx, filters, summary.kpis.overdue ? "overdue" : "today", 1),
      loadInsights(ctx, filters),
      loadActivity(ctx, filters, 1),
    ]);
    body = (
      <div className="space-y-10">
        {summary.brief.show && <MorningBrief brief={summary.brief} />}
        <Funnel rows={funnel.rows} total={funnel.total} />
        <HotLeads leads={hot} />
        <Section n="03" id="followups" eyebrow={t("followups.eyebrow")} title={t("followups.title")}>
          <FollowUpList items={followups.items.slice(0, 5)} />
        </Section>
        <Insights items={insights} />
        <DueBatch count={followups.counts.today + followups.counts.overdue} />
        <ActivityFeed items={activity.items.slice(0, 8)} page={1} hasMore={false} compact />
      </div>
    );
  } else if (view === "pipeline") {
    const [pipe, funnel] = await Promise.all([loadPipeline(ctx, filters), loadFunnel(ctx, filters)]);
    body = (
      <div className="space-y-10">
        <Section n="02" id="pipeline" title={t("pipeline.title")} description={t("pipeline.description")}>
          <PipelineBoard columns={pipe.columns} />
        </Section>
        <Funnel rows={funnel.rows} total={funnel.total} />
      </div>
    );
  } else if (view === "hot") {
    const [hot, insights] = await Promise.all([loadHotLeads(ctx, filters, 12), loadInsights(ctx, filters)]);
    body = (
      <div className="space-y-10">
        <HotLeads leads={hot} n="" />
        <Insights items={insights} />
      </div>
    );
  } else if (view === "followups") {
    const tab = (FOLLOWUP_TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as FollowUpTab) : "today";
    const f = await loadFollowUps(ctx, filters, tab, page);
    body = (
      <div className="space-y-10">
        <Section id="followups" eyebrow={t("followups.eyebrow")} title={t("followups.title")}>
          <FollowUpCenter tab={tab} counts={f.counts} items={f.items} page={page} pageSize={f.pageSize} />
        </Section>
        <DueBatch count={f.counts.today + f.counts.overdue} />
      </div>
    );
  } else if (view === "conversations") {
    const c = await loadConversations(ctx, filters, page);
    body = <Conversations items={c.items} page={page} pageSize={c.pageSize} />;
  } else if (view === "b2b") {
    body = <B2BList items={await loadB2B(ctx, filters)} />;
  } else if (view === "quotes") {
    body = <Quotes items={await loadQuotes(ctx)} />;
  } else if (view === "forecast") {
    const [f, insights] = await Promise.all([forecastForKpi ?? loadForecast(ctx, filters), loadInsights(ctx, filters)]);
    body = (
      <div className="space-y-10">
        <ForecastPanel f={f} />
        <Insights items={insights} />
      </div>
    );
  } else if (view === "activity") {
    const [a, log] = await Promise.all([loadActivity(ctx, filters, page), loadActivity(ctx, filters, page, true)]);
    body = (
      <div className="space-y-10">
        <ActivityFeed items={a.items} page={page} hasMore={a.hasMore} />
        <OpportunityLog items={log.items} page={page} hasMore={log.hasMore} />
      </div>
    );
  } else if (view === "customers") {
    const c = await loadCustomers(ctx, filters, page);
    body = <Customers items={c.items} total={c.total} page={page} pageSize={c.pageSize} />;
  }

  return (
    <SalesDesk
      summary={summary}
      view={view}
      filters={filters}
      pipelineValue={pipelineValue}
      members={members}
      stages={stageRows}
      sources={sourceRows.map((s) => s.source!).filter(Boolean)}
      canManage={ctx.can("leads:manage")}
      aiReady={aiReady}
    >
      {body}
    </SalesDesk>
  );
}
