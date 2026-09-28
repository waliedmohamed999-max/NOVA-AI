import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";

export type BrainSnapshot = Awaited<ReturnType<typeof loadBrain>>;

/**
 * Reads the shared Company Brain: profile, brand kit, offerings, locale and
 * active learnings. Every agent works from this same snapshot, which is what
 * makes the team coherent instead of a set of disconnected bots.
 */
export async function loadBrain(scope: TenantScope) {
  const where = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const [org, profile, brandKit, offerings, insights, settings] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: scope.organizationId } }),
    db.companyProfile.findFirst({ where }),
    db.brandKit.findFirst({ where }),
    db.offering.findMany({ where: { ...where, isActive: true }, take: 12, orderBy: { createdAt: "asc" } }),
    db.aiInsight.findMany({ where: { ...where, status: "ACTIVE", kind: { in: ["learning", "recommendation"] } }, orderBy: { createdAt: "desc" }, take: 6 }),
    db.workspaceSettings.findFirst({ where }),
  ]);
  return { org, profile, brandKit, offerings, insights, settings, locale: org.locale === "ar" ? ("ar" as const) : ("en" as const) };
}

/** Pillars with sensible defaults when the brain is still thin. */
export function pillarsOf(b: BrainSnapshot): string[] {
  if (b.profile?.contentPillars.length) return b.profile.contentPillars;
  return b.locale === "ar" ? ["تعليمي", "خلف الكواليس", "قصص العملاء", "العروض"] : ["Education", "Behind the scenes", "Customer stories", "Offers"];
}
