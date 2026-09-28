import { z } from "zod";
import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { loadBrain, type BrainSnapshot } from "../agents/brain";
import { compactContext } from "../knowledge/company-context";
import { contentContext } from "../knowledge/use-cases";
import { loadMetricRows } from "../analytics/digest";
import { groupBy } from "../analytics/compare";

/** Structured outputs the studio asks the model for (validated with zod). */
export const improvedContentSchema = z.object({
  hook: z.string().min(1).max(300),
  caption: z.string().min(1).max(2200),
  cta: z.string().max(200),
  hashtags: z.array(z.string().max(60)).max(10),
  visual_direction: z.string().max(600),
  /** 2–3 short, data-grounded reasons. Never a reasoning trace. */
  reasons: z.array(z.string().max(220)).min(1).max(3),
  platform_notes: z.string().max(400),
  /** TikTok/Reels only; empty otherwise. */
  video_concept: z.string().max(600),
  on_screen_text: z.array(z.string().max(120)).max(6),
});
export type ImprovedContent = z.infer<typeof improvedContentSchema>;

export const QUALITY_DIMENSIONS = ["brand_fit", "clarity", "cta", "platform_fit", "repetition", "claim_safety"] as const;
export const qualityCheckSchema = z.object({
  checks: z
    .array(z.object({ dimension: z.enum(QUALITY_DIMENSIONS), status: z.enum(["good", "needs_attention"]), reason: z.string().max(240) }))
    .length(QUALITY_DIMENSIONS.length),
});
export type QualityCheck = z.infer<typeof qualityCheckSchema>["checks"];

export const visualDirectionSchema = z.object({
  concept: z.string().max(400),
  scene: z.string().max(600),
  composition: z.string().max(300),
  mood: z.string().max(200),
  /** Short on-image headline for the Brand Template (NOVA renders it; the model never draws text). */
  headline: z.string().max(90),
});
export type VisualDirection = z.infer<typeof visualDirectionSchema>;

