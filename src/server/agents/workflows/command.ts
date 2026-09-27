import { db } from "../../db/client";
import { aiStructured } from "../../ai";
import { retrieveKnowledge, formatContext } from "../../knowledge/service";
import { defineWorkflow, getWorkflow, type RunContext } from "../runtime";
import { brainPrompt, loadBrain } from "../brain";
import { answerSchema, commandIntentSchema, type CommandIntent } from "../schemas";
import { storage } from "../../storage";
import type { ImageInput } from "../../ai/types";

/** Loads image attachments (tenant-checked) for vision-capable answers. */
async function loadImages(ctx: RunContext): Promise<ImageInput[]> {
  const ids = (ctx.params.imageFileIds as string[] | undefined) ?? [];
  if (!ids.length) return [];
  const files = await db.fileObject.findMany({ where: { id: { in: ids }, organizationId: ctx.scope.organizationId, deletedAt: null } });
  return Promise.all(
    files.map(async (f) => ({ mediaType: f.mimeType as ImageInput["mediaType"], base64: (await storage.get(f.storageKey)).toString("base64") })),
  );
}

/** Keyword intent detection for the offline dev provider (EN + AR). */
export function offlineIntent(text: string): CommandIntent {
  const t = text.toLowerCase();
  const num = Number(t.match(/\b(\d{1,2})\b/)?.[1] ?? NaN);
  const platform = /instagram|إنستغرام|انستغرام|انستقرام/.test(t)
    ? "INSTAGRAM"
    : /linkedin|لينكد/.test(t)
      ? "LINKEDIN"
      : /tiktok|تيك/.test(t)
        ? "TIKTOK"
        : /facebook|فيسبوك|فيس بوك/.test(t)
          ? "FACEBOOK"
          : null;
  const base = { count: Number.isFinite(num) ? Math.min(14, num) : null, platform, topic: null, days: null } as const;
  if (/campaign|launch|حملة|إطلاق|اطلاق/.test(t)) {
    const topic = text.match(/(?:for|about|لـ|ل|عن)\s+(.{3,60}?)(?:[.!?؟]|$)/i)?.[1]?.trim() ?? null;
    return { ...base, intent: "create_campaign", topic };
  }
  if (/perform|why|best|worst|analytics|engagement|أداء|لماذا|أفضل|تفاعل/.test(t)) return { ...base, intent: "analyze_performance" };
  if (/post|content|week|calendar|caption|منشور|محتوى|الأسبوع|اسبوع/.test(t)) return { ...base, intent: "create_content_plan" };
  if (/follow|hot lead|lead|تابع|متابعة|العملاء/.test(t)) return { ...base, intent: "leads_followup" };
  if (/pipeline|deal|stalled|صفقات|المبيعات|خط المبيعات/.test(t)) return { ...base, intent: "pipeline_summary" };
  if (/opportunit|فرص/.test(t)) return { ...base, intent: "find_opportunities" };
  return { ...base, intent: "ask_question" };
}

const INTENT_TO_WORKFLOW: Partial<Record<CommandIntent["intent"], string>> = {
  create_content_plan: "content_plan",
  create_campaign: "campaign",
  analyze_performance: "performance_review",
  leads_followup: "leads_followup",
};

async function answerQuestion(ctx: RunContext) {
  const b = await loadBrain(ctx.scope);
  const chunks = await ctx.step("searching_knowledge", () => retrieveKnowledge(ctx.scope, ctx.input, 6));
  const images = await loadImages(ctx);
  const res = await ctx.step("writing_answer", () =>
    aiStructured(ctx.ai, {
      schemaName: "answer",
      schema: answerSchema,
      system: [
        "You are the AI Growth Team answering the business owner. Answer using the company knowledge and profile provided; cite source numbers you used.",
        "If the knowledge does not contain the answer, say so briefly and suggest what to add to the Company Brain.",
        brainPrompt(b),
      ].join("\n"),
      prompt: `Question: ${ctx.input}\n\nCompany knowledge:\n${formatContext(chunks)}`,
      images,
      task: images.length ? "VISION" : "ANALYSIS",
      offline: () => ({
        answer: chunks.length
          ? chunks[0].content.slice(0, 600)
          : b.locale === "ar"
            ? "لم أجد إجابة في عقل الشركة بعد. أضف المعلومة من صفحة عقل الشركة وسأستخدمها في المرات القادمة."
            : "I couldn't find this in your Company Brain yet. Add it on the Company Brain page and I'll use it from now on.",
        usedSources: chunks.length ? [1] : [],
        suggestedActions: [],
      }),
    }),
  );
  return {
    type: "answer" as const,
    title: ctx.input.slice(0, 120),
    summary: res.data.answer,
    items: res.data.usedSources.map((i) => chunks[i - 1]).filter(Boolean).map((c) => ({ title: c.title || c.sourceType, subtitle: c.url ?? undefined })),
    actions: chunks.length ? [] : [{ label: "open_knowledge", href: "/knowledge", primary: true }],
    offline: res.offline,
  };
}

