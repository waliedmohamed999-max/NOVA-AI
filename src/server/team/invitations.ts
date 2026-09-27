import { db } from "../db/client";
import { hashToken } from "../crypto";
import { audit } from "../audit";
import { UserFacingError } from "../errors";

export type InvitationState = "valid" | "expired" | "revoked" | "accepted" | "not_found";

export async function lookupInvitation(token: string) {
  const inv = await db.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { organization: { select: { id: true, name: true } } } });
  if (!inv) return { state: "not_found" as InvitationState, invitation: null };
  const state: InvitationState = inv.acceptedAt ? "accepted" : inv.revokedAt ? "revoked" : inv.expiresAt < new Date() ? "expired" : "valid";
  return { state, invitation: inv };
}

/** Accepts an invitation for the signed-in user. The invite email must match the account email. */
export async function acceptInvitation(token: string, user: { id: string; email: string }) {
  const { state, invitation } = await lookupInvitation(token);
  if (state !== "valid" || !invitation) throw new UserFacingError("invalid_token");
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) throw new UserFacingError("forbidden");
  const claimed = await db.invitation.updateMany({ where: { id: invitation.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
  if (claimed.count !== 1) throw new UserFacingError("invalid_token");
  await db.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: invitation.organizationId, userId: user.id } },
    create: { organizationId: invitation.organizationId, userId: user.id, role: invitation.role },
    update: {},
  });
  await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  await db.session.updateMany({ where: { userId: user.id }, data: { activeOrganizationId: invitation.organizationId } });
  await audit({ organizationId: invitation.organizationId, category: "SECURITY", actorType: "USER", actorId: user.id, action: "team.joined", summary: `${user.email} joined as ${invitation.role}` });
  return invitation.organizationId;
}

export async function declineInvitation(token: string, user: { id: string; email: string }) {
  const { state, invitation } = await lookupInvitation(token);
  if (state !== "valid" || !invitation) throw new UserFacingError("invalid_token");
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) throw new UserFacingError("forbidden");
  await db.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
  await audit({ organizationId: invitation.organizationId, category: "SECURITY", actorType: "USER", actorId: user.id, action: "team.invite_declined", summary: `${user.email} declined the invitation` });
}
