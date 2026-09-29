/**
 * Standalone background worker: `npm run worker`.
 * Processes the job queue and the database-backed scheduler.
 */
import "dotenv/config";

async function main() {
  process.env.NOVA_PROCESS ??= "worker";
  (await import("../server/startup")).enforceStartupConfig("worker");
  const { startWorker } = await import("../server/jobs/runner");
  // Hard stop if the current batch doesn't finish within the grace period after SIGTERM/SIGINT.
  const grace = Number(process.env.WORKER_SHUTDOWN_GRACE_MS) || 30_000;
  for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => setTimeout(() => process.exit(1), grace).unref());
  await startWorker();
  process.exit(0);
}

void main();
