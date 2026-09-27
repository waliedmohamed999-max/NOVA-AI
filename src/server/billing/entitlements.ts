import type { PlanTier } from "@/generated/prisma/enums";
import { PLANS, PLAN_ORDER, type PlanEntitlements } from "@/config/plans";
import { db } from "../db/client";
import { UserFacingError } from "../errors";
import { getBudgetStatus } from "../ai/budget";

export type LimitedResource = "seats" | "socialChannels" | "agents";

export type Usage = {
  plan: PlanTier;
  status: string;
  entitlements: PlanEntitlements;
  seats: { used: number; limit: number };
  socialChannels: { used: number; limit: number };
  ai: Awaited<ReturnType<typeof getBudgetStatus>>;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
};

/** Plan, limits and live usage for one organization. */
export async function getUsage(organizationId: string): Promise<Usage> {
  const [sub, members, invites, channels, ai] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId } }),
    db.organizationMember.count({ where: { organizationId } }),
    db.invitation.count({ where: { organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    db.integration.count({ where: { organizationId, status: { not: "DISCONNECTED" }, provider: { in: ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "TIKTOK", "X", "YOUTUBE", "PINTEREST"] }, OR: [{ statusMessage: null }, { statusMessage: { not: "identity_only" } }] } }),
    getBudgetStatus(organizationId),
  ]);
  const plan = sub?.plan ?? "STARTER";
  const e = PLANS[plan];
  return {
    plan,
    status: sub?.status ?? "TRIALING",
    entitlements: e,
    seats: { used: members + invites, limit: e.seats },
    socialChannels: { used: channels, limit: e.socialChannels },
    ai,
    trialEndsAt: sub?.trialEndsAt ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
  };
}

/** Server-side plan enforcement. Throws the customer-safe `plan_limit` error. */
export async function assertWithinLimit(organizationId: string, resource: LimitedResource, extra: { agentKey?: string } = {}) {
  const u = await getUsage(organizationId);
  if (u.status === "CANCELED") throw new UserFacingError("plan_limit");
  if (resource === "seats" && u.seats.used >= u.seats.limit) throw new UserFacingError("plan_limit");
  if (resource === "socialChannels" && u.socialChannels.used >= u.socialChannels.limit) throw new UserFacingError("plan_limit");
  if (resource === "agents" && extra.agentKey && !(u.entitlements.agents as readonly string[]).includes(extra.agentKey)) throw new UserFacingError("plan_limit");
}

/**
 * Whether the organization's current usage fits a target plan. A downgrade is
 * only allowed when nothing would exceed the new limits.
 */
export async function canMoveTo(organizationId: string, target: PlanTier) {
  const u = await getUsage(organizationId);
  const next = PLANS[target];
  const blockers: LimitedResource[] = [];
  if (u.seats.used > next.seats) blockers.push("seats");
  if (u.socialChannels.used > next.socialChannels) blockers.push("socialChannels");
  return { ok: blockers.length === 0, blockers, direction: PLAN_ORDER.indexOf(target) >= PLAN_ORDER.indexOf(u.plan) ? ("upgrade" as const) : ("downgrade" as const) };
}

/** Applies a plan to the organization's records (subscription tier, AI allowance, agent availability). */
export async function applyPlan(organizationId: string, plan: PlanTier) {
  const e = PLANS[plan];
  await db.subscription.update({ where: { organizationId }, data: { plan } });
  await db.aiBudget.update({ where: { organizationId }, data: { monthlyAllowanceMicro: e.aiMonthlyAllowanceMicro } });
  await db.agent.updateMany({ where: { organizationId, key: { in: e.agents as never[] } }, data: { enabled: true } });
  await db.agent.updateMany({ where: { organizationId, key: { notIn: e.agents as never[] } }, data: { enabled: false, status: "PAUSED" } });
}
