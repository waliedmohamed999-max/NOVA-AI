import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/server/context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/misc";
import { PlatformDot } from "@/components/content/post-preview";
import { CampaignActions } from "@/features/campaigns/campaign-actions";
import { AnalyticsCharts } from "@/features/analytics/charts";
import { campaignPerformance } from "@/server/campaigns/service";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Campaign" };

type Plan = { concept?: string; keyMessage?: string; creativeDirection?: string; cta?: string; kpis?: string[] };

export default async function CampaignPage(props: PageProps<"/campaigns/[id]">) {
  const { id } = await props.params;
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("app.campaigns");
  const tc = await getTranslations("common");
  const ts = await getTranslations("content.status");
  const format = await getFormatter();
  const c = await ctx.db.campaign.findUnique({
    where: { id },
    include: { content: { orderBy: { scheduledAt: "asc" } }, leads: { select: { id: true, name: true, stage: true, estimatedValueCents: true, currency: true } } },
  });
  if (!c) notFound();
  const plan = (c.plan ?? {}) as Plan;
  const posts = await ctx.db.socialPost.findMany({ where: { contentItemId: { in: c.content.map((x) => x.id) } }, include: { metric: true } });
  const reach = posts.reduce((a, p) => a + (p.metric?.reach ?? 0), 0);
  const won = c.leads.filter((l) => l.stage === "WON");
  const revenue = won.reduce((a, l) => a + (l.estimatedValueCents ?? 0), 0);
  const currency = c.leads[0]?.currency ?? "USD";
  const perf = await campaignPerformance({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }, c.id);
  const week = (d: Date) => format.dateTime(d, { month: "short", day: "numeric" });
  const money = (cents: number, cur: string) => format.number(cents / 100, { style: "currency", currency: cur, maximumFractionDigits: 0 });

  return (
    <div className="space-y-6">
      <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"><ArrowLeft className="size-4 flip-rtl" /> {t("title")}</Link>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <Badge tone={c.status === "ACTIVE" ? "success" : c.status === "PENDING_APPROVAL" ? "accent" : "neutral"}>{t(`status.${c.status}` as "status.ACTIVE")}</Badge>
          <h1 className="text-[30px] font-semibold tracking-[-0.02em]">{c.name}</h1>
          <p className="max-w-2xl text-ink-3">{c.objective}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.channel === "whatsapp" && (
            <Link href={`/whatsapp/campaigns/${c.id}`} className={buttonClass("secondary", "md")}>
              {t("whatsappTools")}
            </Link>
          )}
          {ctx.can("campaign:manage") && (
            <CampaignActions
              id={c.id}
              status={c.status}
              channel={c.channel}
              brief={{ name: c.name, objective: c.objective, audience: c.audience, offer: c.offer, startDate: c.startDate?.toISOString() ?? null, endDate: c.endDate?.toISOString() ?? null, budget: c.budgetCents == null ? null : c.budgetCents / 100, currency: c.currency }}
            />
          )}
        </div>
      </header>

      <Card className="grid grid-cols-2 gap-6 p-6 lg:grid-cols-4">
        <Stat label={t("posts")} value={c.content.length} />
        <Stat label={t("reach")} value={posts.length ? format.number(reach) : "—"} hint={posts.length ? undefined : t("noMetrics")} />
        <Stat label={t("leads")} value={c.leads.length} />
        <Stat label={t("revenue")} value={format.number(revenue / 100, { style: "currency", currency, maximumFractionDigits: 0 })} hint={t("revenueHint", { count: won.length })} />
      </Card>

      <section className="grid gap-6 lg:grid-cols-2" aria-label={t("performance.title")}>
        <Card className="p-6">
          <h2 className="text-sm font-semibold">{t("performance.reach")}</h2>
          <p className="mt-1 text-xs text-ink-4">{t("performance.weekly")}</p>
          <div className="mt-5">
            {perf.hasData ? (
              <AnalyticsCharts kind="trend" integer label={t("performance.reach")} data={perf.weeks.map((w) => ({ x: w.start.toISOString(), label: week(w.start), y: w.posts ? w.reach : null }))} />
            ) : (
              <p className="py-10 text-center text-sm text-ink-4">{t("performance.empty")}</p>
            )}
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-sm font-semibold">{t("performance.leads")}</h2>
          <p className="mt-1 text-xs text-ink-4">{t("performance.weekly")}</p>
          <div className="mt-5">
            {perf.hasData ? (
              <AnalyticsCharts kind="trend" integer label={t("performance.leads")} data={perf.weeks.map((w) => ({ x: w.start.toISOString(), label: week(w.start), y: w.leads }))} />
            ) : (
              <p className="py-10 text-center text-sm text-ink-4">{t("performance.empty")}</p>
            )}
          </div>
        </Card>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold">{t("content")}</h2>
          {c.content.length === 0 && <p className="py-8 text-center text-sm text-ink-4">{t("noContent")}</p>}
          <ul className="divide-y divide-line">
            {c.content.map((p) => (
              <li key={p.id}>
                <Link href={`/content/${p.id}`} className="flex items-center gap-3 py-3 hover:bg-surface-2">
                  <PlatformDot platform={p.platform} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                  <Badge tone={p.status === "PENDING_APPROVAL" ? "accent" : p.status === "PUBLISHED" ? "success" : "neutral"}>{ts(p.status)}</Badge>
                  <span className="hidden w-32 text-end text-xs text-ink-3 sm:block">{p.scheduledAt ? format.dateTime(p.scheduledAt, { weekday: "short", month: "short", day: "numeric" }) : "—"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <aside className="space-y-4">
          <Card className="space-y-4 p-5 text-sm">
            {(c.startDate || c.endDate || c.budgetCents != null || c.offer) && (
              <dl className="grid grid-cols-2 gap-3 border-b border-line pb-4">
                {(c.startDate || c.endDate) && (
                  <div className="col-span-2">
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-4">{t("dates")}</dt>
                    <dd className="mt-1 text-ink-2">
                      {c.startDate && c.endDate
                        ? format.dateTimeRange(c.startDate, c.endDate, { dateStyle: "medium" })
                        : c.startDate
                          ? t("from", { date: format.dateTime(c.startDate, { dateStyle: "medium" }) })
                          : t("until", { date: format.dateTime(c.endDate!, { dateStyle: "medium" }) })}
                    </dd>
                  </div>
                )}
                {c.budgetCents != null && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-4">{t("budget")}</dt>
                    <dd className="mt-1 tabular text-ink-2">{money(c.budgetCents, c.currency ?? "USD")}</dd>
                  </div>
                )}
                {c.offer && (
                  <div className="col-span-2">
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-4">{t("offer")}</dt>
                    <dd className="mt-1 text-ink-2">{c.offer}</dd>
                  </div>
                )}
              </dl>
            )}
            {(["concept", "keyMessage", "creativeDirection", "cta"] as const).map((k) =>
              plan[k] ? (
                <div key={k}>
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-4">{t(`plan.${k}`)}</div>
                  <p className="mt-1 text-ink-2">{plan[k]}</p>
                </div>
              ) : null,
            )}
            {c.audience && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-4">{t("plan.audience")}</div>
                <p className="mt-1 text-ink-2">{c.audience}</p>
              </div>
            )}
            {!!plan.kpis?.length && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-4">{t("plan.kpis")}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">{plan.kpis.map((k) => <Badge key={k} tone="outline">{k}</Badge>)}</div>
              </div>
            )}
            <div className="text-xs text-ink-4">{c.channels.map((ch) => tc(`platforms.${ch}` as "platforms.INSTAGRAM")).join(" · ")}</div>
          </Card>
          {c.leads.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">{t("leads")}</h2>
              <ul className="space-y-2 text-sm">
                {c.leads.map((l) => <li key={l.id}><Link href={`/leads/${l.id}`} className="hover:underline">{l.name}</Link></li>)}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
