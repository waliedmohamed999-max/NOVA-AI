import { Prisma } from "@/generated/prisma/client";
import { db } from "../../db/client";
import { aiAvailability, aiStructured } from "../../ai";
import { ingestSource, type WebsiteSignals } from "../../knowledge/service";
import { brainMeta } from "../../knowledge/company-context";
import { onboardingContext } from "../../knowledge/use-cases";
import { notify } from "../../notifications/service";
import { audit } from "../../audit";
import { defineWorkflow } from "../runtime";
import { companyAnalysisSchema } from "../schemas";
import { offlineAnalysis, type OnboardingAnswers } from "../offline-content";

export const ONBOARDING_STEPS = [
  "understanding_business",
  "analyzing_brand",
  "building_audience",
  "reviewing_services",
  "creating_strategy",
  "preparing_team",
];

defineWorkflow("onboarding_analysis", {
  agent: "SOCIAL_MANAGER",
  steps: ONBOARDING_STEPS,
  async run(ctx) {
    const { scope } = ctx;
    const org = await db.organization.findUniqueOrThrow({ where: { id: scope.organizationId } });
    const answers = (org.onboardingData ?? {}) as OnboardingAnswers;
    const lang = org.locale === "ar" ? "ar" : "en";

    // 1. Understand the business: make sure the website has been read.
    const site = await ctx.step("understanding_business", async () => {
      const source = await db.knowledgeSource.findFirst({ where: { ...scope, type: "WEBSITE" }, orderBy: { createdAt: "desc" } });
      if (source && (source.status === "PENDING" || source.status === "PROCESSING")) await ingestSource(scope, source.id);
      const fresh = source ? await db.knowledgeSource.findUnique({ where: { id: source.id } }) : null;
      return ((fresh?.metadata as { signals?: WebsiteSignals } | null)?.signals ?? null) as WebsiteSignals | null;
    });

    // 2–5. One structured analysis grounded in the answers + retrieved website text.
    const analysis = await ctx.step("analyzing_brand", async () => {
      // No AI provider yet: finish onboarding from the owner's own answers (labelled as such) instead of blocking.
      // The owner can refine the profile later from Company Brain once a provider is configured.
      if (!aiAvailability().configured) {
        return { data: offlineAnalysis(lang, { ...answers, companyName: org.name }, site), generatedBy: "owner_answers", offline: true };
      }
      // The one use case that needs page text: the owner's own website, top-8 cleaned/deduped chunks within a fixed budget.
      const site8 = await onboardingContext(scope, [answers.sells, answers.description, answers.customers, org.name].filter(Boolean).join(" "));
      const prompt = [
        `Company name: ${org.name}`,
        answers.website && `Website: ${answers.website}`,
        answers.description && `How the owner describes the company: ${answers.description}`,
        answers.sells && `What they sell: ${answers.sells}`,
        answers.offerings?.length && `Listed offerings: ${answers.offerings.join(", ")}`,
        answers.customers && `Who their customers are: ${answers.customers}`,
        answers.customerType && `Customer type: ${answers.customerType}`,
        answers.markets && `Markets: ${answers.markets}`,
        answers.tone?.length && `Desired brand personality: ${answers.tone.join(", ")}`,
        answers.goals?.length && `Goals: ${answers.goals.join(", ")}`,
        site && `Website title: ${site.title}\nWebsite description: ${site.description ?? "n/a"}\nWebsite headings: ${site.headings.join(" | ")}`,
        site && Object.keys(site.social).length && `Existing social accounts: ${Object.keys(site.social).join(", ")}`,
        site8.chunks.length ? `Relevant website content:\n${site8.chunks.map((c, i) => `[${i + 1}] ${c.title ? `${c.title}: ` : ""}${c.text}`).join("\n")}` : "Relevant website content: none found.",
      ]
        .filter(Boolean)
        .join("\n\n");

      return aiStructured(ctx.ai, {
        task: "STRATEGY",
        schemaName: "company_analysis",
        brain: brainMeta(site8),
        schema: companyAnalysisSchema,
        system: [
          "You are the strategy lead of an AI growth team onboarding a new client company.",
          "Build an accurate company profile ONLY from the information provided. Do not invent facts, prices, awards, client names or statistics.",
          "When information is missing, keep fields general or empty rather than guessing specifics.",
          `Write every text field in ${lang === "ar" ? "Arabic" : "English"}.`,
        ].join("\n"),
        prompt,
        offline: () => offlineAnalysis(lang, { ...answers, companyName: org.name }, site),
      });
    });
    const a = analysis.data;

    await ctx.step("building_audience", async () => {
      // The owner's own audience (saved during setup) stays first; the analysis only adds to it.
      const current = await db.companyProfile.findFirst({ where: scope, select: { audience: true } });
      const owner = ((current?.audience ?? []) as { source?: string }[]).filter((x) => x.source === "owner");
      await db.companyProfile.updateMany({
        where: scope,
        data: { audience: [...owner, ...a.audience].slice(0, 5) as Prisma.InputJsonValue, markets: answers.markets ? [answers.markets] : [] },
      });
    });

    await ctx.step("reviewing_services", async () => {
      const existing = await db.offering.count({ where: scope });
      if (existing === 0 && a.offerings.length) {
        await db.offering.createMany({
          data: a.offerings.map((o) => ({ ...scope, name: o.name.slice(0, 120), type: o.type, description: o.description || null })),
        });
      }
    });

    await ctx.step("creating_strategy", async () => {
      const kit = await db.brandKit.findFirst({ where: scope });
      const current = await db.companyProfile.findFirst({ where: scope, select: { industry: true, description: true } });
      await db.brandKit.updateMany({
        where: scope,
        data: {
          // The voice the owner picked wins over any inferred one.
          tone: answers.tone?.length ? answers.tone.join(lang === "ar" ? "، " : ", ") : a.brandVoice.tone,
          voiceTraits: answers.tone?.length ? answers.tone : a.brandVoice.traits,
          doSay: a.brandVoice.doSay,
          dontSay: a.brandVoice.dontSay,
          primaryColors: kit?.primaryColors.length ? kit.primaryColors : (answers.colors?.length ? answers.colors : site?.themeColor ? [site.themeColor] : []),
        },
      });
      await db.companyProfile.updateMany({
        where: scope,
        data: {
          summary: a.summary,
          description: current?.description || answers.description || a.summary,
          tagline: a.tagline,
          industry: current?.industry || a.industry,
          valueProps: a.valueProps,
          contentPillars: a.contentPillars.map((p) => p.name),
          goals: answers.goals ?? [],
          primaryGoal: answers.goals?.[0] ?? null,
          strategy: a.strategy as Prisma.InputJsonValue,
          discoveries: {
            brand: { tone: a.brandVoice.tone, traits: a.brandVoice.traits },
            audience: a.audience,
            contentOpportunities: a.contentOpportunities,
            salesOpportunities: a.salesOpportunities,
            recommendedChannels: a.recommendedChannels,
            strategy: a.strategy,
            pillars: a.contentPillars,
            generatedBy: analysis.generatedBy,
          } as Prisma.InputJsonValue,
          completeness: 70,
        },
      });
      // The answers themselves become part of the company brain.
      const lines = Object.entries(answers)
        .filter(([, v]) => v && (!Array.isArray(v) || v.length))
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
      const hasManual = await db.knowledgeSource.findFirst({ where: { ...scope, type: "MANUAL", title: "Onboarding answers" } });
      if (!hasManual && lines.length) {
        const { addKnowledgeSource } = await import("../../knowledge/service");
        await addKnowledgeSource(scope, { type: "MANUAL", title: "Onboarding answers", rawText: lines.join("\n") });
      }
    });

    await ctx.step("preparing_team", async () => {
      await db.agent.updateMany({ where: { ...scope, enabled: true }, data: { status: "MONITORING", lastActiveAt: new Date() } });
      await db.organization.update({ where: { id: scope.organizationId }, data: { onboardingStatus: "COMPLETED" } });
      await ctx.task("SOCIAL_MANAGER", lang === "ar" ? "حلّل الشركة وبنى الاستراتيجية الأولى" : "Analyzed the company and built the first strategy");
      await notify({ ...scope, type: "AI_RECOMMENDATION", title: lang === "ar" ? "فريق النمو الذكي جاهز" : "Your AI Growth Team is ready", link: "/home" });
      await audit({ ...scope, actorType: "AGENT", actorLabel: "AI Social Manager", action: "brain.onboarding_analysis", summary: `AI analyzed ${org.name} and prepared the initial strategy` });
    });

    return {
      type: "onboarding",
      title: lang === "ar" ? "فريق النمو الذكي جاهز" : "Your AI Growth Team is ready",
      summary: a.summary,
      offline: analysis.offline,
    };
  },
});
