import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, Lightbulb, Sparkles } from "lucide-react";
import { requireTenant } from "@/server/context";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/misc";
import type { BriefData, WeeklyData } from "@/server/reports/service";

export const metadata: Metadata = { title: "Report" };

export default async function ReportPage(props: PageProps<"/reports/[id]">) {
  const { id } = await props.params;
  const ctx = await requireTenant({ permission: "analytics:read" });
  const t = await getTranslations("settings.reports");
  const format = await getFormatter();
  const r = await ctx.db.report.findUnique({ where: { id } });
  if (!r) notFound();
  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
  const change = (a: number | null, b: number | null) => (a != null && b ? { value: `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%`, positive: a >= b } : null);
  const weekly = r.kind === "WEEKLY_REPORT" ? (r.data as unknown as WeeklyData) : null;
  const brief = r.kind === "DAILY_BRIEF" ? (r.data as unknown as BriefData) : null;

  return (
    <article className="mx-auto max-w-4xl space-y-8">
      <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4 flip-rtl" /> {t("title")}
      </Link>
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent-ink">{t(`kinds.${r.kind}`)}</p>
        <h1 className="text-4xl font-semibold tracking-[-0.03em]">
          {format.dateTime(r.periodStart, { dateStyle: "long" })} – {format.dateTime(r.periodEnd, { dateStyle: "long" })}
        </h1>
      </header>
      <Card className="relative overflow-hidden p-8">
        <div className="absolute inset-0 ai-aura opacity-60" aria-hidden />
        <p className="relative font-display text-[26px] leading-[1.4]" dir="auto">
          <Sparkles className="me-2 inline size-5 text-accent" />
          {r.narrative}
        </p>
      </Card>

      {weekly && (
        <>
          <Card className="grid grid-cols-2 gap-6 p-6 md:grid-cols-4">
            <Stat label={t("posts")} value={weekly.posts.thisWeek} delta={change(weekly.posts.thisWeek, weekly.posts.lastWeek)} />
            <Stat label={t("reach")} value={weekly.reach.thisWeek != null ? format.number(weekly.reach.thisWeek) : "—"} delta={change(weekly.reach.thisWeek, weekly.reach.lastWeek)} />
            <Stat label={t("engagement")} value={pct(weekly.engagement.thisWeek)} delta={change(weekly.engagement.thisWeek, weekly.engagement.lastWeek)} />
            <Stat label={t("followers")} value={weekly.followers.change != null ? `${weekly.followers.change >= 0 ? "+" : ""}${weekly.followers.change}` : "—"} />
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-6">
              <h2 className="mb-2 text-sm font-semibold text-ink-3">{t("best")}</h2>
              <p className="text-sm" dir="auto">{weekly.best?.caption ?? "—"}</p>
              {weekly.best && <p className="mt-2 text-xs font-semibold text-success">{pct(weekly.best.engagementRate)}</p>}
            </Card>
            <Card className="p-6">
              <h2 className="mb-2 text-sm font-semibold text-ink-3">{t("worst")}</h2>
              <p className="text-sm" dir="auto">{weekly.worst?.caption ?? "—"}</p>
              {weekly.worst && <p className="mt-2 text-xs font-semibold text-danger">{pct(weekly.worst.engagementRate)}</p>}
            </Card>
          </div>
          <Card className="grid grid-cols-2 gap-6 p-6 md:grid-cols-4">
            <Stat label={t("newLeads")} value={weekly.leads.created} />
            <Stat label={t("qualified")} value={weekly.leads.qualified} />
            <Stat label={t("won")} value={weekly.leads.won} />
            <Stat label={t("wonValue")} value={format.number(weekly.leads.wonValueCents / 100, { maximumFractionDigits: 0 })} />
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-6">
              <h2 className="mb-3 text-sm font-semibold text-ink-3">{t("learned")}</h2>
              <ul className="space-y-2 text-sm">{weekly.learned.length ? weekly.learned.map((l) => <li key={l.title}>{l.title}</li>) : <li className="text-ink-4">—</li>}</ul>
            </Card>
            <Card className="p-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-3">
                <Lightbulb className="size-4 text-accent" />
                {t("nextWeek")}
              </h2>
              <ul className="space-y-2 text-sm">{weekly.recommendations.length ? weekly.recommendations.map((l) => <li key={l}>→ {l}</li>) : <li className="text-ink-4">—</li>}</ul>
            </Card>
          </div>
        </>
      )}

      {brief && (
        <Card className="grid grid-cols-2 gap-6 p-6 md:grid-cols-4">
          <Stat label={t("awaiting")} value={brief.awaitingApproval} />
          <Stat label={t("upcoming")} value={brief.upcomingPosts.length} />
          <Stat label={t("newLeads")} value={brief.newLeads} />
          <Stat label={t("hotLeads")} value={brief.hotLeads.length} />
        </Card>
      )}
      <p className="text-xs text-ink-4">{t("dataNote")}</p>
    </article>
  );
}
