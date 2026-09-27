import { Prisma } from "@/generated/prisma/client";
import { db } from "../../db/client";
import type { TenantScope } from "../../db/tenant";
import { aiStructured } from "../../ai";
import { compareToRecent, formatPct, type Comparison, type Finding } from "../../analytics/compare";
import { loadMetricRows, performanceDigest } from "../../analytics/digest";
import { defineWorkflow } from "../runtime";
import { brainPrompt, loadBrain } from "../brain";
import { narrativeSchema, postInsightSchema, type PostInsight } from "../schemas";

/**
 * Saves a new insight and archives the previous active insight for the same
 * subject. History is never overwritten — superseded rows stay queryable.
 */
export async function saveInsight(
  scope: TenantScope,
  data: {
    scope: Prisma.AiInsightCreateInput["scope"];
    subjectType?: string;
    subjectId?: string;
    kind: string;
    title: string;
    body: string;
    evidence: Record<string, unknown>;
    generatedBy: string;
    periodStart?: Date;
    periodEnd?: Date;
    confidence?: number;
  },
) {
  const created = await db.aiInsight.create({
    data: {
      ...scope,
      scope: data.scope,
      subjectType: data.subjectType,
      subjectId: data.subjectId,
      kind: data.kind,
      title: data.title.slice(0, 300),
      body: data.body,
      evidence: data.evidence as Prisma.InputJsonValue,
      generatedBy: data.generatedBy,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      confidence: data.confidence,
    },
  });
  await db.aiInsight.updateMany({
    where: { ...scope, id: { not: created.id }, status: "ACTIVE", kind: data.kind, subjectType: data.subjectType ?? null, subjectId: data.subjectId ?? null, scope: data.scope },
    data: { status: "ARCHIVED", supersededById: created.id },
  });
  return created;
}

const METRIC_LABEL: Record<string, { en: string; ar: string }> = {
  engagementRate: { en: "engagement", ar: "التفاعل" },
  reach: { en: "reach", ar: "الوصول" },
  impressions: { en: "impressions", ar: "مرات الظهور" },
  likes: { en: "likes", ar: "الإعجابات" },
  comments: { en: "comments", ar: "التعليقات" },
  shares: { en: "shares", ar: "المشاركات" },
  saves: { en: "saves", ar: "الحفظ" },
  clicks: { en: "clicks", ar: "النقرات" },
  videoViews: { en: "video views", ar: "مشاهدات الفيديو" },
  leads: { en: "leads", ar: "العملاء المحتملين" },
};

/** Factual one-liners built only from computed comparisons. */
export function comparisonSentences(comparisons: Comparison[], sample: number, lang: "en" | "ar") {
  return comparisons
    .filter((c) => Math.abs(c.change) >= 0.05)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 4)
    .map((c) => {
      const label = METRIC_LABEL[c.metric]?.[lang] ?? c.metric;
      return lang === "ar"
        ? `${label}: ${formatPct(c.change)} مقارنة بمتوسط آخر ${sample} منشورات.`
        : `${label[0].toUpperCase()}${label.slice(1)} was ${formatPct(c.change)} vs your recent ${sample}-post average.`;
    });
}

function offlinePostInsight(lang: "en" | "ar", comparisons: Comparison[], sample: number): PostInsight {
  const up = comparisons.filter((c) => c.change > 0.05);
  const down = comparisons.filter((c) => c.change < -0.05);
  const lab = (c: Comparison) => METRIC_LABEL[c.metric]?.[lang] ?? c.metric;
  return {
    headline:
      comparisons.length === 0
        ? lang === "ar"
          ? "لا توجد بيانات كافية للمقارنة بعد."
          : "Not enough data to compare yet."
        : comparisonSentences(comparisons, sample, lang)[0] ?? (lang === "ar" ? "أداء قريب من المتوسط." : "Performance close to your average."),
    whatWorked: up.slice(0, 3).map((c) => (lang === "ar" ? `${lab(c)} أعلى من المعتاد (${formatPct(c.change)})` : `${lab(c)} above usual (${formatPct(c.change)})`)),
    whatDidnt: down.slice(0, 3).map((c) => (lang === "ar" ? `${lab(c)} أقل من المعتاد (${formatPct(c.change)})` : `${lab(c)} below usual (${formatPct(c.change)})`)),
    tryNext: [],
  };
}

