import { db } from "../db/client";
import { currentPeriod } from "../ai/budget";

/** Platform-wide read models. Never selects credentials, tokens or password hashes. */
export async function adminOverview() {
  const since = new Date(Date.now() - 86_400_000);
  const [orgs, users, subs, dead, failedRuns, integrationIssues, spend] = await Promise.all([
    db.organization.count(),
    db.user.count(),
    db.subscription.groupBy({ by: ["plan", "status"], _count: true }),
    db.job.count({ where: { status: "DEAD" } }),
    db.aiRun.count({ where: { status: "ERROR", createdAt: { gte: since } } }),
    db.integration.count({ where: { status: { in: ["EXPIRED", "ERROR", "ACTION_REQUIRED"] } } }),
    db.aiUsage.aggregate({ where: { period: currentPeriod() }, _sum: { costMicro: true, requests: true } }),
  ]);
  return { orgs, users, subs, dead, failedRuns, integrationIssues, spendMicro: spend._sum.costMicro ?? 0n, requests: spend._sum.requests ?? 0 };
}

export async function adminOrganizations(q: string) {
  const orgs = await db.organization.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] } : {},
    include: { subscription: true, _count: { select: { members: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const usage = await db.aiUsage.groupBy({ by: ["organizationId"], where: { period: currentPeriod(), organizationId: { in: orgs.map((o) => o.id) } }, _sum: { costMicro: true } });
  return orgs.map((o) => ({ ...o, aiCostMicro: usage.find((u) => u.organizationId === o.id)?._sum.costMicro ?? 0n }));
}

export function adminUsers(q: string) {
  return db.user.findMany({
    where: q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {},
    select: { id: true, email: true, name: true, isPlatformAdmin: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true, _count: { select: { memberships: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function adminAiUsage() {
  const rows = await db.aiRun.groupBy({ by: ["provider", "model", "status"], where: { createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, _count: true, _sum: { costMicro: true, inputTokens: true, outputTokens: true }, _avg: { latencyMs: true } });
  return rows.sort((a, b) => Number((b._sum.costMicro ?? 0n) - (a._sum.costMicro ?? 0n)));
}

export function adminIntegrations(status?: string) {
  return db.integration.findMany({
    where: status ? { status: status as never } : {},
    select: { id: true, provider: true, status: true, statusMessage: true, lastSyncAt: true, lastErrorAt: true, organizationId: true, _count: { select: { accounts: true } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
}

export function adminJobs(status: string) {
  return db.job.findMany({
    where: { status: status as never },
    select: { id: true, type: true, status: true, attempts: true, maxAttempts: true, lastError: true, organizationId: true, runAt: true, createdAt: true, finishedAt: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

/** Recent incidents across the platform: dead jobs, AI errors, publishing failures, integration errors. */
export async function adminIncidents() {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [jobs, ai, pubs, ints] = await Promise.all([
    db.job.findMany({ where: { status: "DEAD", finishedAt: { gte: since } }, select: { id: true, type: true, lastError: true, finishedAt: true }, take: 20, orderBy: { finishedAt: "desc" } }),
    db.aiRun.findMany({ where: { status: "ERROR", createdAt: { gte: since } }, select: { id: true, provider: true, model: true, error: true, createdAt: true }, take: 20, orderBy: { createdAt: "desc" } }),
    db.socialPublication.findMany({ where: { status: "FAILED", updatedAt: { gte: since } }, select: { id: true, platform: true, error: true, updatedAt: true }, take: 20, orderBy: { updatedAt: "desc" } }),
    db.integration.findMany({ where: { status: { in: ["ERROR", "EXPIRED"] }, lastErrorAt: { gte: since } }, select: { id: true, provider: true, statusMessage: true, lastErrorAt: true }, take: 20 }),
  ]);
  return [
    ...jobs.map((j) => ({ kind: "job", id: j.id, title: j.type, detail: j.lastError, at: j.finishedAt })),
    ...ai.map((a) => ({ kind: "ai", id: a.id, title: `${a.provider}/${a.model}`, detail: a.error, at: a.createdAt })),
    ...pubs.map((p) => ({ kind: "publishing", id: p.id, title: p.platform, detail: p.error, at: p.updatedAt })),
    ...ints.map((i) => ({ kind: "integration", id: i.id, title: i.provider, detail: i.statusMessage, at: i.lastErrorAt })),
  ].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}
