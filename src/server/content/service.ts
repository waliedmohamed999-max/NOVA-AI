import { Prisma } from "@/generated/prisma/client";
import type { AgentKey, ContentStatus } from "@/generated/prisma/enums";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { UserFacingError, NotFoundError } from "../errors";
import { audit } from "../audit";
import { notify } from "../notifications/service";
import type { PlannedPost } from "../agents/schemas";

/** Allowed status transitions. Anything else is rejected server-side. */
export const CONTENT_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  IDEA: ["DRAFT", "PENDING_APPROVAL", "REJECTED"],
  DRAFT: ["PENDING_APPROVAL", "APPROVED", "REJECTED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: ["SCHEDULED", "DRAFT", "PUBLISHING"],
  SCHEDULED: ["APPROVED", "PUBLISHING", "DRAFT"],
  PUBLISHING: ["PUBLISHED", "FAILED"],
  PUBLISHED: [],
  FAILED: ["SCHEDULED", "APPROVED", "DRAFT"],
  REJECTED: ["DRAFT", "PENDING_APPROVAL"],
};

export function canTransition(from: ContentStatus, to: ContentStatus) {
  return from === to || CONTENT_TRANSITIONS[from].includes(to);
}

type Actor = { userId?: string | null; agent?: AgentKey | null; label?: string };

/** Converts a date offset + "HH:MM" into an absolute time starting from `start` (local midnight approximation in UTC). */
export function scheduleFrom(start: Date, dayOffset: number, time: string) {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + dayOffset, h, m));
  return d;
}

/**
 * Materializes an AI plan into draft content awaiting approval. Every item
 * gets version 1, a design brief, and one approval request.
 */
export async function createContentFromPlan(
  scope: TenantScope,
  posts: PlannedPost[],
  opts: { campaignId?: string | null; agent: AgentKey; startDate: Date; generatedBy: string; requestedById?: string | null },
) {
  const settings = await db.workspaceSettings.findFirst({ where: scope });
  const requireApproval = settings?.requireContentApproval ?? true;
  return db.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const p of posts) {
      const scheduledAt = scheduleFrom(opts.startDate, p.dayOffset, p.time);
      const item = await tx.contentItem.create({
        data: {
          ...scope,
          campaignId: opts.campaignId ?? null,
          platform: p.platform,
          format: p.format,
          status: requireApproval ? "PENDING_APPROVAL" : "APPROVED",
          title: p.title.slice(0, 200),
          pillar: p.pillar.slice(0, 80),
          hook: p.hook,
          caption: p.caption,
          cta: p.cta,
          hashtags: p.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)),
          designBrief: p.designBrief as Prisma.InputJsonValue,
          aiRationale: p.rationale,
          scheduledAt,
          authorAgent: opts.agent,
          versions: {
            create: {
              organizationId: scope.organizationId,
              workspaceId: scope.workspaceId,
              version: 1,
              hook: p.hook,
              caption: p.caption,
              cta: p.cta,
              hashtags: p.hashtags,
              designBrief: p.designBrief as Prisma.InputJsonValue,
              createdByAgent: opts.agent,
              changeNote: opts.generatedBy,
            },
          },
          approvals: {
            create: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, action: "SUBMITTED", comment: opts.generatedBy, version: 1 },
          },
        },
      });
      ids.push(item.id);
      if (requireApproval) {
        await tx.approval.create({
          data: {
            ...scope,
            category: "CONTENT",
            action: "publish_content",
            title: p.title.slice(0, 200),
            summary: p.hook,
            reason: p.rationale,
            impact: null,
            entityType: "ContentItem",
            entityId: item.id,
            requestedByAgent: opts.agent,
            requestedById: opts.requestedById ?? null,
            payload: { platform: p.platform, format: p.format, scheduledAt: scheduledAt.toISOString() },
          },
        });
      }
    }
    return ids;
  });
}

async function loadItem(scope: TenantScope, id: string) {
  const item = await tenantDb(scope).contentItem.findUnique({ where: { id } });
  if (!item) throw new NotFoundError("content");
  return item;
}

async function closeApprovals(scope: TenantScope, contentId: string, status: "APPROVED" | "REJECTED", decidedById: string | null, note?: string) {
  await tenantDb(scope).approval.updateMany({
    where: { entityType: "ContentItem", entityId: contentId, status: "PENDING" },
    data: { status, decidedById, decidedAt: new Date(), decisionNote: note ?? null },
  });
}

/** Approve one or many items. Approved items with a future time move straight into the schedule. */
export async function approveContent(scope: TenantScope, ids: string[], actor: Actor) {
  const t = tenantDb(scope);
  const items = await t.contentItem.findMany({ where: { id: { in: ids } } });
  const approved: string[] = [];
  for (const item of items) {
    if (!canTransition(item.status, "APPROVED")) continue;
    const next: ContentStatus = item.scheduledAt && item.scheduledAt > new Date() ? "SCHEDULED" : "APPROVED";
    await t.contentItem.update({ where: { id: item.id }, data: { status: next } });
    await t.contentApproval.create({
      data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, contentItemId: item.id, action: "APPROVED", userId: actor.userId ?? null, version: item.currentVersion },
    });
    await closeApprovals(scope, item.id, "APPROVED", actor.userId ?? null);
    if (next === "SCHEDULED") await ensurePublication(scope, item.id, item.platform, item.scheduledAt!);
    approved.push(item.id);
  }
  if (approved.length) {
    await audit({
      ...scope,
      actorType: actor.userId ? "USER" : "AGENT",
      actorId: actor.userId,
      actorLabel: actor.label,
      action: "content.approved",
      entityType: "ContentItem",
      entityId: approved.length === 1 ? approved[0] : undefined,
      summary: `${actor.label ?? "A user"} approved ${approved.length} post${approved.length > 1 ? "s" : ""}`,
      metadata: { ids: approved },
    });
  }
  return approved;
}

