import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, Check, Lightbulb, X } from "lucide-react";
import { requireTenant } from "@/server/context";
import { loadMetricRows } from "@/server/analytics/digest";
import { compareToRecent, formatPct, METRIC_KEYS } from "@/server/analytics/compare";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PostPreview } from "@/components/content/post-preview";
import { PostAnalysisActions } from "@/features/analytics/post-actions";
import type { PostInsight } from "@/server/agents/schemas";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Post performance" };

export default async function PostPerformancePage(props: PageProps<"/analytics/posts/[id]">) {
  const { id } = await props.params;
  const ctx = await requireTenant({ permission: "analytics:read" });
  const t = await getTranslations("analytics.post");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const post = await ctx.db.socialPost.findUnique({ where: { id }, include: { metric: true, contentItem: true } });
  if (!post) notFound();
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const rows = await loadMetricRows(scope, 180);
  const row = rows.find((r) => r.id === id);
  const cmp = row ? compareToRecent(row, rows) : null;
  const insightRow = await ctx.db.aiInsight.findFirst({ where: { subjectType: "SocialPost", subjectId: id, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
  let insight: PostInsight | null = null;
  try {
    insight = insightRow ? (JSON.parse(insightRow.body) as PostInsight) : null;
  } catch {
    insight = null;
  }

  const m = post.metric;
  const cards = METRIC_KEYS.filter((k) => m && m[k] != null).map((k) => {
    const c = cmp?.comparisons.find((x) => x.metric === k);
    return { key: k, value: m![k] as number, change: c?.change ?? null };
  });
  const val = (k: string, v: number) => (k === "engagementRate" ? `${(v * 100).toFixed(2)}%` : format.number(v));

  return (
    <div className="space-y-6">
      <Link href="/analytics" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"><ArrowLeft className="size-4 flip-rtl" /> {tc("nav.analytics")}</Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm text-ink-3">
            {tc(`platforms.${post.platform}` as "platforms.INSTAGRAM")} · {format.dateTime(post.publishedAt, { dateStyle: "medium", timeStyle: "short" })}
            {post.isDemo && <Badge tone="accent">{tc("demo.badge")}</Badge>}
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em]">{t("title")}</h1>
        </div>
        <PostAnalysisActions postId={post.id} hasInsight={Boolean(insight)} />
      </header>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="flex justify-center bg-sunken/50 p-6">
          <PostPreview
            brandName={ctx.organization.name}
            post={{
              platform: post.platform,
              format: post.format ?? "POST",
              hook: post.contentItem?.hook ?? null,
              caption: post.caption ?? post.contentItem?.caption ?? "",
              cta: null,
              hashtags: post.contentItem?.hashtags ?? [],
              designBrief: post.contentItem?.designBrief as never,
              imageUrl: post.mediaUrl,
            }}
          />
        </Card>

        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink-3">{t("scorecards")}</h2>
            {cards.length ? (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {cards.map((c) => (
                  <div key={c.key} className="rounded-2xl border border-line bg-surface p-4">
                    <dt className="text-xs text-ink-3">{t(`metrics.${c.key}`)}</dt>
                    <dd className="mt-1 text-2xl font-semibold tabular">{val(c.key, c.value)}</dd>
                    {c.change != null && <dd className={cn("text-xs font-semibold tabular", c.change >= 0 ? "text-success" : "text-danger")}>{formatPct(c.change)} {t("vsAverage")}</dd>}
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-ink-3">{t("noMetrics")}</p>
            )}
            {cmp && <p className="mt-3 text-xs text-ink-4">{t("baseline", { count: cmp.sample, scope: cmp.baselineLabel === "platform" ? tc(`platforms.${post.platform}` as "platforms.INSTAGRAM") : t("allPlatforms") })}</p>}
          </section>

          {insight ? (
            <Card className="relative overflow-hidden p-6">
              <div className="absolute inset-0 ai-aura opacity-50" aria-hidden />
              <div className="relative space-y-5">
                <p className="font-display text-2xl leading-snug">{insight.headline}</p>
                <div className="grid gap-5 md:grid-cols-3">
                  {([["whatWorked", insight.whatWorked, Check, "text-success"], ["whatDidnt", insight.whatDidnt, X, "text-danger"], ["tryNext", insight.tryNext, Lightbulb, "text-accent"]] as const).map(([k, list, Icon, cls]) => (
                    <div key={k}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">{t(k)}</h3>
                      <ul className="space-y-2 text-sm">
                        {list.length ? list.map((x) => <li key={x} className="flex gap-2"><Icon className={cn("mt-0.5 size-4 shrink-0", cls)} />{x}</li>) : <li className="text-ink-4">—</li>}
                      </ul>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-ink-4">{t("evidence")}</p>
              </div>
            </Card>
          ) : (
            <Card className="p-6 text-sm text-ink-3">{t("noInsight")}</Card>
          )}
        </div>
      </div>
    </div>
  );
}
