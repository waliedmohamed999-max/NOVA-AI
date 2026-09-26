import { db } from "./db/client";

export type RateLimitResult = { ok: boolean; remaining: number; resetAt: Date };

/**
 * Fixed-window rate limiter backed by PostgreSQL so limits hold across
 * multiple app instances. A single atomic upsert per check.
 * Swap for Redis (INCR + EXPIRE) at very high traffic.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const rows = await db.$queryRaw<{ count: number; window_end: Date }[]>`
    INSERT INTO "rate_limit_buckets" ("key", "count", "windowEnd")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rate_limit_buckets"."windowEnd" < now() THEN 1 ELSE "rate_limit_buckets"."count" + 1 END,
      "windowEnd" = CASE WHEN "rate_limit_buckets"."windowEnd" < now()
        THEN now() + make_interval(secs => ${windowSeconds}) ELSE "rate_limit_buckets"."windowEnd" END
    RETURNING "count", "windowEnd" AS window_end
  `;
  const row = rows[0];
  return { ok: row.count <= limit, remaining: Math.max(0, limit - row.count), resetAt: row.window_end };
}

export class RateLimitError extends Error {
  constructor(public resetAt: Date) {
    super("Too many requests");
    this.name = "RateLimitError";
  }
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const res = await rateLimit(key, limit, windowSeconds);
  if (!res.ok) throw new RateLimitError(res.resetAt);
  return res;
}
