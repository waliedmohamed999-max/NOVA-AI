import { Prisma } from "@/generated/prisma/client";
import { db } from "../../db/client";
import { aiStructured } from "../../ai";
import { retrieveKnowledge, formatContext } from "../../knowledge/service";
import { createContentFromPlan, notifyContentReady } from "../../content/service";
import { audit } from "../../audit";
import { defineWorkflow, type RunContext } from "../runtime";
import { brainPrompt, loadBrain, pillarsOf, type BrainSnapshot } from "../brain";
import { campaignPlanSchema, contentPlanSchema, type PlannedPost } from "../schemas";
import { offlineCampaign, offlineContentPlan } from "../offline-content";
import { performanceDigest } from "../../analytics/digest";

export const CONTENT_PLAN_STEPS = [
  "understanding_goal",
  "reviewing_business",
  "analyzing_performance",
  "creating_strategy",
  "writing_content",
  "design_briefs",
  "scheduling",
  "requesting_approval",
];

function nextMonday(from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1));
  const day = d.getUTCDay();
  const add = (8 - day) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d;
}

function tomorrow() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

const WRITER_SYSTEM = (b: BrainSnapshot) =>
  [
    "You are the content team of an AI growth team: a social media manager, a content strategist and a designer working together.",
    "Write on-brand, specific, useful social content for the company below. Vary hooks and formats. No generic filler, no fake statistics, no invented testimonials, no promises the company hasn't made.",
    "Hashtags: few and relevant. Each post needs a design brief the designer can execute using the brand kit.",
    "Only reference prices, discounts or offers that appear in the company information.",
    "",
    brainPrompt(b),
  ].join("\n");

async function gatherContext(ctx: RunContext, b: BrainSnapshot, focus: string) {
  const [chunks, perf] = await Promise.all([retrieveKnowledge(ctx.scope, focus, 5), performanceDigest(ctx.scope)]);
  return { knowledge: formatContext(chunks), perf };
}

