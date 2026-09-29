import { db } from "../db/client";
import { logger } from "../logger";
import { audit } from "../audit";
import { notify } from "../notifications/service";

/**
 * Reconciliation for external actions interrupted by a crash (worker killed between "claimed" and
 * "provider answered"). We cannot know whether the provider performed the action, so these are NEVER
 * retried automatically — retrying could publish a post twice or message a customer twice. They are
 * marked "outcome unknown" and surfaced to a human to check on the platform.
 */
export const STUCK_PUBLISH_MS = 30 * 60_000;
export const STUCK_SEND_MS = 10 * 60_000;

export async function reconcileStuck(now = new Date()) {
  const out = { publications: 0, recipients: 0, heartbeats: 0 };

  // Social publications stuck in PUBLISHING.
  const pubs = await db.socialPublication.findMany({ where: { status: "PUBLISHING", updatedAt: { lt: new Date(now.getTime() - STUCK_PUBLISH_MS) } }, include: { contentItem: { select: { id: true, title: true } } }, take: 200 });
  for (const p of pubs) {
    const moved = await db.socialPublication.updateMany({ where: { id: p.id, status: "PUBLISHING" }, data: { status: "FAILED", error: "publish_outcome_unknown" } });
    if (!moved.count) continue;
    out.publications++;
    await db.contentItem.updateMany({ where: { id: p.contentItemId, status: "PUBLISHING" }, data: { status: "FAILED" } });
    const scope = { organizationId: p.organizationId, workspaceId: p.workspaceId };
    await notify({ ...scope, type: "PUBLISHING_FAILED", title: `Check "${p.contentItem.title}" on ${p.platform}`, body: "Publishing was interrupted. It may or may not have been posted — check the platform before retrying.", link: `/content/${p.contentItem.id}` }).catch(() => undefined);
    await audit({ ...scope, actorType: "SYSTEM", action: "content.publish_outcome_unknown", entityType: "SocialPublication", entityId: p.id, summary: `Publishing interrupted (${p.platform}); not retried automatically` });
  }

  // WhatsApp campaign recipients stuck in SENDING.
  const stuck = await db.campaignRecipient.updateMany({ where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - STUCK_SEND_MS) } }, data: { status: "FAILED", error: "outcome_unknown" } });
  out.recipients = stuck.count;

  // Heartbeats of workers gone for a day.
  out.heartbeats = (await db.workerHeartbeat.deleteMany({ where: { lastSeenAt: { lt: new Date(now.getTime() - 86_400_000) } } })).count;

  if (out.publications || out.recipients) logger.warn(out, "reconciled interrupted external actions (not retried)");
  return out;
}
