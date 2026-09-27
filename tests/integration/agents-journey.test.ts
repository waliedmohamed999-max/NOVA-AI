import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { queue, enqueue } from "@/server/jobs/queue";
import { runJob, tickScheduler, ensureSystemSchedules } from "@/server/jobs/runner";
import { registerAllJobs } from "@/server/jobs/handlers";
import { registerJob } from "@/server/jobs/registry";
import { executeRun, startRun } from "@/server/agents/runtime";
import "@/server/agents/jobs";
import { ONBOARDING_STEPS } from "@/server/agents/workflows/onboarding";
import { CONTENT_PLAN_STEPS } from "@/server/agents/workflows/content";
import { approveContent, editContent, rejectContent } from "@/server/content/service";
import { createLead, moveLeadStage } from "@/server/sales/service";
import { getBudgetStatus } from "@/server/ai/budget";
import { aiStructured, AiError } from "@/server/ai";
import { z } from "zod";

registerAllJobs();

describe("job queue", () => {
  it("dedupes, retries with backoff, and dead-letters", async () => {
    let calls = 0;
    registerJob("test.flaky", async () => {
      calls++;
      throw new Error("boom");
    });
    const a = await enqueue("test.flaky", {}, { dedupeKey: "flaky-1", maxAttempts: 2 });
    const b = await enqueue("test.flaky", {}, { dedupeKey: "flaky-1", maxAttempts: 2 });
    expect(b.id).toBe(a.id);

    const [claimed] = await queue.claim("w1", 50).then((js) => js.filter((j) => j.id === a.id));
    await runJob(claimed);
    let job = await db.job.findUniqueOrThrow({ where: { id: a.id } });
    expect(job.status).toBe("RETRYING");
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now());

    await db.job.update({ where: { id: a.id }, data: { runAt: new Date() } });
    const [again] = await queue.claim("w1", 50).then((js) => js.filter((j) => j.id === a.id));
    await runJob(again);
    job = await db.job.findUniqueOrThrow({ where: { id: a.id } });
    expect(job.status).toBe("DEAD");
    expect(calls).toBe(2);
    expect(await db.jobRun.count({ where: { jobId: a.id } })).toBe(2);
  });

  it("claims each job only once across workers", async () => {
    registerJob("test.noop", async () => "ok");
    await Promise.all(Array.from({ length: 6 }, () => enqueue("test.noop", {})));
    const [w1, w2] = await Promise.all([queue.claim("w1", 4), queue.claim("w2", 4)]);
    const ids = [...w1, ...w2].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    await Promise.all([...w1, ...w2].map(runJob));
  });

  it("scheduler enqueues due schedules exactly once", async () => {
    await ensureSystemSchedules();
    await db.scheduledJob.updateMany({ data: { nextRunAt: new Date(Date.now() - 1000) } });
    const first = await tickScheduler();
    const second = await tickScheduler();
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    await db.job.deleteMany({ where: { type: { in: ["social.publish_due", "sales.followups_due", "social.sync_all", "integrations.refresh_tokens", "reports.daily_briefs", "reports.weekly_reports", "system.cleanup"] } } });
  });
});