defineWorkflow("content_plan", {
  agent: "CONTENT_STRATEGIST",
  steps: CONTENT_PLAN_STEPS,
  async run(ctx) {
    const count = Math.min(14, Math.max(1, Number(ctx.params.count ?? 7)));
    const platform = (ctx.params.platform as PlannedPost["platform"] | null) ?? null;
    const topic = (ctx.params.topic as string | null) ?? null;

    const b = await ctx.step("understanding_goal", () => loadBrain(ctx.scope));
    const { knowledge, perf } = await ctx.step("reviewing_business", () => gatherContext(ctx, b, topic ?? ctx.input));
    await ctx.step("analyzing_performance", async () => perf);

    const plan = await ctx.step("creating_strategy", () =>
      aiStructured(ctx.ai, {
        task: "COPYWRITING",
        schemaName: "content_plan",
        schema: contentPlanSchema,
        system: WRITER_SYSTEM(b),
        prompt: [
          `Request from the business owner: "${ctx.input || `Create ${count} posts for next week`}"`,
          `Create exactly ${count} posts${platform ? ` for ${platform}` : " across the recommended channels"}.`,
          topic && `Focus topic: ${topic}`,
          `Content pillars to balance: ${pillarsOf(b).join(", ")}`,
          `dayOffset 0 = the first day of the plan (a Monday). Spread posts sensibly across the week; choose realistic posting times.`,
          `Real performance data (use it to decide themes and formats; don't cite numbers that aren't here):\n${perf.text}`,
          `Company knowledge:\n${knowledge}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        offline: () => offlineContentPlan(b, count, platform, topic),
      }),
    );
    await ctx.step("writing_content", async () => undefined);
    await ctx.step("design_briefs", async () => undefined);

    const start = ctx.params.startDate ? new Date(String(ctx.params.startDate)) : nextMonday();
    const ids = await ctx.step("scheduling", () =>
      createContentFromPlan(ctx.scope, plan.data.posts.slice(0, count), { agent: "CONTENT_STRATEGIST", startDate: start, generatedBy: plan.generatedBy, requestedById: ctx.requestedById }),
    );

    await ctx.step("requesting_approval", async () => {
      await ctx.task("CONTENT_STRATEGIST", b.locale === "ar" ? `كتب ${ids.length} منشورات` : `Wrote ${ids.length} posts`);
      await ctx.task("DESIGNER", b.locale === "ar" ? `جهّز ${ids.length} تصاميم مبدئية` : `Prepared ${ids.length} design briefs`);
      await ctx.task("SOCIAL_MANAGER", b.locale === "ar" ? "خطط لجدول النشر" : "Planned the publishing schedule");
      await notifyContentReady(ctx.scope, ids.length, "/content?view=approval", b.locale);
      await audit({ ...ctx.scope, actorType: "AGENT", actorLabel: "Content Strategist", action: "content.plan_created", summary: `AI created ${ids.length} posts for review`, metadata: { ids } });
    });

    const byFormat = new Map<string, number>();
    for (const p of plan.data.posts) byFormat.set(p.format, (byFormat.get(p.format) ?? 0) + 1);
    return {
      type: "content_plan",
      title: b.locale === "ar" ? `${ids.length} منشورات جاهزة للمراجعة` : `${ids.length} posts ready for review`,
      summary: plan.data.summary,
      stats: [...byFormat.entries()].map(([label, value]) => ({ label: `format:${label}`, value })),
      items: plan.data.posts.slice(0, 7).map((p, i) => ({ title: p.title, subtitle: p.hook, href: `/content/${ids[i]}`, badge: p.platform })),
      actions: [
        { label: "review", href: "/content?view=approval", primary: true },
        { label: "approve_all", action: "approve_all_content" },
        { label: "calendar", href: "/calendar" },
      ],
      entity: { type: "ContentBatch", id: ids.join(",") },
      offline: plan.offline,
    };
  },
});

export const CAMPAIGN_STEPS = ["understanding_goal", "reviewing_business", "analyzing_performance", "creating_strategy", "writing_content", "design_briefs", "scheduling", "requesting_approval"];

defineWorkflow("campaign", {
  agent: "SOCIAL_MANAGER",
  steps: CAMPAIGN_STEPS,
  async run(ctx) {
    const topic = (ctx.params.topic as string | null) ?? null;
    const b = await ctx.step("understanding_goal", () => loadBrain(ctx.scope));
    const { knowledge, perf } = await ctx.step("reviewing_business", () => gatherContext(ctx, b, topic ?? ctx.input));
    await ctx.step("analyzing_performance", async () => perf);

    const plan = await ctx.step("creating_strategy", () =>
      aiStructured(ctx.ai, {
        task: "STRATEGY",
        schemaName: "campaign_plan",
        schema: campaignPlanSchema,
        system: WRITER_SYSTEM(b),
        prompt: [
          `Request from the business owner: "${ctx.input}"`,
          topic && `Campaign subject: ${topic}`,
          "Design a complete campaign: concept, key message, creative direction, CTA, KPIs, channels, and 5–9 posts (include at least one carousel and one short video).",
          "dayOffset 0 = campaign start date.",
          `Real performance data:\n${perf.text}`,
          `Company knowledge:\n${knowledge}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        offline: () => offlineCampaign(b, topic),
      }),
    );
    const c = plan.data;
    await ctx.step("writing_content", async () => undefined);
    await ctx.step("design_briefs", async () => undefined);

    const start = ctx.params.startDate ? new Date(String(ctx.params.startDate)) : tomorrow();
    const campaign = await ctx.step("scheduling", async () => {
      const created = await db.campaign.create({
        data: {
          ...ctx.scope,
          name: c.name.slice(0, 160),
          objective: c.objective,
          audience: c.audience,
          offer: c.offer,
          channels: c.channels,
          startDate: start,
          endDate: new Date(start.getTime() + c.durationDays * 86_400_000),
          status: "PENDING_APPROVAL",
          createdByAgent: "SOCIAL_MANAGER",
          createdById: ctx.requestedById,
          plan: { concept: c.concept, keyMessage: c.keyMessage, creativeDirection: c.creativeDirection, cta: c.cta, kpis: c.kpis, generatedBy: plan.generatedBy } as Prisma.InputJsonValue,
        },
      });
      const ids = await createContentFromPlan(ctx.scope, c.posts, { campaignId: created.id, agent: "CONTENT_STRATEGIST", startDate: start, generatedBy: plan.generatedBy, requestedById: ctx.requestedById });
      await db.approval.create({
        data: {
          ...ctx.scope,
          category: "CAMPAIGNS",
          action: "activate_campaign",
          title: c.name.slice(0, 200),
          summary: c.concept,
          reason: c.objective,
          impact: c.kpis.join(" · "),
          entityType: "Campaign",
          entityId: created.id,
          requestedByAgent: "SOCIAL_MANAGER",
          requestedById: ctx.requestedById,
          payload: { posts: ids.length },
        },
      });
      return { ...created, contentIds: ids };
    });

    await ctx.step("requesting_approval", async () => {
      await ctx.task("SOCIAL_MANAGER", b.locale === "ar" ? `صمّم حملة "${c.name}"` : `Designed the "${c.name}" campaign`, { type: "Campaign", id: campaign.id });
      await ctx.task("CONTENT_STRATEGIST", b.locale === "ar" ? `كتب ${campaign.contentIds.length} منشورات للحملة` : `Wrote ${campaign.contentIds.length} campaign posts`);
      await ctx.task("DESIGNER", b.locale === "ar" ? "حدّد التوجه الإبداعي" : "Set the creative direction");
      await notifyContentReady(ctx.scope, campaign.contentIds.length, `/campaigns/${campaign.id}`, b.locale);
      await audit({ ...ctx.scope, actorType: "AGENT", actorLabel: "AI Social Manager", action: "campaign.created", entityType: "Campaign", entityId: campaign.id, summary: `AI created campaign "${c.name}"` });
    });

    const count = (f: string) => c.posts.filter((p) => p.format === f).length;
    return {
      type: "campaign",
      title: c.name,
      summary: c.concept,
      stats: [
        { label: "posts", value: c.posts.length - count("SHORT_VIDEO") - count("REEL") - count("CAROUSEL") },
        { label: "videos", value: count("SHORT_VIDEO") + count("REEL") },
        { label: "carousels", value: count("CAROUSEL") },
        { label: "days", value: c.durationDays },
      ],
      items: [
        { title: c.keyMessage, subtitle: "keyMessage" },
        { title: c.audience, subtitle: "audience" },
        { title: c.cta, subtitle: "cta" },
        { title: c.creativeDirection, subtitle: "creativeDirection" },
      ],
      actions: [
        { label: "review_campaign", href: `/campaigns/${campaign.id}`, primary: true },
        { label: "approve_plan", action: "approve_campaign", entityId: campaign.id },
        { label: "edit", href: `/campaigns/${campaign.id}` },
      ],
      entity: { type: "Campaign", id: campaign.id },
      offline: plan.offline,
    };
  },
});
