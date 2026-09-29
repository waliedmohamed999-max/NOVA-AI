import { db } from "./db/client";
import { storage } from "./storage";
import { validateConfig } from "./config/validate";

/**
 * Liveness vs readiness.
 * - liveness (/api/health): the process answers. No dependencies — never flaps because a dependency does.
 * - readiness (/api/ready): can this instance serve real traffic? Database (critical), configuration
 *   (critical), storage (critical when external), worker heartbeat (degraded only — web can still serve).
 * No paid APIs are called; the storage probe is one HEAD request cached for 5 minutes.
 */

export type CheckStatus = "ok" | "degraded" | "fail";
export type Check = { status: CheckStatus; detail?: string; ms?: number };

const WORKER_STALE_MS = 2 * 60_000;
let storageCache: { at: number; value: Check } | null = null;

async function timed<T>(fn: () => Promise<T>, timeoutMs: number): Promise<{ value?: T; error?: string; ms: number }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([fn(), new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("timeout")), timeoutMs)))]);
    return { value, ms: Date.now() - started };
  } catch (err) {
    return { error: err instanceof Error && err.message === "timeout" ? "timeout" : "error", ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkDatabase(): Promise<Check> {
  const r = await timed(() => db.$queryRaw`SELECT 1`, 2_000);
  return r.error ? { status: "fail", detail: r.error, ms: r.ms } : { status: "ok", ms: r.ms };
}

export async function checkWorker(now = Date.now()): Promise<Check> {
  const r = await timed(() => db.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }), 2_000);
  if (r.error) return { status: "degraded", detail: "heartbeat unreadable" };
  const last = r.value?.lastSeenAt?.getTime();
  if (!last) return { status: "degraded", detail: "no worker has reported yet" };
  const age = now - last;
  return age <= WORKER_STALE_MS ? { status: "ok", detail: `last seen ${Math.round(age / 1000)}s ago` } : { status: "degraded", detail: `last seen ${Math.round(age / 60_000)} min ago` };
}

export async function checkStorage(now = Date.now()): Promise<Check> {
  if (storageCache && now - storageCache.at < 5 * 60_000) return storageCache.value;
  const r = await timed(() => storage.check!(), 6_000);
  const value: Check = r.error ? { status: "fail", detail: r.error, ms: r.ms } : r.value!.ok ? { status: "ok", detail: storage.name, ms: r.ms } : { status: "fail", detail: r.value!.detail, ms: r.ms };
  storageCache = { at: now, value };
  return value;
}

export function checkConfig(): Check {
  const r = validateConfig();
  if (!r.ok) return { status: r.environment === "production" ? "fail" : "degraded", detail: `${r.errors.length} error(s): ${r.errors.map((e) => e.key).join(", ")}` };
  return { status: "ok", detail: r.environment };
}

export async function readiness() {
  const [database, worker, files] = await Promise.all([checkDatabase(), checkWorker(), checkStorage()]);
  const config = checkConfig();
  const checks = { database, config, storage: files, worker };
  const critical = [database, config, files];
  const status: CheckStatus = critical.some((c) => c.status === "fail") ? "fail" : Object.values(checks).some((c) => c.status !== "ok") ? "degraded" : "ok";
  return { status, checks };
}

/** Test hook. */
export function resetHealthCaches() {
  storageCache = null;
}
