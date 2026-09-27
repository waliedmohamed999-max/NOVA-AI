import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { getUsage } from "@/server/billing/entitlements";
import { TeamManager } from "@/features/settings/team";

export const metadata: Metadata = { title: "Team" };

function inviteState(i: { revokedAt: Date | null; expiresAt: Date }): "pending" | "expired" | "revoked" {
  return i.revokedAt ? "revoked" : i.expiresAt.getTime() < Date.now() ? "expired" : "pending";
}

export default async function TeamSettingsPage() {
  const ctx = await requireTenant();
  const [members, invites, usage] = await Promise.all([
    ctx.db.organizationMember.findMany({ include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } }, orderBy: { createdAt: "asc" } }),
    ctx.db.invitation.findMany({ where: { acceptedAt: null }, orderBy: { createdAt: "desc" } }),
    getUsage(ctx.organization.id),
  ]);
  return (
    <TeamManager
      me={{ id: ctx.user.id, role: ctx.role }}
      canManage={ctx.can("team:manage")}
      seats={usage.seats}
      members={members.map((m) => ({ id: m.id, userId: m.userId, name: m.user.name, email: m.user.email, role: m.role }))}
      invites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role, state: inviteState(i) }))}
    />
  );
}
