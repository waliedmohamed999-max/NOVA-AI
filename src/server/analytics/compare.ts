/**
 * Pure, deterministic performance math. Every AI explanation is built on top
 * of these numbers — the model never computes or invents metrics itself.
 */

export type MetricRow = {
  id: string;
  platform: string;
  format: string | null;
  pillar: string | null;
  publishedAt: Date;
  reach: number | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  videoViews: number | null;
  leads: number | null;
  engagementRate: number | null;
};

export const METRIC_KEYS = ["reach", "impressions", "likes", "comments", "shares", "saves", "clicks", "videoViews", "leads", "engagementRate"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

/** Engagement rate = interactions / reach (falls back to impressions). Null when not computable. */
export function engagementRate(m: Pick<MetricRow, "likes" | "comments" | "shares" | "saves" | "reach" | "impressions">): number | null {
  const denom = m.reach ?? m.impressions;
  if (!denom) return null;
  const interactions = (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
  return interactions / denom;
}

export function mean(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Percentage change of `value` vs `baseline` (e.g. 0.27 = +27%). Null when not meaningful. */
export function pctChange(value: number | null | undefined, baseline: number | null | undefined): number | null {
  if (value == null || baseline == null || baseline === 0) return null;
  return (value - baseline) / baseline;
}

export type Comparison = { metric: MetricKey; value: number; baseline: number; change: number; sample: number };

/**
 * Compares one post against the average of the N most recent posts before it
 * (same platform when enough data exists). Only metrics present on both sides
 * are compared.
 */
export function compareToRecent(post: MetricRow, history: MetricRow[], n = 10): { baselineLabel: "platform" | "all"; comparisons: Comparison[]; sample: number } {
  const earlier = history.filter((h) => h.id !== post.id && h.publishedAt < post.publishedAt).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  const samePlatform = earlier.filter((h) => h.platform === post.platform);
  const pool = samePlatform.length >= 3 ? samePlatform : earlier;
  const recent = pool.slice(0, n);
  const comparisons: Comparison[] = [];
  for (const metric of METRIC_KEYS) {
    const value = post[metric];
    const vals = recent.map((r) => r[metric]).filter((x): x is number => x != null);
    if (value == null || vals.length < 2) continue;
    const baseline = mean(vals)!;
    const change = pctChange(value, baseline);
    if (change == null) continue;
    comparisons.push({ metric, value, baseline, change, sample: vals.length });
  }
  return { baselineLabel: pool === samePlatform ? "platform" : "all", comparisons, sample: recent.length };
}

export type GroupStat = { key: string; posts: number; avgEngagement: number | null; avgReach: number | null; avgSaves: number | null; avgClicks: number | null; leads: number };

export function groupBy(rows: MetricRow[], keyOf: (r: MetricRow) => string | null): GroupStat[] {
  const groups = new Map<string, MetricRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, rs]) => ({
      key,
      posts: rs.length,
      avgEngagement: mean(rs.map((r) => r.engagementRate ?? engagementRate(r))),
      avgReach: mean(rs.map((r) => r.reach)),
      avgSaves: mean(rs.map((r) => r.saves)),
      avgClicks: mean(rs.map((r) => r.clicks)),
      leads: rs.reduce((a, r) => a + (r.leads ?? 0), 0),
    }))
    .sort((a, b) => (b.avgEngagement ?? -1) - (a.avgEngagement ?? -1));
}

export type Finding = { kind: "outperforming" | "underperforming"; dimension: "pillar" | "format" | "platform"; key: string; metric: "engagementRate"; change: number; groupPosts: number; overall: number };

/**
 * Finds groups that meaningfully beat or trail the overall average.
 * Requires a minimum sample so we never draw conclusions from one post.
 */
export function findPatterns(rows: MetricRow[], minPosts = 3, threshold = 0.15): Finding[] {
  const overall = mean(rows.map((r) => r.engagementRate ?? engagementRate(r)));
  if (overall == null || rows.length < minPosts * 2) return [];
  const findings: Finding[] = [];
  const dims: [Finding["dimension"], (r: MetricRow) => string | null][] = [
    ["pillar", (r) => r.pillar],
    ["format", (r) => r.format],
    ["platform", (r) => r.platform],
  ];
  for (const [dimension, keyOf] of dims) {
    for (const g of groupBy(rows, keyOf)) {
      if (g.posts < minPosts || g.avgEngagement == null) continue;
      const change = pctChange(g.avgEngagement, overall)!;
      if (Math.abs(change) < threshold) continue;
      findings.push({ kind: change > 0 ? "outperforming" : "underperforming", dimension, key: g.key, metric: "engagementRate", change, groupPosts: g.posts, overall });
    }
  }
  return findings.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

export function formatPct(change: number) {
  const v = Math.round(change * 100);
  return `${v > 0 ? "+" : ""}${v}%`;
}