async function pipelineSummary(ctx: RunContext) {
  const b = await loadBrain(ctx.scope);
  const data = await ctx.step("reviewing_pipeline", async () => {
    const [byStage, stalled, hot] = await Promise.all([
      db.lead.groupBy({ by: ["stage"], where: ctx.scope, _count: true, _sum: { estimatedValueCents: true } }),
      db.lead.findMany({ where: { ...ctx.scope, stage: { notIn: ["WON", "LOST", "NEW"] }, stageChangedAt: { lt: new Date(Date.now() - 14 * 86_400_000) } }, take: 5, orderBy: { stageChangedAt: "asc" } }),
      db.lead.findMany({ where: { ...ctx.scope, temperature: "HOT", stage: { notIn: ["WON", "LOST"] } }, take: 5, orderBy: { score: "desc" } }),
    ]);
    return { byStage, stalled, hot };
  });
  const open = data.byStage.filter((s) => !["WON", "LOST"].includes(s.stage));
  const value = open.reduce((a, s) => a + (s._sum.estimatedValueCents ?? 0), 0);
  await ctx.task("SALES_ASSISTANT", b.locale === "ar" ? "لخّص خط المبيعات" : "Summarized the pipeline");
  const ar = b.locale === "ar";
  return {
    type: "pipeline" as const,
    title: ar ? "ملخص خط المبيعات" : "Pipeline summary",
    summary: ar
      ? `${open.reduce((a, s) => a + s._count, 0)} فرص مفتوحة، منها ${data.hot.length} مهتمة جدًا و${data.stalled.length} متوقفة منذ أكثر من أسبوعين.`
      : `${open.reduce((a, s) => a + s._count, 0)} open opportunities — ${data.hot.length} hot and ${data.stalled.length} stalled for more than two weeks.`,
    stats: [
      { label: "open", value: open.reduce((a, s) => a + s._count, 0) },
      { label: "value", value: Math.round(value / 100) },
      { label: "hot", value: data.hot.length },
      { label: "stalled", value: data.stalled.length },
    ],
    items: [...data.hot.map((l) => ({ title: l.name, subtitle: l.nextAction ?? undefined, href: `/leads/${l.id}`, badge: "HOT" })), ...data.stalled.map((l) => ({ title: l.name, subtitle: l.stage, href: `/leads/${l.id}`, badge: "STALLED" }))],
    actions: [{ label: "open_pipeline", href: "/sales", primary: true }],
  };
}

async function opportunities(ctx: RunContext) {
  const b = await loadBrain(ctx.scope);
  const [insights, stalled, pendingApprovals] = await ctx.step("finding_opportunities", () =>
    Promise.all([
      db.aiInsight.findMany({ where: { ...ctx.scope, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 4 }),
      db.lead.count({ where: { ...ctx.scope, stage: { notIn: ["WON", "LOST"] }, stageChangedAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } }),
      db.approval.count({ where: { ...ctx.scope, status: "PENDING" } }),
    ]),
  );
  const discoveries = (b.profile?.discoveries ?? {}) as { contentOpportunities?: { title: string; description: string }[]; salesOpportunities?: { title: string; description: string }[] };
  const ar = b.locale === "ar";
  const items = [
    ...insights.map((i) => ({ title: i.title, subtitle: ar ? "من بياناتك" : "From your data" })),
    ...(discoveries.contentOpportunities ?? []).slice(0, 2).map((o) => ({ title: o.title, subtitle: o.description })),
    ...(discoveries.salesOpportunities ?? []).slice(0, 2).map((o) => ({ title: o.title, subtitle: o.description })),
    ...(stalled ? [{ title: ar ? `${stalled} صفقات متوقفة تحتاج دفعة` : `${stalled} stalled deals could use a nudge`, href: "/sales" }] : []),
    ...(pendingApprovals ? [{ title: ar ? `${pendingApprovals} عناصر بانتظار موافقتك` : `${pendingApprovals} items are waiting for your approval`, href: "/approvals" }] : []),
  ];
  return { type: "opportunities" as const, title: ar ? "فرص النمو" : "Growth opportunities", summary: ar ? "هذه أهم الفرص الآن:" : "Here's what stands out right now:", items, actions: [{ label: "create_content", href: "/content", primary: true }] };
}

defineWorkflow("command", {
  agent: "SOCIAL_MANAGER",
  steps: ["understanding_goal"],
  async run(ctx) {
    const b = await loadBrain(ctx.scope);
    const intent = await ctx.step("understanding_goal", async () => {
      const res = await aiStructured(ctx.ai, {
        task: "CLASSIFICATION",
        schemaName: "command_intent",
        schema: commandIntentSchema,
        system: [
          "Route a business owner's request to the right AI team workflow.",
          "create_content_plan: posts/captions/weekly content. create_campaign: a campaign or launch. analyze_performance: how content performed, why, best/worst. leads_followup: follow up with leads. pipeline_summary: deals, pipeline, stalled. find_opportunities: what to do next / opportunities. ask_question: anything answerable from company knowledge.",
          "Extract count, platform, topic and days when stated. The request may be in Arabic or English.",
          brainPrompt(b).split("\n")[0],
        ].join("\n"),
        prompt: ctx.input,
        offline: () => offlineIntent(ctx.input),
      });
      return res.data;
    });

    const kind = INTENT_TO_WORKFLOW[intent.intent];
    if (kind) {
      const wf = getWorkflow(kind)!;
      await ctx.plan(wf.steps);
      Object.assign(ctx.params, { count: intent.count ?? undefined, platform: intent.platform, topic: intent.topic, days: intent.days, withDesigns: kind === "content_plan" });
      return wf.run(ctx);
    }
    if (intent.intent === "pipeline_summary") {
      await ctx.plan(["reviewing_pipeline"]);
      return pipelineSummary(ctx);
    }
    if (intent.intent === "find_opportunities") {
      await ctx.plan(["finding_opportunities"]);
      return opportunities(ctx);
    }
    await ctx.plan(["searching_knowledge", "writing_answer"]);
    return answerQuestion(ctx);
  },
});
