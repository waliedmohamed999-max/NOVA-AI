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

/** Compact, prompt-ready description of the company. Kept deliberately short. */
export function brainPrompt(b: BrainSnapshot): string {
  const p = b.profile;
  const lines = [
    `Company: ${b.org.name}${p?.industry ? ` (${p.industry})` : ""}`,
    p?.summary && `What they do: ${p.summary}`,
    p?.website && `Website: ${p.website}`,
    b.offerings.length && `Offerings: ${b.offerings.map((o) => `${o.name}${o.priceText ? ` (${o.priceText})` : ""}`).join("; ")}`,
    p && Array.isArray(p.audience) && p.audience.length
      ? `Audience: ${(p.audience as { name: string; description: string }[]).map((a) => `${a.name} — ${a.description}`).join(" | ")}`
      : null,
    p?.valueProps.length && `Value propositions: ${p.valueProps.join("; ")}`,
    p?.contentPillars.length && `Content pillars: ${p.contentPillars.join(", ")}`,
    p?.goals.length && `Goals: ${p.goals.join(", ")}`,
    b.brandKit?.tone && `Brand tone: ${b.brandKit.tone}`,
    b.brandKit?.voiceTraits.length && `Voice traits: ${b.brandKit.voiceTraits.join(", ")}`,
    b.brandKit?.doSay.length && `Always: ${b.brandKit.doSay.join("; ")}`,
    b.brandKit?.dontSay.length && `Never: ${b.brandKit.dontSay.join("; ")}`,
    b.brandKit?.forbiddenStyles.length && `Forbidden visual styles: ${b.brandKit.forbiddenStyles.join(", ")}`,
    b.brandKit?.primaryColors.length && `Brand colors: ${[...b.brandKit.primaryColors, ...b.brandKit.secondaryColors].join(", ")}`,
    b.insights.length && `What we've learned from real performance data:\n${b.insights.map((i) => `- ${i.title}`).join("\n")}`,
    `Write customer-facing copy in ${b.locale === "ar" ? "Arabic (natural Modern Standard Arabic suited to the region)" : "English"}.`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Pillars with sensible defaults when the brain is still thin. */
export function pillarsOf(b: BrainSnapshot): string[] {
  if (b.profile?.contentPillars.length) return b.profile.contentPillars;
  return b.locale === "ar" ? ["تعليمي", "خلف الكواليس", "قصص العملاء", "العروض"] : ["Education", "Behind the scenes", "Customer stories", "Offers"];
}
