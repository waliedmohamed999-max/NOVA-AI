import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { db } from "../db/client";
import { childLogger, logger } from "../logger";
import { queue } from "./queue";
import { getHandler } from "./registry";
import { registerAllJobs } from "./handlers";

/**
 * System schedules. Stored in the database (scheduled_jobs) so they survive
 * restarts and run on exactly one worker at a time.
 */
export const SYSTEM_SCHEDULES = [
  { key: "system:publish_due", type: "social.publish_due", intervalSeconds: 60 },
  { key: "system:followups_due", type: "sales.followups_due", intervalSeconds: 15 * 60 },
  { key: "system:analytics_sync", type: "social.sync_all", intervalSeconds: 6 * 3600 },
  { key: "system:token_refresh", type: "integrations.refresh_tokens", intervalSeconds: 3600 },
  { key: "system:connection_health", type: "integrations.health_check", intervalSeconds: 6 * 3600 },
  { key: "system:daily_brief", type: "reports.daily_briefs", intervalSeconds: 3600 },
  { key: "system:weekly_report", type: "reports.weekly_reports", intervalSeconds: 3 * 3600 },
  { key: "system:cleanup", type: "system.cleanup", intervalSeconds: 24 * 3600 },
  { key: "system:reconcile", type: "system.reconcile", intervalSeconds: 10 * 60 },
] as const;

/**
 * Per-type time limits. A job that exceeds its limit fails (and retries with backoff); external actions are
 * claim-protected, so a slow provider call that finishes late can't be performed twice. The stale-lock
 * recovery (15 min) is longer than every limit here.
 */
export const JOB_TIMEOUTS: Record<string, number> = {
  "ai.image.generate": 10 * 60_000,
  "privacy.export": 12 * 60_000,
  "privacy.delete_org": 12 * 60_000,
  "brain.import": 8 * 60_000,
  "knowledge.ingest": 8 * 60_000,
  "reports.daily_briefs": 12 * 60_000,
  "reports.weekly_reports": 12 * 60_000,
};
export const jobTimeoutMs = (type: string) => JOB_TIMEOUTS[type] ?? (Number(process.env.JOB_TIMEOUT_MS) || 5 * 60_000);

export class JobTimeoutError extends Error {
  constructor(type: string, ms: number) {
    super(`Job ${type} exceeded its ${ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`} time limit`);
    this.name = "JobTimeoutError";
  }
}

export async function ensureSystemSchedules() {
  for (const s of SYSTEM_SCHEDULES) {
    await db.scheduledJob.upsert({
      where: { key: s.key },
      create: { key: s.key, type: s.type, intervalSeconds: s.intervalSeconds, nextRunAt: new Date() },
      update: { type: s.type, intervalSeconds: s.intervalSeconds },
    });
  }
}

/** Enqueues every due schedule exactly once (atomic claim of nextRunAt). */
export async function tickScheduler(now = new Date()) {
  const due = await db.scheduledJob.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, take: 100 });
  let enqueued = 0;
  for (const s of due) {
    const next = new Date(now.getTime() + s.intervalSeconds * 1000);
    const claimed = await db.scheduledJob.updateMany({ where: { id: s.id, nextRunAt: s.nextRunAt }, data: { nextRunAt: next, lastRunAt: now } });
    if (claimed.count !== 1) continue;
    await queue.enqueue(s.type, s.payload as Record<string, unknown>, {
      dedupeKey: `${s.key}@${s.nextRunAt.toISOString()}`,
      organizationId: s.organizationId,
      workspaceId: s.workspaceId,
    });
    enqueued++;
  }
  return enqueued;
}

export async function runJob(job: Awaited<ReturnType<typeof queue.claim>>[number]) {
  const log = childLogger({ jobId: job.id, type: job.type, attempt: job.attempts });
  const handler = getHandler(job.type);
  const started = Date.now();
  if (!handler) {
    await queue.fail({ ...job, attempts: job.maxAttempts }, new Error(`No handler registered for ${job.type}`), 0);
    log.error("no handler for job type");
    return;
  }
  const limit = jobTimeoutMs(job.type);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      handler(job.payload as Record<string, unknown>, { job, log }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new JobTimeoutError(job.type, limit)), limit);
      }),
    ]);
    clearTimeout(timer);
    await queue.complete(job, result ?? null, Date.now() - started);
    log.info({ durationMs: Date.now() - started }, "job completed");
  } catch (err) {
    clearTimeout(timer);
    const outcome = await queue.fail(job, err, Date.now() - started);
    log.error({ err, outcome }, "job failed");
  }
}

// ── Worker liveness (read by /api/ready) ──
let lastBeat = 0;
let processedSinceStart = 0;
export async function heartbeat(workerId: string, opts: { force?: boolean; processed?: number } = {}) {
  processedSinceStart += opts.processed ?? 0;
  if (!opts.force && Date.now() - lastBeat < 20_000) return;
  lastBeat = Date.now();
  await db.workerHeartbeat
    .upsert({
      where: { workerId },
      create: { workerId, host: hostname().slice(0, 120), pid: process.pid, inline: process.env.NOVA_PROCESS !== "worker", processed: processedSinceStart },
      update: { lastSeenAt: new Date(), processed: processedSinceStart },
    })
    .catch((err) => logger.warn({ err }, "worker heartbeat failed"));
}

/** Processes one batch; used by the worker loop and by the cron HTTP trigger. */
export async function drainOnce(workerId: string, concurrency = 4) {
  registerAllJobs();
  await tickScheduler();
  const jobs = await queue.claim(workerId, concurrency);
  await Promise.all(jobs.map(runJob));
  await heartbeat(workerId, { processed: jobs.length });
  return jobs.length;
}

let running = false;

/** Long-running worker loop with graceful shutdown. */
export async function startWorker(opts: { concurrency?: number; idleMs?: number } = {}) {
  if (running) return;
  running = true;
  registerAllJobs();
  await ensureSystemSchedules();
  const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  const concurrency = opts.concurrency ?? Number(process.env.WORKER_CONCURRENCY ?? 4);
  const idleMs = opts.idleMs ?? 1500;
  logger.info({ workerId, concurrency }, "job worker started");

  let lastRecovery = 0;
  // Graceful shutdown: stop claiming; the batch in flight finishes (bounded by job time limits).
  const stop = () => {
    if (running) logger.info({ workerId }, "worker stopping: finishing the current batch");
    running = false;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await heartbeat(workerId, { force: true });

  while (running) {
    try {
      if (Date.now() - lastRecovery > 60_000) {
        const recovered = await queue.recoverStale(15 * 60_000);
        if (recovered) logger.warn({ recovered }, "recovered stale jobs");
        lastRecovery = Date.now();
      }
      const processed = await drainOnce(workerId, concurrency);
      if (processed === 0) await new Promise((r) => setTimeout(r, idleMs));
    } catch (err) {
      logger.error({ err }, "worker loop error");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  await db.workerHeartbeat.delete({ where: { workerId } }).catch(() => undefined);
  logger.info({ workerId }, "job worker stopped");
}
