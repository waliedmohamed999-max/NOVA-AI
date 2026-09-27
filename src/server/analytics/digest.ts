import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { engagementRate, findPatterns, formatPct, groupBy, mean, type Finding, type MetricRow } from "./compare";

/** Loads published posts with their latest normalized metrics for a window. */
export async function loadMetricRows(scope: TenantScope, sinceDays = 60): Promise<MetricRow[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const posts = await db.socialPost.findMany({
    where: { ...scope, publishedAt: { gte: since }, metric: { isNot: null } },
    include: { metric: true, contentItem: { select: { pillar: true, format: true } } },
    orderBy: { publishedAt: "desc" },
    take: 500,
  });
  return posts.map((p) => {
    const m = p.metric!;
    const row: MetricRow = {
      id: p.id,
      platform: p.platform,
      format: p.format ?? p.contentItem?.format ?? null,
      pillar: p.pillar ?? p.contentItem?.pillar ?? null,
      publishedAt: p.publishedAt,
      reach: m.reach,
      impressions: m.impressions,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      saves: m.saves,
      clicks: m.clicks,
      videoViews: m.videoViews,
      leads: m.leads,
      engagementRate: m.engagementRate,
    };
    row.engagementRate ??= engagementRate(row);
    return row;
  });
}

export type PerformanceDigest = { text: string; posts: number; findings: Finding[]; avgEngagement: number | null; hasData: boolean };

/** A short, factual summary of real performance that agents can read. */
export async function performanceDigest(scope: TenantScope, sinceDays = 30): Promise<PerformanceDigest> {
  const rows = await loadMetricRows(scope, sinceDays);
  if (rows.length === 0) {
    return { text: "No published posts with metrics yet — there is no performance data to learn from.", posts: 0, findings: [], avgEngagement: null, hasData: false };
  }
  const avg = mean(rows.map((r) => r.engagementRate));
  const findings = findPatterns(rows);
  const byFormat = groupBy(rows, (r) => r.format).slice(0, 4);
  const lines = [
    `${rows.length} posts published in the last ${sinceDays} days with metrics. Average engagement rate: ${avg != null ? (avg * 100).toFixed(2) + "%" : "n/a"}.`,
    ...byFormat.map((g) => `Format ${g.key}: ${g.posts} posts, avg engagement ${g.avgEngagement != null ? (g.avgEngagement * 100).toFixed(2) + "%" : "n/a"}.`),
    ...findings.slice(0, 5).map((f) => `${f.dimension} "${f.key}" is ${f.kind} (${formatPct(f.change)} engagement vs average, ${f.groupPosts} posts).`),
  ];
  return { text: lines.join("\n"), posts: rows.length, findings, avgEngagement: avg, hasData: true };
}
