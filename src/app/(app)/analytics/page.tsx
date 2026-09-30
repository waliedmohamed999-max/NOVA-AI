import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { BarChart3, Lightbulb, Plug, TrendingDown, TrendingUp } from "lucide-react";
import { requireTenant } from "@/server/context";
import { loadAnalytics } from "@/server/analytics/overview";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { AnalyticsCharts } from "@/features/analytics/charts";
import { AttributionCard } from "@/features/analytics/attribution-card";
import { attributionReport } from "@/server/analytics/attribution";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const ctx = await requireTenant({ permission: "analytics:read" });
  const t = await getTranslations("analytics");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const a = await loadAnalytics(ctx);
  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
  const delta = (v: number | null) => (v == null ? null : { value: `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`, positive: v >= 0 });
  const stageLabel = await ctx.db.pipelineStage.findMany();
  const attribution = await attributionReport({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });

  if (!a.hasData) {
    return (
      <>
        <PageHeader title={t("title")} description={t("description")} />
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2">
          <EmptyState
            icon={<BarChart3 />}
            title={t("empty.title")}
            description={t("empty.body")}
            action={
              a.connected > 0 ? (
                <Link href="/content" className={buttonClass("primary", "md")}>{t("empty.ctaContent")}</Link>
              ) : (
                <Link href="/settings/connected-accounts" className={buttonClass("primary", "md")}><Plug className="size-4" /> {t("empty.cta")}</Link>
              )
            }
          />
        </div>
        {attribution.totals.leads > 0 && <div className="mt-8"><AttributionCard report={attribution} /></div>}
      </>
    );
  }

  const ec = delta(a.content.engagementChange);
  const lc = delta(a.leads.change);

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} actions={a.demo ? <Badge tone="accent">{tc("demo.badge")}</Badge> : undefined} />

      {/* Q1: Is our content improving? */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-ink-3">{t("q.improving")}</h2>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-4xl font-semibold tracking-tight tabular">{pct(a.content.engagement)}</span>
            {ec && (
              <span className={cn("inline-flex items-center gap-1 text-sm font-semibold", ec.positive ? "text-success" : "text-danger")}>
                {ec.positive ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />} {ec.value}
              </span>
            )}
          </div>
          <p className="text-sm text-ink-3">{t("engagementHint", { posts: a.content.posts })}</p>
          <div className="mt-6">
            <AnalyticsCharts kind="trend" data={a.trend.map((w) => ({ x: w.end.toISOString(), label: format.dateTime(w.end, { month: "short", day: "numeric" }), y: w.value }))} label={t("q.improving")} />
          </div>
        </Card>
        <Card className="space-y-5 p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-3"><Lightbulb className="size-4 text-accent" /> {t("q.attention")}</h2>
          {a.insights.length ? (
            <ul className="space-y-4">
              {a.insights.map((i) => (
                <li key={i.id} className="text-[15px] leading-snug">
                  {i.title}
                  <div className="mt-1 text-xs text-ink-4">{t("basedOn", { source: i.generatedBy === "rules" ? t("yourData") : t("aiAnalysis") })}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">{t("noInsights")}</p>
          )}
        </Card>
      </section>

      {/* Q2 & Q3: What content works? Which channel performs best? */}
      <section className="grid gap-4 lg:grid-cols-3">
        {([
          ["formats", a.formats, (k: string) => tc.has(`formats.${k}`) ? tc(`formats.${k}` as "formats.POST") : k],
          ["pillars", a.pillars, (k: string) => k],
          ["platforms", a.platforms, (k: string) => tc(`platforms.${k}` as "platforms.INSTAGRAM")],
        ] as const).map(([key, groups, name]) => (
          <Card key={key} className="p-6">
            <h2 className="mb-5 text-sm font-semibold text-ink-3">{t(`q.${key}`)}</h2>
            <AnalyticsCharts kind="bars" rows={groups.map((g, i) => ({ key: g.key, label: name(g.key), value: g.avgEngagement, note: t("postsCount", { count: g.posts }), highlight: i === 0 }))} />
          </Card>
        ))}
      </section>

      {/* Q4 & Q5: Are we generating leads? Are leads progressing? */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-ink-3">{t("q.leads")}</h2>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-4xl font-semibold tabular">{a.leads.count}</span>
            {lc && <span className={cn("text-sm font-semibold", lc.positive ? "text-success" : "text-danger")}>{lc.value}</span>}
          </div>
          <p className="mb-5 text-sm text-ink-3">{t("last30")}</p>
          <AnalyticsCharts kind="bars" rows={a.leads.bySource.map(([k, v], i) => ({ key: k, label: k, value: v, highlight: i === 0 }))} integer />
        </Card>
        <Card className="p-6">
          <h2 className="mb-5 text-sm font-semibold text-ink-3">{t("q.progressing")}</h2>
          <AnalyticsCharts
            kind="bars"
            integer
            rows={["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON"].map((s) => ({ key: s, label: stageLabel.find((x) => x.stage === s)?.label ?? s, value: a.pipeline.find((p) => p.stage === s)?._count ?? 0, highlight: s === "WON" }))}
          />
        </Card>
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-ink-3">{t("q.audience")}</h2>
          <div className="mt-2 text-4xl font-semibold tabular">{a.followers.change == null ? "—" : `${a.followers.change >= 0 ? "+" : ""}${format.number(a.followers.change)}`}</div>
          <p className="mb-4 text-sm text-ink-3">{t("followersHint")}</p>
          {a.followers.series.length > 1 && <AnalyticsCharts kind="trend" integer data={a.followers.series.map((f) => ({ x: f.date, label: format.dateTime(new Date(f.date), { month: "short", day: "numeric" }), y: f.value }))} label={t("q.audience")} />}
        </Card>
      </section>

      <AttributionCard report={attribution} />

      {/* Best posts & campaigns */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-ink-3">{t("topPosts")}</h2>
          <ul className="divide-y divide-line">
            {a.bestPosts.map((p) => (
              <li key={p.id}>
                <Link href={`/analytics/posts/${p.id}`} className="flex items-center gap-3 py-3 hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{p.caption?.split("\n")[0] ?? p.externalId}</span>
                  <Badge tone="success">{pct(p.metric?.engagementRate ?? null)}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-ink-3">{t("topCampaigns")}</h2>
          {a.campaigns.length ? (
            <ul className="divide-y divide-line">
              {a.campaigns.map((c) => (
                <li key={c.id}>
                  <Link href={`/campaigns/${c.id}`} className="flex items-center gap-3 py-3 text-sm hover:bg-surface-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    <span className="text-ink-3">{t("campaignStats", { posts: c._count.content, leads: c._count.leads })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">{t("noCampaigns")}</p>
          )}
        </Card>
      </section>
    </div>
  );
}
