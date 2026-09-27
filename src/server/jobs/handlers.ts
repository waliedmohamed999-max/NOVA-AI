import { registerJob, registeredJobTypes, scopeOf } from "./registry";
import { db } from "../db/client";
import { ingestSource } from "../knowledge/service";
import { registerAgentJobs } from "../agents/jobs";

let registered = false;

/** Registers every job handler once per process. Feature handlers are imported here. */
export function registerAllJobs() {
  if (registered) return;
  registered = true;

  registerJob("knowledge.ingest", async (p) => ingestSource(scopeOf(p), String(p.sourceId)));

  registerJob("system.cleanup", async () => {
    const now = new Date();
    const [sessions, tokens, states, buckets, jobs] = await Promise.all([
      db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      db.verificationToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } }),
      db.oAuthState.deleteMany({ where: { expiresAt: { lt: now } } }),
      db.rateLimitBucket.deleteMany({ where: { windowEnd: { lt: now } } }),
      db.job.deleteMany({ where: { status: "COMPLETED", finishedAt: { lt: new Date(now.getTime() - 14 * 86_400_000) } } }),
    ]);
    return { sessions: sessions.count, tokens: tokens.count, states: states.count, buckets: buckets.count, jobs: jobs.count };
  });

  registerAgentJobs();
}

export { registeredJobTypes, scopeOf };
