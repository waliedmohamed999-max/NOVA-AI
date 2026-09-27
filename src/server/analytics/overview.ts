import type { TenantContext } from "../context";
import { engagementRate, groupBy, mean, pctChange } from "./compare";
import { loadMetricRows } from "./digest";

const DAY = 86_400_000;

/** Analytics home: answers business questions, not 40 charts. Every value is computed from stored data. */
export async function loadAnalytics(ctx: TenantContext, days = 30) {
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const rows = await loadMetricRows(scope, days * 2);
  const now = Date.now();
  const cur = rows.filter((r) => r.publishedAt.getTime() > now - days * DAY);
  const prev = rows.filter((r) => r.publishedAt.getTime() <= now - days * DAY);
  const er = (rs: typeof rows) => mean(rs.map((r) => r.engagementRate ?? engagementRate(r)));

  // Weekly engagement trend
  const weeks = Math.ceil((days * 2) / 7);
  const trend = Array.from({ length: weeks }, (_, i) => {
    const end = now - (weeks - 1 - i) * 7 * DAY;
    const bucket = rows.filter((r) => r.publishedAt.getTime() <= end && r.publishedAt.getTime() > end - 7 * DAY);
    return { end: new Date(end), value: er(bucket) };
  });

  const [followers, leads, leadsPrev, stages, bestPosts, campaigns, integrations, insights] = await Promise.all([
    ctx.db.accountMetricSnapshot.findMany({ where: { date: { gte: new Date(now - days * DAY) } }, orderBy: { date: "asc" } }),
    ctx.db.lead.findMany({ where: { createdAt: { gte: new Date(now - days * DAY) } }, select: { source: true, channel: true, stage: true, campaignId: true } }),
    ctx.db.lead.count({ where: { createdAt: { gte: new Date(now - 2 * days * DAY), lt: new Date(now - days * DAY) } } }),
    ctx.db.lead.groupBy({ by: ["stage"], _count: true, _sum: { estimatedValueCents: true } }),
    ctx.db.socialPost.findMany({ where: { id: { in: [...cur].sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0)).slice(0, 4).map((r) => r.id) } }, include: { metric: true } }),
    ctx.db.campaign.findMany({ where: { status: { in: ["ACTIVE", "COMPLETED"] } }, include: { _count: { select: { leads: true, content: true } } }, take: 5 }),
    ctx.db.integration.count({ where: { status: "CONNECTED" } }),
    ctx.db.aiInsight.findMany({ where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 4 }),
  ]);

  const byDate = new Map<string, number>();
  for (const f of followers) byDate.set(f.date.toISOString().slice(0, 10), (byDate.get(f.date.toISOString().slice(0, 10)) ?? 0) + (f.followers ?? 0));
  const followerSeries = [...byDate.entries()].map(([date, value]) => ({ date, value }));

  const bySource = new Map<string, number>();
  for (const l of leads) bySource.set(l.source ?? l.channel, (bySource.get(l.source ?? l.channel) ?? 0) + 1);

  return {
    hasData: rows.length > 0,
    connected: integrations,
    demo: ctx.organization.isDemo,
    content: { posts: cur.length, postsPrev: prev.length, engagement: er(cur), engagementChange: pctChange(er(cur), er(prev)), reach: cur.reduce((a, r) => a + (r.reach ?? 0), 0) },
    trend,
    formats: groupBy(cur, (r) => r.format),
    pillars: groupBy(cur, (r) => r.pillar),
    platforms: groupBy(cur, (r) => r.platform),
    followers: { series: followerSeries, change: followerSeries.length > 1 ? followerSeries[followerSeries.length - 1].value - followerSeries[0].value : null },
    leads: { count: leads.length, change: pctChange(leads.length, leadsPrev), bySource: [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) },
    pipeline: stages,
    bestPosts,
    campaigns,
    insights,
  };
}