/** Normalizes text for similarity (Arabic-aware: strips diacritics/tatweel, unifies alef/ya/ta-marbuta). */
export function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word-bigram Jaccard similarity (0–1). Pure — unit tested. */
export function similarity(a: string, b: string) {
  const grams = (s: string) => {
    const w = normalize(s).split(" ").filter(Boolean);
    const g = new Set<string>();
    for (let i = 0; i < w.length; i++) g.add(w.length === 1 ? w[0] : `${w[i]} ${w[i + 1] ?? ""}`);
    return g;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export type RecentContent = { id: string; title: string; hook: string | null; cta: string | null; pillar: string | null; visual: string | null; status: string };

/** Hooks/CTAs/topics/visual directions that are too close to recent content. */
export function findDuplicates(candidate: { title?: string | null; hook?: string | null; cta?: string | null; visual?: string | null }, recent: RecentContent[], threshold = 0.55) {
  const hits: { kind: "topic" | "hook" | "cta" | "visual"; againstId: string; score: number }[] = [];
  for (const r of recent) {
    const pairs: ["topic" | "hook" | "cta" | "visual", string | null | undefined, string | null][] = [
      ["topic", candidate.title, r.title],
      ["hook", candidate.hook, r.hook],
      ["cta", candidate.cta, r.cta],
      ["visual", candidate.visual, r.visual],
    ];
    for (const [kind, a, b] of pairs) {
      if (!a || !b) continue;
      const score = similarity(a, b);
      if (score >= (kind === "cta" ? 0.8 : threshold)) hits.push({ kind, againstId: r.id, score });
    }
  }
  return hits;
}

export async function recentContent(scope: TenantScope, excludeId?: string, take = 40): Promise<RecentContent[]> {
  const rows = await db.contentItem.findMany({
    where: { ...scope, ...(excludeId ? { id: { not: excludeId } } : {}), status: { in: ["APPROVED", "SCHEDULED", "PUBLISHED", "PENDING_APPROVAL"] } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, title: true, hook: true, cta: true, pillar: true, designBrief: true, status: true },
  });
  return rows.map((r) => ({ ...r, visual: (r.designBrief as { concept?: string } | null)?.concept ?? null }));
}

/**
 * Real performance, summarised by strategy (pillar), format and platform. Only groups with enough posts
 * are mentioned; with no data, it says so — insights are never invented.
 */
export async function performanceLearning(scope: TenantScope) {
  const rows = await loadMetricRows(scope, 90);
  if (rows.length < 3) return { hasData: false, text: "No reliable performance data yet (fewer than 3 published posts with metrics). Don't claim what performs best." };
  const lines: string[] = [];
  const saves = (g: typeof rows) => {
    const v = g.map((r) => r.saves).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  for (const [label, key] of [["Pillar", (r: (typeof rows)[number]) => r.pillar], ["Format", (r: (typeof rows)[number]) => r.format], ["Platform", (r: (typeof rows)[number]) => r.platform]] as const) {
    const groups = groupBy(rows, key).filter((g) => g.posts >= 2 && g.avgEngagement != null);
    for (const g of groups.slice(0, 4)) {
      const members = rows.filter((r) => key(r) === g.key);
      const s = saves(members);
      lines.push(`${label} "${g.key}": ${g.posts} posts, avg engagement ${(g.avgEngagement! * 100).toFixed(2)}%${s != null ? `, avg saves ${s.toFixed(1)}` : ""}.`);
    }
  }
  return { hasData: lines.length > 0, text: lines.length ? `Last 90 days of real metrics (${rows.length} posts):\n${lines.join("\n")}` : "Not enough posts per group to compare yet." };
}

/** Everything the model needs to write for this company — assembled here, never in components. */
export async function studioContext(scope: TenantScope, item?: { id: string; campaignId: string | null; title?: string | null; pillar?: string | null; hook?: string | null; caption?: string | null }) {
  // Company context is selective: the product/service this post is about, audience, voice and content rules.
  const about = item ? [item.title, item.pillar, item.hook, item.caption?.slice(0, 400)].filter(Boolean).join(" ") : undefined;
  const [brain, brainCtx, learning, recent, approved, campaign] = await Promise.all([
    loadBrain(scope),
    // relevantTo only (no query): product/audience/voice/rules — no knowledge-chunk search for studio edits.
    contentContext(scope, { relevantTo: about }),
    performanceLearning(scope),
    recentContent(scope, item?.id),
    db.contentItem.findMany({ where: { ...scope, status: { in: ["APPROVED", "SCHEDULED", "PUBLISHED"] }, ...(item ? { id: { not: item.id } } : {}) }, orderBy: { updatedAt: "desc" }, take: 4, select: { hook: true, caption: true, platform: true } }),
    item?.campaignId ? db.campaign.findFirst({ where: { id: item.campaignId, ...scope }, select: { name: true, objective: true, offer: true, audience: true } }) : null,
  ]);
  return { brain, brainCtx, learning, recent, approved, campaign };
}

/**
 * Prompt block for Content Studio calls. Company knowledge is the selective content context (never the full
 * profile); the recent hooks/approved posts are the task's own data (anti-repetition), bounded to 15 and 4.
 */
export function contextBlock(c: Awaited<ReturnType<typeof studioContext>>) {
  const b: BrainSnapshot = c.brain;
  return [
    compactContext(c.brainCtx),
    `Write customer-facing copy in ${b.locale === "ar" ? "Arabic (natural Modern Standard Arabic suited to the region)" : "English"}.`,
    c.campaign && `Campaign: ${c.campaign.name}. Objective: ${c.campaign.objective ?? "—"}.${c.campaign.offer ? ` Offer: ${c.campaign.offer}.` : ""}${c.campaign.audience ? ` Audience: ${c.campaign.audience}.` : ""}`,
    `Performance context:\n${c.learning.text}`,
    c.approved.length && `Recently approved posts (match this quality and voice, don't copy them):\n${c.approved.map((a) => `- [${a.platform}] ${a.hook ?? a.caption.slice(0, 120)}`).join("\n")}`,
    c.recent.length && `Avoid repeating these recent hooks/topics:\n${c.recent.slice(0, 15).map((r) => `- ${r.hook ?? r.title}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