export async function rejectContent(scope: TenantScope, id: string, actor: Actor, comment?: string) {
  const item = await loadItem(scope, id);
  if (!canTransition(item.status, "REJECTED")) throw new UserFacingError("invalid_transition");
  const t = tenantDb(scope);
  await t.contentItem.update({ where: { id }, data: { status: "REJECTED", scheduledAt: item.scheduledAt } });
  await t.contentApproval.create({
    data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, contentItemId: id, action: "REJECTED", comment: comment ?? null, userId: actor.userId ?? null, version: item.currentVersion },
  });
  await closeApprovals(scope, id, "REJECTED", actor.userId ?? null, comment);
  await cancelPublications(scope, id);
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "content.rejected", entityType: "ContentItem", entityId: id, summary: `${actor.label ?? "A user"} rejected "${item.title}"` });
}

export async function commentOnContent(scope: TenantScope, id: string, actor: Actor, comment: string) {
  const item = await loadItem(scope, id);
  await tenantDb(scope).contentApproval.create({
    data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, contentItemId: id, action: "COMMENTED", comment, userId: actor.userId ?? null, version: item.currentVersion },
  });
}

/** Edits create a new immutable version; the item returns to approval when approval is required. */
export async function editContent(
  scope: TenantScope,
  id: string,
  patch: { hook?: string | null; caption?: string; cta?: string | null; hashtags?: string[]; title?: string },
  actor: Actor & { changeNote?: string },
) {
  const item = await loadItem(scope, id);
  if (item.status === "PUBLISHED" || item.status === "PUBLISHING") throw new UserFacingError("invalid_transition");
  const t = tenantDb(scope);
  const version = item.currentVersion + 1;
  const next = {
    hook: patch.hook !== undefined ? patch.hook : item.hook,
    caption: patch.caption ?? item.caption,
    cta: patch.cta !== undefined ? patch.cta : item.cta,
    hashtags: patch.hashtags ?? item.hashtags,
  };
  await t.contentVersion.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      contentItemId: id,
      version,
      ...next,
      designBrief: (item.designBrief ?? undefined) as Prisma.InputJsonValue | undefined,
      createdById: actor.userId ?? null,
      createdByAgent: actor.agent ?? null,
      changeNote: actor.changeNote ?? null,
    },
  });
  const settings = await db.workspaceSettings.findFirst({ where: scope });
  const backToApproval = actor.agent && (settings?.requireContentApproval ?? true);
  const status: ContentStatus = item.status === "REJECTED" ? "DRAFT" : backToApproval ? "PENDING_APPROVAL" : item.status;
  await t.contentItem.update({ where: { id }, data: { ...next, title: patch.title ?? item.title, currentVersion: version, status } });
  return version;
}

export async function scheduleContent(scope: TenantScope, id: string, at: Date, actor: Actor) {
  const item = await loadItem(scope, id);
  if (item.status === "PUBLISHED" || item.status === "PUBLISHING") throw new UserFacingError("invalid_transition");
  const t = tenantDb(scope);
  const approvedLike = ["APPROVED", "SCHEDULED", "FAILED"].includes(item.status);
  await t.contentItem.update({ where: { id }, data: { scheduledAt: at, status: approvedLike ? (at > new Date() ? "SCHEDULED" : "APPROVED") : item.status } });
  await cancelPublications(scope, id);
  if (approvedLike && at > new Date()) await ensurePublication(scope, id, item.platform, at);
  await audit({ ...scope, actorType: actor.userId ? "USER" : "AGENT", actorId: actor.userId, actorLabel: actor.label, action: "content.scheduled", entityType: "ContentItem", entityId: id, summary: `"${item.title}" scheduled for ${at.toISOString()}` });
}

async function ensurePublication(scope: TenantScope, contentItemId: string, platform: PlannedPost["platform"] | string, at: Date) {
  const t = tenantDb(scope);
  const integration = await t.integration.findFirst({ where: { provider: platform as never, status: "CONNECTED" }, include: { accounts: { where: { isActive: true }, take: 1 } } });
  await t.socialPublication.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      contentItemId,
      integrationAccountId: integration?.accounts[0]?.id ?? null,
      platform: platform as never,
      scheduledFor: at,
      status: "PENDING",
    },
  });
}

async function cancelPublications(scope: TenantScope, contentItemId: string) {
  await tenantDb(scope).socialPublication.updateMany({ where: { contentItemId, status: "PENDING" }, data: { status: "CANCELLED" } });
}

export async function notifyContentReady(scope: TenantScope, count: number, link: string, lang: "en" | "ar") {
  await notify({
    ...scope,
    type: "APPROVAL_NEEDED",
    title: lang === "ar" ? `${count} منشورات جاهزة لمراجعتك` : `${count} post${count === 1 ? " is" : "s are"} ready for your review`,
    link,
  });
}
