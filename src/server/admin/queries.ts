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

const OAUTH_FAILURES = ["denied", "invalid_scope", "exchange_failed", "personal_account", "no_accounts"];

/**
 * Health summary for the incidents page: failed jobs, failed provider calls, OAuth failures, provider
 * validation failures, accounts that need reconnecting, and latency (AI runs and job runs).
 */
export async function adminHealth() {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [deadJobs, failedPubs, oauth, providerFails, slowCalls, validationFails, reconnect, ai, jobs] = await Promise.all([
    db.job.count({ where: { status: "DEAD", finishedAt: { gte: since } } }),
    db.socialPublication.count({ where: { status: "FAILED", updatedAt: { gte: since } } }),
    db.oAuthState.groupBy({ by: ["provider", "outcome"], where: { createdAt: { gte: since }, outcome: { in: OAUTH_FAILURES } }, _count: true }),
    db.providerCall.groupBy({ by: ["host", "kind"], where: { createdAt: { gte: since }, kind: { not: "slow" } }, _count: true, _max: { createdAt: true } }),
    db.providerCall.groupBy({ by: ["host"], where: { createdAt: { gte: since }, kind: "slow" }, _count: true, _max: { durationMs: true } }),
    db.providerValidation.findMany({ where: { createdAt: { gte: since }, ok: false }, orderBy: { createdAt: "desc" }, take: 10, select: { provider: true, check: true, detail: true, createdAt: true } }),
    db.integration.findMany({ where: { status: { in: ["ERROR", "EXPIRED"] } }, select: { id: true, provider: true, status: true, statusMessage: true, lastErrorAt: true, organizationId: true }, orderBy: { lastErrorAt: "desc" }, take: 50 }),
    db.aiRun.findMany({ where: { createdAt: { gte: since } }, select: { latencyMs: true, status: true }, take: 5000 }),
    db.jobRun.findMany({ where: { startedAt: { gte: since }, durationMs: { not: null } }, select: { durationMs: true }, take: 5000 }),
  ]);
  const pct = (xs: number[], p: number) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  };
  const aiMs = ai.map((a) => a.latencyMs).filter((x) => x > 0);
  const jobMs = jobs.map((j) => j.durationMs!).filter((x) => x > 0);
  return {
    counts: {
      deadJobs,
      failedPublishing: failedPubs,
      oauthFailures: oauth.reduce((a, o) => a + o._count, 0),
      providerFailures: providerFails.reduce((a, p) => a + p._count, 0),
      reconnectNeeded: reconnect.length,
      aiErrors: ai.filter((a) => a.status === "ERROR").length,
    },
    oauth: oauth.map((o) => ({ provider: o.provider, outcome: o.outcome ?? "unknown", count: o._count })),
    providerFailures: providerFails.map((p) => ({ host: p.host, kind: p.kind, count: p._count, lastAt: p._max.createdAt })).sort((a, b) => b.count - a.count),
    slowCalls: slowCalls.map((s) => ({ host: s.host, count: s._count, maxMs: s._max.durationMs })),
    validationFailures: validationFails,
    reconnect,
    latency: { aiP50: pct(aiMs, 50), aiP95: pct(aiMs, 95), jobP50: pct(jobMs, 50), jobP95: pct(jobMs, 95) },
    sentry: Boolean(process.env.SENTRY_DSN?.trim()),
  };
}

/**
 * Command Center routing this month (platform admin only): how many commands were answered locally,
 * from the Company Brain, with AI, or with brain + AI — plus real tokens/cost/latency from the log.
 * No "tokens saved" estimate: there is no baseline to compare against, so we report commands handled without AI.
 */
export async function adminCommandUsage() {
  const since = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const where = { createdAt: { gte: since }, mode: { not: null } };
  const [byMode, cacheHits, recent] = await Promise.all([
    db.commandExecution.groupBy({ by: ["mode"], where, _count: true, _sum: { inputTokens: true, outputTokens: true, costMicro: true, contextTokens: true }, _avg: { latencyMs: true } }),
    db.commandExecution.count({ where: { ...where, cacheHit: true } }),
    db.commandExecution.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, createdAt: true, intent: true, mode: true, status: true, cacheHit: true, contextTokens: true, retrievedItems: true, inputTokens: true, outputTokens: true, costMicro: true, latencyMs: true },
    }),
  ]);
  const total = byMode.reduce((a, m) => a + m._count, 0);
  const count = (m: string) => byMode.find((x) => x.mode === m)?._count ?? 0;
  const withoutAi = count("local") + count("brain");
  return {
    total,
    withoutAi,
    cacheHits,
    modes: (["local", "brain", "ai", "brain_ai"] as const).map((m) => {
      const row = byMode.find((x) => x.mode === m);
      return {
        mode: m,
        count: row?._count ?? 0,
        share: total ? Math.round(((row?._count ?? 0) / total) * 100) : 0,
        tokens: (row?._sum.inputTokens ?? 0) + (row?._sum.outputTokens ?? 0),
        contextTokens: row?._sum.contextTokens ?? 0,
        costMicro: row?._sum.costMicro ?? BigInt(0),
        avgLatency: Math.round(row?._avg.latencyMs ?? 0),
      };
    }),
    recent,
  };
}
