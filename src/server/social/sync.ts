import { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { logger } from "../logger";
import { notify } from "../notifications/service";
import { engagementRate } from "../analytics/compare";
import { accountRef, markIntegrationError, tokenForAccount } from "../integrations/service";
import { providerForPlatform } from "../integrations/registry";
import type { NormalizedMetrics } from "../integrations/types";
import { enqueue } from "../jobs/queue";

function metricData(m: NormalizedMetrics) {
  const er = engagementRate(m);
  return {
    reach: m.reach,
    impressions: m.impressions,
    likes: m.likes,
    comments: m.comments,
    shares: m.shares,
    saves: m.saves,
    clicks: m.clicks,
    videoViews: m.videoViews,
    followersGained: m.followersGained,
    engagementRate: er,
    raw: m.raw as Prisma.InputJsonValue,
  };
}

/** Stores the latest metrics and appends an immutable snapshot. */
export async function recordMetrics(scope: TenantScope, socialPostId: string, m: NormalizedMetrics) {
  const data = metricData(m);
  await db.socialMetric.upsert({
    where: { socialPostId },
    create: { ...scope, socialPostId, ...data },
    update: { ...data, collectedAt: new Date() },
  });
  await db.socialMetricSnapshot.create({ data: { ...scope, socialPostId, ...data } });
}

/** Syncs one integration: recent posts, their metrics, and account-level numbers. */
export async function syncIntegration(integrationId: string) {
  const integration = await db.integration.findUniqueOrThrow({ where: { id: integrationId }, include: { accounts: { where: { isActive: true } } } });
  const scope = { organizationId: integration.organizationId, workspaceId: integration.workspaceId };
  if (integration.status !== "CONNECTED") return { skipped: true };
  const provider = providerForPlatform(integration.provider);
  if (!provider) return { skipped: true };
  let posts = 0;
  const toAnalyze: string[] = [];
  try {
    for (const account of integration.accounts) {
      const token = await tokenForAccount(integration.id, account.id);
      if (!token || !account.platform) continue;
      const ref = accountRef(account);
      const remote = await provider.getPosts(ref, token, { since: new Date(Date.now() - 60 * 86_400_000), limit: 30 });
      for (const r of remote) {
        const existing = await db.socialPost.findUnique({ where: { workspaceId_platform_externalId: { workspaceId: scope.workspaceId, platform: account.platform, externalId: r.externalId } } });
        const post = await db.socialPost.upsert({
          where: { workspaceId_platform_externalId: { workspaceId: scope.workspaceId, platform: account.platform, externalId: r.externalId } },
          create: { ...scope, integrationAccountId: account.id, platform: account.platform, externalId: r.externalId, permalink: r.permalink ?? null, caption: r.caption ?? null, mediaUrl: r.mediaUrl ?? null, format: r.format ?? null, publishedAt: r.publishedAt },
          update: { permalink: r.permalink ?? null, caption: r.caption ?? existing?.caption ?? null, mediaUrl: r.mediaUrl ?? null },
        });
        const metrics = r.metrics ?? (await provider.getMetrics(ref, token, r.externalId).catch(() => null));
        if (metrics) {
          const hadMetrics = await db.socialMetric.findUnique({ where: { socialPostId: post.id } });
          await recordMetrics(scope, post.id, metrics);
          // First metrics for a recent post → ask the Performance Analyst to explain it.
          if (!hadMetrics && r.publishedAt > new Date(Date.now() - 7 * 86_400_000)) toAnalyze.push(post.id);
        }
        posts++;
      }
      const am = await provider.getAccountMetrics(ref, token).catch(() => null);
      if (am) {
        const date = new Date(new Date().toISOString().slice(0, 10));
        await db.accountMetricSnapshot.upsert({
          where: { workspaceId_platform_date: { workspaceId: scope.workspaceId, platform: account.platform, date } },
          create: { ...scope, integrationAccountId: account.id, platform: account.platform, date, followers: am.followers, reach: am.reach, impressions: am.impressions, profileViews: am.profileViews, raw: am.raw as Prisma.InputJsonValue },
          update: { followers: am.followers, reach: am.reach, impressions: am.impressions, profileViews: am.profileViews, raw: am.raw as Prisma.InputJsonValue },
        });
      }
    }
    await db.integration.update({ where: { id: integration.id }, data: { lastSyncAt: new Date(), statusMessage: null } });
  } catch (err) {
    await markIntegrationError(scope, integration.id, err);
    logger.warn({ integrationId }, "sync failed");
    return { failed: true };
  }
  for (const id of toAnalyze) await enqueue("analytics.analyze_post", { ...scope, socialPostId: id }, { ...scope, dedupeKey: `analyze:${id}` });
  return { posts, analyzed: toAnalyze.length };
}

export async function syncAll() {
  const integrations = await db.integration.findMany({ where: { status: "CONNECTED", provider: { in: ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "TIKTOK"] } }, select: { id: true, organizationId: true, workspaceId: true } });
  for (const i of integrations) await enqueue("social.sync_integration", { integrationId: i.id, organizationId: i.organizationId, workspaceId: i.workspaceId }, { organizationId: i.organizationId, workspaceId: i.workspaceId, dedupeKey: `sync:${i.id}:${new Date().toISOString().slice(0, 13)}` });
  return { queued: integrations.length };
}

/** Notifies owners about a notable real performance change on a post. */
export async function notifyInsight(scope: TenantScope, title: string, link: string) {
  await notify({ ...scope, type: "AI_RECOMMENDATION", title, link });
}
