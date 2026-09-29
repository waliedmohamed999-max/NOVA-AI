import { registerJob, registeredJobTypes, scopeOf } from "./registry";
import { db } from "../db/client";
import { ingestSource } from "../knowledge/service";
import { runImport } from "../brain/imports";
import { registerAgentJobs } from "../agents/jobs";
import { publishDue } from "../social/publishing";
import { syncAll, syncIntegration, notifyInsight } from "../social/sync";
import { checkConnectionsHealth, refreshExpiringTokens } from "../integrations/service";
import { dueWorkspaces, generateDailyBrief, generateWeeklyReport } from "../reports/service";
import { analyzePost } from "../agents/workflows/analyst";
import { startRun } from "../agents/runtime";
import { CONTENT_PLAN_STEPS } from "../agents/workflows/content";
import { notify } from "../notifications/service";
import { deleteOrganization, exportOrganization } from "../privacy/service";
import { enqueue } from "./queue";

let registered = false;

/** Registers every job handler once per process. */
export function registerAllJobs() {
  if (registered) return;
  registered = true;

  registerAgentJobs();

  registerJob("knowledge.ingest", async (p) => ingestSource(scopeOf(p), String(p.sourceId)));
  registerJob("brain.import", async (p) => runImport(scopeOf(p), String(p.importId)));

  // WhatsApp: reply policy per inbound message, inbound media download, campaign batches.
  registerJob("whatsapp.reply", async (p) => (await import("../whatsapp/replies")).handleReply(scopeOf(p), String(p.messageId)));
  registerJob("whatsapp.media", async (p) => (await import("../whatsapp/service")).storeInboundMedia(scopeOf(p), String(p.messageId), String(p.mediaId), p.filename ? String(p.filename) : null));
  registerJob("whatsapp.campaign_batch", async (p) => (await import("../whatsapp/campaigns")).runCampaignBatch(scopeOf(p), String(p.campaignId)));

  // Social
  registerJob("social.publish_due", async () => publishDue());
  registerJob("social.sync_all", async () => syncAll());
  registerJob("social.sync_integration", async (p) => syncIntegration(String(p.integrationId)));
  registerJob("integrations.refresh_tokens", async () => refreshExpiringTokens());
  // Content studio: one image (design / variant / edit) per job; statuses live on content_assets.
  registerJob("ai.image.generate", async (p, { job }) => {
    const { runImageJob } = await import("../studio/images");
    return runImageJob(String(p.assetId), job.attempts, job.maxAttempts);
  });
  registerJob("integrations.health_check", async () => checkConnectionsHealth());
  registerJob("analytics.analyze_post", async (p) => {
    const scope = scopeOf(p);
    const res = await analyzePost(scope, String(p.socialPostId), { ...scope, agentKey: "PERFORMANCE_ANALYST" });
    const big = res?.comparisons.find((c) => c.metric === "engagementRate" && Math.abs(c.change) >= 0.2);
    if (res && big) await notifyInsight(scope, res.insight.headline, `/analytics/posts/${String(p.socialPostId)}`);
    return res ? { insightId: res.id } : { skipped: true };
  });

  // Reports
  registerJob("reports.daily_briefs", async () => {
    const due = await dueWorkspaces("DAILY_BRIEF");
    for (const s of due) await enqueue("reports.daily_brief", s, { ...s, dedupeKey: `brief:${s.workspaceId}:${new Date().toISOString().slice(0, 10)}` });
    return { queued: due.length };
  });
  registerJob("reports.daily_brief", async (p) => generateDailyBrief(scopeOf(p)).then((r) => ({ reportId: r.id })));
  registerJob("reports.weekly_reports", async () => {
    const due = await dueWorkspaces("WEEKLY_REPORT");
    for (const s of due) await enqueue("reports.weekly_report", s, { ...s, dedupeKey: `weekly:${s.workspaceId}:${new Date().toISOString().slice(0, 10)}` });
    return { queued: due.length };
  });
  registerJob("reports.weekly_report", async (p) => generateWeeklyReport(scopeOf(p)).then((r) => ({ reportId: r.id })));

  // Sales
  registerJob("sales.followups_due", async () => {
    const now = new Date();
    // Each reminder fires once (remindedAt), no matter how late the scheduler runs.
    const due = await db.salesActivity.findMany({
      where: { completedAt: null, remindedAt: null, dueAt: { lte: now } },
      include: { lead: true },
      take: 500,
    });
    for (const a of due) {
      const claimed = await db.salesActivity.updateMany({ where: { id: a.id, remindedAt: null }, data: { remindedAt: now } });
      if (claimed.count !== 1) continue;
      await notify({
        organizationId: a.organizationId,
        workspaceId: a.workspaceId,
        type: "FOLLOW_UP_DUE",
        title: `Follow-up due: ${a.lead.name}`,
        body: a.title,
        link: `/leads/${a.leadId}`,
        ...(a.lead.ownerId ? { userIds: [a.lead.ownerId] } : {}),
      });
    }
    return { notified: due.length };
  });

  // Recurring agent work
  registerJob("agent.weekly_plan", async (p) => {
    const scope = scopeOf(p);
    const run = await startRun(scope, { kind: "content_plan", agent: "CONTENT_STRATEGIST", steps: CONTENT_PLAN_STEPS, input: "Prepare next week's content", params: { count: 5 } });
    return { runId: run.id };
  });

  // Privacy
  registerJob("privacy.export", async (p) => exportOrganization(String(p.organizationId), String(p.exportId)));
  registerJob("privacy.delete_org", async (p) => deleteOrganization(String(p.organizationId), String(p.actorId)));

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
}

export { registeredJobTypes };
