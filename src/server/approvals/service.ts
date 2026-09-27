import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { audit } from "../audit";
import { approveContent, rejectContent } from "../content/service";
import { approveCampaign, setCampaignStatus } from "../campaigns/service";
import { sendMessage } from "../sales/service";
import { channelFor } from "../sales/channels";
import type { Permission } from "../rbac";

type Actor = { userId: string; label: string };

/** Permission required to decide an approval of each category. */
export const APPROVAL_PERMISSION: Record<string, Permission> = {
  CONTENT: "content:approve",
  PUBLISHING: "content:publish",
  CAMPAIGNS: "campaign:manage",
  SALES: "sales:approve",
  PRICING: "sales:approve",
};

/** Applies the decision to the underlying entity, then closes the approval. */
export async function decideApproval(scope: TenantScope, id: string, decision: "APPROVED" | "REJECTED", actor: Actor, note?: string) {
  const t = tenantDb(scope);
  const approval = await t.approval.findUnique({ where: { id } });
  if (!approval) throw new NotFoundError();
  if (approval.status !== "PENDING") throw new UserFacingError("invalid_transition");
  let outcome: string = decision.toLowerCase();

  if (approval.entityType === "ContentItem" && approval.entityId) {
    if (decision === "APPROVED") await approveContent(scope, [approval.entityId], actor);
    else await rejectContent(scope, approval.entityId, actor, note);
  } else if (approval.entityType === "Campaign" && approval.entityId) {
    if (decision === "APPROVED") await approveCampaign(scope, approval.entityId, actor);
    else await setCampaignStatus(scope, approval.entityId, "DRAFT", actor);
  } else if (approval.entityType === "Message" && approval.entityId) {
    const msg = await t.message.findUnique({ where: { id: approval.entityId }, include: { conversation: true } });
    if (msg && decision === "APPROVED") {
      if (channelFor(msg.conversation.channel)?.isConfigured()) {
        await sendMessage(scope, msg.id, { type: "USER", id: actor.userId, label: actor.label }, (approval.payload as { subject?: string }).subject);
        outcome = "sent";
      } else {
        // No outbound channel: approved, stays as a draft for the human to send.
        await t.message.update({ where: { id: msg.id }, data: { status: "DRAFT" } });
        outcome = "approved_manual_send";
      }
    } else if (msg) {
      await t.message.update({ where: { id: msg.id }, data: { status: "FAILED" } });
    }
  }

  // Entity handlers usually close their own approvals; make sure this one is closed.
  await t.approval.updateMany({ where: { id, status: "PENDING" }, data: { status: decision, decidedById: actor.userId, decidedAt: new Date(), decisionNote: note ?? null } });
  await audit({
    ...scope,
    actorType: "USER",
    actorId: actor.userId,
    actorLabel: actor.label,
    action: `approval.${decision.toLowerCase()}`,
    entityType: approval.entityType ?? undefined,
    entityId: approval.entityId ?? undefined,
    summary: `${actor.label} ${decision === "APPROVED" ? "approved" : "rejected"}: ${approval.title}`,
  });
  return { outcome, category: approval.category };
}