describe("first user journey (offline AI)", () => {
  it("onboards, plans content, approves, and qualifies a lead", async () => {
    const t = await makeTenant("Bloom Bakery");
    await db.organization.update({
      where: { id: t.organization.id },
      data: {
        onboardingData: {
          description: "Artisan bakery making sourdough and custom celebration cakes.",
          sells: "Bread, pastries and custom cakes",
          offerings: ["Sourdough", "Celebration cakes", "Catering"],
          customers: "Local families and offices ordering for events",
          customerType: "BOTH",
          tone: ["Warm", "Playful"],
          goals: ["Get more customers", "Generate leads"],
        },
      },
    });

    // Onboarding analysis → Company Brain
    const onboarding = await startRun(t.scope, { kind: "onboarding_analysis", agent: "SOCIAL_MANAGER", steps: ONBOARDING_STEPS });
    await executeRun(t.scope, onboarding.id);
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: onboarding.id } });
    expect(run.status).toBe("COMPLETED");
    expect((run.steps as { status: string }[]).every((s) => s.status === "done")).toBe(true);
    const org = await db.organization.findUniqueOrThrow({ where: { id: t.organization.id } });
    expect(org.onboardingStatus).toBe("COMPLETED");
    const profile = await db.companyProfile.findFirstOrThrow({ where: t.scope });
    expect(profile.summary).toContain("sourdough");
    expect(profile.contentPillars.length).toBeGreaterThanOrEqual(3);
    expect(await db.offering.count({ where: t.scope })).toBe(3);
    expect((await db.brandKit.findFirstOrThrow({ where: t.scope })).voiceTraits).toContain("Warm");

    // Every AI call is logged with provider/model/cost
    const aiRuns = await db.aiRun.findMany({ where: { organizationId: t.organization.id } });
    expect(aiRuns.length).toBeGreaterThan(0);
    expect(aiRuns.every((r) => r.provider === "offline" && r.status === "SUCCESS")).toBe(true);

    // Weekly plan → drafts awaiting approval
    const plan = await startRun(t.scope, { kind: "content_plan", agent: "CONTENT_STRATEGIST", steps: CONTENT_PLAN_STEPS, input: "Create 5 posts for next week", params: { count: 5 } });
    await executeRun(t.scope, plan.id);
    const items = await db.contentItem.findMany({ where: t.scope });
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.status === "PENDING_APPROVAL" && i.scheduledAt && i.designBrief)).toBe(true);
    expect(await db.approval.count({ where: { ...t.scope, category: "CONTENT", status: "PENDING" } })).toBe(5);
    const planRun = await db.agentRun.findUniqueOrThrow({ where: { id: plan.id } });
    expect((planRun.result as { type: string }).type).toBe("content_plan");

    // Edit creates a new version; approve schedules; reject closes approval
    await editContent(t.scope, items[0].id, { caption: "Fresh sourdough every morning." }, { userId: t.user.id });
    expect(await db.contentVersion.count({ where: { contentItemId: items[0].id } })).toBe(2);
    const approved = await approveContent(t.scope, items.slice(0, 4).map((i) => i.id), { userId: t.user.id, label: "Owner" });
    expect(approved).toHaveLength(4);
    const scheduled = await db.contentItem.findMany({ where: { id: { in: approved } } });
    expect(scheduled.every((i) => i.status === "SCHEDULED")).toBe(true);
    expect(await db.socialPublication.count({ where: { contentItemId: { in: approved }, status: "PENDING" } })).toBe(4);
    await rejectContent(t.scope, items[4].id, { userId: t.user.id }, "Off brand");
    expect(await db.approval.count({ where: { ...t.scope, category: "CONTENT", status: "PENDING" } })).toBe(0);

    // Lead → Sales Agent qualification → drafted reply + follow-up
    const lead = await createLead(
      t.scope,
      { name: "Nora Haddad", company: "Haddad Events", email: "nora@haddadevents.com", channel: "WEBSITE", source: "Website form", message: "Hi! Can you send a quote for 3 celebration cakes for an event next week? It's urgent." },
      { type: "SYSTEM", label: "Website form" },
      { qualify: false },
    );
    const qualify = await startRun(t.scope, { kind: "lead_qualify", agent: "SALES_AGENT", steps: [], params: { leadId: lead.id } });
    await executeRun(t.scope, qualify.id);
    const qualified = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(qualified.temperature).toBe("HOT");
    expect(qualified.stage).toBe("QUALIFIED");
    expect(qualified.nextAction).toBeTruthy();
    const events = await db.leadEvent.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["CREATED", "MESSAGE_RECEIVED", "AI_ANALYSIS", "STATUS_CHANGE", "FOLLOW_UP"]));
    const outbound = await db.message.findMany({ where: { conversation: { leadId: lead.id }, direction: "OUTBOUND" } });
    expect(outbound).toHaveLength(1);
    expect(outbound[0].status).not.toBe("SENT"); // no email channel configured → never pretends to send
    expect(await db.notification.count({ where: { organizationId: t.organization.id, type: "HOT_OPPORTUNITY" } })).toBeGreaterThan(0);

    await moveLeadStage(t.scope, lead.id, "WON", { type: "USER", id: t.user.id });
    expect((await db.leadEvent.findMany({ where: { leadId: lead.id, type: "STATUS_CHANGE" } })).length).toBe(2);

    // Command routing: one sentence → the right workflow
    const cmd = await startRun(t.scope, { kind: "command", agent: "SOCIAL_MANAGER", steps: ["understanding_goal"], input: "Create a launch campaign for our catering service" });
    await executeRun(t.scope, cmd.id);
    const cmdRun = await db.agentRun.findUniqueOrThrow({ where: { id: cmd.id } });
    expect(cmdRun.status).toBe("COMPLETED");
    expect((cmdRun.result as { type: string }).type).toBe("campaign");
    const campaign = await db.campaign.findFirstOrThrow({ where: t.scope });
    expect(campaign.status).toBe("PENDING_APPROVAL");
    expect(await db.contentItem.count({ where: { campaignId: campaign.id } })).toBeGreaterThanOrEqual(5);
  });
});

describe("AI cost control", () => {
  it("blocks AI calls when the hard limit is reached", async () => {
    const t = await makeTenant();
    await db.aiBudget.update({ where: { organizationId: t.organization.id }, data: { monthlyAllowanceMicro: 100n } });
    const period = (await getBudgetStatus(t.organization.id)).period;
    await db.aiUsage.create({ data: { organizationId: t.organization.id, period, agentKey: "none", costMicro: 200n } });
    expect((await getBudgetStatus(t.organization.id)).state).toBe("exhausted");
    await expect(aiStructured({ organizationId: t.organization.id }, { task: "SUMMARIZATION", schema: z.object({ a: z.string() }), schemaName: "x", prompt: "hi" })).rejects.toBeInstanceOf(AiError);
    const blocked = await db.aiRun.findFirst({ where: { organizationId: t.organization.id, status: "BLOCKED" } });
    expect(blocked).not.toBeNull();
  });
});
