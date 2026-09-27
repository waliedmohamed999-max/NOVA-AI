/**
 * Standalone background worker: `npm run worker`.
 * Processes the job queue and the database-backed scheduler.
 */
import "dotenv/config";

async function main() {
  process.env.NOVA_PROCESS ??= "worker";
  const { startWorker } = await import("../server/jobs/runner");
  await startWorker();
  process.exit(0);
}

void main();
