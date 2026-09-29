import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { queue, enqueue } from "@/server/jobs/queue";
import { runJob, heartbeat, JOB_TIMEOUTS, jobTimeoutMs } from "@/server/jobs/runner";
import { registerJob } from "@/server/jobs/registry";
import { reconcileStuck, STUCK_PUBLISH_MS, STUCK_SEND_MS } from "@/server/jobs/reconcile";
import { checkDatabase, checkWorker, readiness, resetHealthCaches } from "@/server/health";
import { createLead } from "@/server/sales/service";

const ago = (ms: number) => new Date(Date.now() - ms);

describe("job timeouts", () => {
  it("a hung handler fails with a timeout instead of holding the worker forever", async () => {
    JOB_TIMEOUTS["test.hang"] = 150;
    expect(jobTimeoutMs("test.hang")).toBe(150);
    registerJob("test.hang", () => new Promise(() => undefined));
    const j = await enqueue("test.hang", {}, { maxAttempts: 1, priority: 1000 });
    const [claimed] = await queue.claim("w-timeout", 50).then((js) => js.filter((x) => x.id === j.id));
    const started = Date.now();
    await runJob(claimed);
    expect(Date.now() - started).toBeLessThan(5_000);
    const job = await db.job.findUniqueOrThrow({ where: { id: j.id } });
    expect(job.status).toBe("DEAD");
    expect(job.lastError).toMatch(/JobTimeoutError: Job test.hang exceeded its 150ms time limit/);
  });

  it("falls back to JOB_TIMEOUT_MS / 5 minutes for unlisted job types", () => {
    const prev = process.env.JOB_TIMEOUT_MS;
    delete process.env.JOB_TIMEOUT_MS;
    expect(jobTimeoutMs("test.unlisted")).toBe(5 * 60_000);
    process.env.JOB_TIMEOUT_MS = "1234";
    expect(jobTimeoutMs("test.unlisted")).toBe(1234);
    if (prev === undefined) delete process.env.JOB_TIMEOUT_MS;
    else process.env.JOB_TIMEOUT_MS = prev;
  });
});

describe("reconciliation of interrupted external actions", () => {
  it("marks stuck publications and campaign sends as outcome-unknown and never re-queues them", async () => {
    const t = await makeTenant("Reconcile Co");
    const item = await db.contentItem.create({ data: { ...t.scope, title: "Launch post", caption: "x", format: "POST", platform: "LINKEDIN", status: "PUBLISHING" } });
    const stuckPub = await db.socialPublication.create({ data: { ...t.scope, contentItemId: item.id, platform: "LINKEDIN", status: "PUBLISHING", scheduledFor: ago(STUCK_PUBLISH_MS * 2) } });
    const freshItem = await db.contentItem.create({ data: { ...t.scope, title: "Fresh post", caption: "x", format: "POST", platform: "LINKEDIN", status: "PUBLISHING" } });
    const freshPub = await db.socialPublication.create({ data: { ...t.scope, contentItemId: freshItem.id, platform: "LINKEDIN", status: "PUBLISHING", scheduledFor: new Date() } });
    // updatedAt is @updatedAt — backdate it with raw SQL.
    await db.$executeRaw`UPDATE "social_publications" SET "updatedAt" = ${ago(STUCK_PUBLISH_MS + 60_000)} WHERE id = ${stuckPub.id}`;

    const lead = await createLead(t.scope, { name: "Stuck Recipient", phone: "+966501119999" }, { type: "SYSTEM", label: "t" }, { qualify: false });
    const campaign = await db.campaign.create({ data: { ...t.scope, name: "Promo", objective: "sales", channel: "whatsapp", waState: "SENDING" } });
    const rec = await db.campaignRecipient.create({ data: { ...t.scope, campaignId: campaign.id, leadId: lead.id, phone: "966501119999", status: "SENDING" } });
    await db.$executeRaw`UPDATE "campaign_recipients" SET "updatedAt" = ${ago(STUCK_SEND_MS + 60_000)} WHERE id = ${rec.id}`;

    const out = await reconcileStuck();
    expect(out.publications).toBeGreaterThanOrEqual(1);
    expect(out.recipients).toBeGreaterThanOrEqual(1);

    const p = await db.socialPublication.findUniqueOrThrow({ where: { id: stuckPub.id } });
    expect(p.status).toBe("FAILED");
    expect(p.error).toBe("publish_outcome_unknown");
    expect((await db.contentItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("FAILED");
    expect((await db.socialPublication.findUniqueOrThrow({ where: { id: freshPub.id } })).status).toBe("PUBLISHING");

    const r = await db.campaignRecipient.findUniqueOrThrow({ where: { id: rec.id } });
    expect(r.status).toBe("FAILED");
    expect(r.error).toBe("outcome_unknown");

    // Nothing was retried: no publish/send job was enqueued for these rows.
    expect(await db.job.count({ where: { type: { startsWith: "content.publish" }, payload: { path: ["publicationId"], equals: stuckPub.id } } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: stuckPub.id, action: "content.publish_outcome_unknown" } })).toBe(1);

    // Idempotent: a second pass changes nothing for these rows.
    await reconcileStuck();
    expect(await db.auditLog.count({ where: { entityId: stuckPub.id, action: "content.publish_outcome_unknown" } })).toBe(1);
  });
});

describe("health and readiness", () => {
  it("database check is ok against the test database", async () => {
    expect((await checkDatabase()).status).toBe("ok");
  });

  it("worker check follows the heartbeat", async () => {
    await db.workerHeartbeat.deleteMany({});
    expect((await checkWorker()).status).toBe("degraded");
    await heartbeat("w-health", { force: true });
    expect((await checkWorker()).status).toBe("ok");
    expect((await checkWorker(Date.now() + 10 * 60_000)).status).toBe("degraded");
    await db.workerHeartbeat.deleteMany({ where: { workerId: "w-health" } });
  });

  it("readiness never reports fail in development with a working database", async () => {
    resetHealthCaches();
    const r = await readiness();
    expect(r.checks.database.status).toBe("ok");
    expect(r.status).not.toBe("fail");
  });
});
