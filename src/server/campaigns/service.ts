import type { CampaignStatus } from "@/generated/prisma/enums";
import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { audit } from "../audit";
import { approveContent } from "../content/service";

type Actor = { userId: string; label?: string };

/** Approving a campaign activates it and approves its pending content in one step. */
export async function approveCampaign(scope: TenantScope, campaignId: string, actor: Actor) {
  const t = tenantDb(scope);
  const campaign = await t.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new NotFoundError();
  // WhatsApp campaigns: approval materializes recipients and starts the queued send.
  if (campaign.channel === "whatsapp") {
    const { approveWhatsAppCampaign } = await import("../whatsapp/campaigns");
    await approveWhatsAppCampaign(scope, campaignId, { userId: actor.userId, label: actor.label ?? "A user" });
    return;
  }
  if (!["DRAFT", "PENDING_APPROVAL", "PAUSED"].includes(campaign.status)) throw new UserFacingError("invalid_transition");
  await t.campaign.update({ where: { id: campaignId }, data: { status: "ACTIVE" } });
  await t.approval.updateMany({
    where: { entityType: "Campaign", entityId: campaignId, status: "PENDING" },
    data: { status: "APPROVED", decidedById: actor.userId, decidedAt: new Date() },
  });
  const pending = await t.contentItem.findMany({ where: { campaignId, status: { in: ["PENDING_APPROVAL", "DRAFT"] } }, select: { id: true } });
  await approveContent(scope, pending.map((p) => p.id), actor);
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "campaign.approved", entityType: "Campaign", entityId: campaignId, summary: `${actor.label ?? "A user"} approved campaign "${campaign.name}"` });
}

export async function setCampaignStatus(scope: TenantScope, campaignId: string, status: CampaignStatus, actor: Actor) {
  const t = tenantDb(scope);
  const campaign = await t.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new NotFoundError();
  if (campaign.channel === "whatsapp" && status === "DRAFT") {
    const { rejectWhatsAppCampaign } = await import("../whatsapp/campaigns");
    return rejectWhatsAppCampaign(scope, campaignId, { userId: actor.userId, label: actor.label ?? "A user" });
  }
  await t.campaign.update({ where: { id: campaignId }, data: { status } });
  if (status === "ARCHIVED" || status === "PAUSED") {
    await t.approval.updateMany({ where: { entityType: "Campaign", entityId: campaignId, status: "PENDING" }, data: { status: "REJECTED", decidedById: actor.userId, decidedAt: new Date() } });
  }
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "campaign.status", entityType: "Campaign", entityId: campaignId, summary: `Campaign "${campaign.name}" → ${status}` });
}
