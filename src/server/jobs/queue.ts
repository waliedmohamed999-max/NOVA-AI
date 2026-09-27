import type { Job } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";

export type EnqueueOptions = {
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  /** Jobs with the same dedupe key are only enqueued once. */
  dedupeKey?: string;
  organizationId?: string | null;
  workspaceId?: string | null;
};

/**
 * PostgreSQL-backed job queue (FOR UPDATE SKIP LOCKED).
 * - at-least-once delivery; handlers must be idempotent
 * - exponential backoff with jitter; DEAD after maxAttempts (dead-letter)
 * - stale RUNNING jobs (crashed worker) are recovered automatically
 *
 * The interface is intentionally small so it can be swapped for BullMQ/SQS.
 */
export interface JobQueue {
  enqueue(type: string, payload: Record<string, unknown>, opts?: EnqueueOptions): Promise<Job>;
  claim(workerId: string, limit: number): Promise<Job[]>;
  complete(job: Job, result?: unknown, durationMs?: number): Promise<void>;
  fail(job: Job, error: unknown, durationMs?: number): Promise<"retrying" | "dead">;
  recoverStale(olderThanMs: number): Promise<number>;
}

export function backoffMs(attempt: number) {
  const base = Math.min(30_000 * 2 ** (attempt - 1), 60 * 60_000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

class PostgresJobQueue implements JobQueue {
  async enqueue(type: string, payload: Record<string, unknown>, opts: EnqueueOptions = {}) {
    const data = {
      type,
      payload: payload as Prisma.InputJsonValue,
      runAt: opts.runAt ?? new Date(),
      priority: opts.priority ?? 0,
      maxAttempts: opts.maxAttempts ?? 3,
      dedupeKey: opts.dedupeKey,
      organizationId: opts.organizationId ?? null,
      workspaceId: opts.workspaceId ?? null,
    };
    if (!opts.dedupeKey) return db.job.create({ data });
    try {
      return await db.job.create({ data });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return (await db.job.findUnique({ where: { dedupeKey: opts.dedupeKey } }))!;
      }
      throw err;
    }
  }

  async claim(workerId: string, limit: number) {
    return db.$queryRaw<Job[]>`
      UPDATE "jobs" SET "status" = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "jobs"
        WHERE "status" IN ('QUEUED', 'RETRYING') AND "runAt" <= now()
        ORDER BY "priority" DESC, "runAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *`;
  }

  async complete(job: Job, result?: unknown, durationMs?: number) {
    await db.$transaction([
      db.job.update({
        where: { id: job.id },
        data: { status: "COMPLETED", finishedAt: new Date(), lockedAt: null, lockedBy: null, result: (result ?? null) as Prisma.InputJsonValue },
      }),
      db.jobRun.create({ data: { jobId: job.id, attempt: job.attempts, status: "COMPLETED", durationMs, finishedAt: new Date() } }),
    ]);
  }

  async fail(job: Job, error: unknown, durationMs?: number) {
    const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 2000);
    const permanent = error instanceof PermanentJobError;
    const dead = permanent || job.attempts >= job.maxAttempts;
    await db.$transaction([
      db.job.update({
        where: { id: job.id },
        data: {
          status: dead ? "DEAD" : "RETRYING",
          lastError: message,
          lockedAt: null,
          lockedBy: null,
          runAt: dead ? job.runAt : new Date(Date.now() + backoffMs(job.attempts)),
          finishedAt: dead ? new Date() : null,
        },
      }),
      db.jobRun.create({ data: { jobId: job.id, attempt: job.attempts, status: "FAILED", error: message, durationMs, finishedAt: new Date() } }),
    ]);
    return dead ? "dead" : "retrying";
  }

  async recoverStale(olderThanMs: number) {
    const cutoff = new Date(Date.now() - olderThanMs);
    const res = await db.job.updateMany({
      where: { status: "RUNNING", lockedAt: { lt: cutoff } },
      data: { status: "RETRYING", lockedAt: null, lockedBy: null, lastError: "Recovered after worker timeout" },
    });
    return res.count;
  }
}

/** Throw from a handler to skip retries (bad input, missing entity, revoked access). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export const queue: JobQueue = new PostgresJobQueue();

export function enqueue(type: string, payload: Record<string, unknown>, opts?: EnqueueOptions) {
  return queue.enqueue(type, payload, opts);
}