export async function analyzePost(scope: TenantScope, socialPostId: string, ai: Parameters<typeof aiStructured>[0]) {
  const b = await loadBrain(scope);
  const rows = await loadMetricRows(scope, 120);
  const post = rows.find((r) => r.id === socialPostId);
  if (!post) return null;
  const { comparisons, sample, baselineLabel } = compareToRecent(post, rows);
  const facts = comparisonSentences(comparisons, sample, b.locale);
  const sp = await db.socialPost.findFirst({ where: { id: socialPostId, ...scope } });
  const insight = await aiStructured(ai, {
    task: "ANALYSIS",
    schemaName: "post_insight",
    schema: postInsightSchema,
    system: [
      "You are the Performance Analyst of an AI growth team.",
      "Explain post performance ONLY using the computed comparisons given. Never invent numbers. If data is thin, say so.",
      "Suggestions in tryNext must be concrete and testable.",
      brainPrompt(b),
    ].join("\n"),
    prompt: [
      `Post (${post.platform}, ${post.format ?? "unknown format"}, pillar: ${post.pillar ?? "unknown"}), published ${post.publishedAt.toISOString()}:`,
      sp?.caption ? `Caption:\n${sp.caption.slice(0, 1500)}` : null,
      `Baseline: ${baselineLabel === "platform" ? "same-platform" : "all-platform"} average of the previous ${sample} posts.`,
      `Computed comparisons:\n${comparisons.map((c) => `${c.metric}: ${c.value.toFixed(4)} vs ${c.baseline.toFixed(4)} (${formatPct(c.change)})`).join("\n") || "none available"}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    offline: () => offlinePostInsight(b.locale, comparisons, sample),
  });
  const saved = await saveInsight(scope, {
    scope: "POST",
    subjectType: "SocialPost",
    subjectId: socialPostId,
    kind: "performance_comparison",
    title: insight.data.headline,
    body: JSON.stringify(insight.data),
    evidence: { comparisons, sample, baseline: baselineLabel, facts },
    generatedBy: insight.generatedBy,
  });
  return { insight: insight.data, facts, comparisons, sample, id: saved.id };
}

export const ANALYSIS_STEPS = ["collecting_metrics", "comparing_performance", "finding_patterns", "writing_insights"];

function findingSentence(f: Finding, lang: "en" | "ar") {
  const dim = { pillar: { en: "posts", ar: "منشورات" }, format: { en: "posts in the format", ar: "منشورات بصيغة" }, platform: { en: "posts on", ar: "منشورات على" } }[f.dimension][lang];
  return lang === "ar"
    ? `${dim} "${f.key}" ${f.kind === "outperforming" ? "تتفوق" : "أضعف"} بنسبة ${formatPct(f.change)} في التفاعل مقارنة بالمتوسط (${f.groupPosts} منشورات).`
    : `${dim[0].toUpperCase()}${dim.slice(1)} "${f.key}" ${f.kind === "outperforming" ? "outperform" : "trail"} your average engagement by ${formatPct(f.change)} (${f.groupPosts} posts).`;
}

defineWorkflow("performance_review", {
  agent: "PERFORMANCE_ANALYST",
  steps: ANALYSIS_STEPS,
  async run(ctx) {
    const b = await loadBrain(ctx.scope);
    const digest = await ctx.step("collecting_metrics", () => performanceDigest(ctx.scope, 30));
    const facts = await ctx.step("comparing_performance", async () => digest.findings.slice(0, 6).map((f) => findingSentence(f, b.locale)));
    await ctx.step("finding_patterns", async () => {
      for (const f of digest.findings.slice(0, 4)) {
        await saveInsight(ctx.scope, {
          scope: f.dimension === "pillar" ? "CONTENT_CATEGORY" : f.dimension === "format" ? "FORMAT" : "ACCOUNT",
          subjectType: f.dimension,
          subjectId: f.key,
          kind: "learning",
          title: findingSentence(f, b.locale),
          body: findingSentence(f, b.locale),
          evidence: { ...f, window: "30d" },
          generatedBy: "rules",
          periodStart: new Date(Date.now() - 30 * 86_400_000),
          periodEnd: new Date(),
        });
      }
    });
    const narrative = await ctx.step("writing_insights", () =>
      digest.hasData
        ? aiStructured(ctx.ai, {
            task: "ANALYSIS",
            schemaName: "performance_narrative",
            schema: narrativeSchema,
            system: ["You are the Performance Analyst. Summarize performance for a busy business owner in 3–4 sentences, using only the facts given. Recommend what to do next.", brainPrompt(b)].join("\n"),
            prompt: `Question: ${ctx.input || "How is our content performing?"}\n\nFacts:\n${digest.text}\n${facts.join("\n")}`,
            offline: () => ({ narrative: [digest.text.split("\n")[0], ...facts.slice(0, 2)].join(" "), highlights: facts.slice(0, 3) }),
          })
        : Promise.resolve(null),
    );
    await ctx.task("PERFORMANCE_ANALYST", b.locale === "ar" ? "راجع أداء المحتوى" : "Reviewed content performance");
    return {
      type: "analysis",
      title: b.locale === "ar" ? "مراجعة الأداء" : "Performance review",
      summary:
        narrative?.data.narrative ??
        (b.locale === "ar"
          ? "لا توجد بيانات أداء حقيقية بعد. اربط حساباتك وانشر أول منشوراتك لتبدأ المقارنات."
          : "There's no real performance data yet. Connect your accounts and publish your first posts to start comparisons."),
      items: facts.map((f) => ({ title: f })),
      actions: digest.hasData ? [{ label: "open_analytics", href: "/analytics", primary: true }] : [{ label: "connect_accounts", href: "/integrations", primary: true }],
      offline: narrative?.offline,
    };
  },
});
