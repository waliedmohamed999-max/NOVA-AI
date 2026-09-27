import { z } from "zod";
import { REPLY_INTENTS } from "../approvals/policies";

/**
 * Structured-output schemas for agent work. Every field is required (use
 * `.nullable()` for "may be absent") so the schemas work with strict
 * JSON-schema modes on every provider.
 */

export const PLATFORMS = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "TIKTOK"] as const;
export const FORMATS = ["POST", "CAROUSEL", "STORY", "REEL", "SHORT_VIDEO", "LINKEDIN_POST"] as const;

export const companyAnalysisSchema = z.object({
  summary: z.string().describe("Two or three sentences describing what the company does and for whom."),
  tagline: z.string().nullable(),
  industry: z.string(),
  audience: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        pains: z.array(z.string()),
        motivations: z.array(z.string()),
      }),
    )
    .min(1)
    .max(3),
  brandVoice: z.object({
    tone: z.string(),
    traits: z.array(z.string()).max(5),
    doSay: z.array(z.string()).max(5),
    dontSay: z.array(z.string()).max(5),
  }),
  offerings: z.array(z.object({ name: z.string(), type: z.enum(["PRODUCT", "SERVICE"]), description: z.string() })).max(8),
  valueProps: z.array(z.string()).max(5),
  contentPillars: z.array(z.object({ name: z.string(), description: z.string() })).min(3).max(5),
  recommendedChannels: z.array(z.object({ platform: z.enum(PLATFORMS), reason: z.string() })).min(1).max(4),
  contentOpportunities: z.array(z.object({ title: z.string(), description: z.string() })).min(2).max(4),
  salesOpportunities: z.array(z.object({ title: z.string(), description: z.string() })).min(1).max(3),
  strategy: z.object({
    positioning: z.string(),
    firstMonthFocus: z.string(),
    postingCadence: z.string(),
    kpis: z.array(z.string()).max(5),
  }),
});
export type CompanyAnalysis = z.infer<typeof companyAnalysisSchema>;

export const designBriefSchema = z.object({
  concept: z.string(),
  layout: z.string(),
  visualElements: z.array(z.string()).max(6),
  textOnImage: z.string().nullable(),
  palette: z.array(z.string()).max(5),
});
export type DesignBrief = z.infer<typeof designBriefSchema>;

export const plannedPostSchema = z.object({
  platform: z.enum(PLATFORMS),
  format: z.enum(FORMATS),
  pillar: z.string(),
  title: z.string(),
  hook: z.string(),
  caption: z.string(),
  cta: z.string(),
  hashtags: z.array(z.string()).max(10),
  designBrief: designBriefSchema,
  dayOffset: z.number().int().min(0).max(30),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  rationale: z.string(),
});
export type PlannedPost = z.infer<typeof plannedPostSchema>;

export const contentPlanSchema = z.object({
  summary: z.string(),
  themes: z.array(z.string()).max(6),
  posts: z.array(plannedPostSchema).min(1).max(21),
});
export type ContentPlan = z.infer<typeof contentPlanSchema>;

export const campaignPlanSchema = z.object({
  name: z.string(),
  objective: z.string(),
  audience: z.string(),
  offer: z.string().nullable(),
  concept: z.string(),
  keyMessage: z.string(),
  creativeDirection: z.string(),
  cta: z.string(),
  kpis: z.array(z.string()).max(6),
  channels: z.array(z.enum(PLATFORMS)).min(1),
  durationDays: z.number().int().min(3).max(60),
  posts: z.array(plannedPostSchema).min(1).max(21),
});
export type CampaignPlan = z.infer<typeof campaignPlanSchema>;

export const COMMAND_INTENTS = [
  "create_content_plan",
  "create_campaign",
  "analyze_performance",
  "leads_followup",
  "pipeline_summary",
  "find_opportunities",
  "ask_question",
] as const;

export const commandIntentSchema = z.object({
  intent: z.enum(COMMAND_INTENTS),
  count: z.number().int().min(1).max(21).nullable(),
  platform: z.enum(PLATFORMS).nullable(),
  topic: z.string().nullable(),
  days: z.number().int().min(1).max(60).nullable(),
});
export type CommandIntent = z.infer<typeof commandIntentSchema>;

export const answerSchema = z.object({
  answer: z.string(),
  usedSources: z.array(z.number().int()).max(6),
  suggestedActions: z.array(z.string()).max(3),
});

export const leadQualificationSchema = z.object({
  score: z.number().int().min(0).max(100),
  temperature: z.enum(["HOT", "WARM", "COLD"]),
  intent: z.string(),
  summary: z.string(),
  interests: z.array(z.string()).max(6),
  objections: z.array(z.string()).max(5),
  estimatedValue: z.number().nullable(),
  nextAction: z.string(),
  nextActionInDays: z.number().int().min(0).max(30),
  draftReply: z.string(),
  needsHuman: z.boolean(),
  needsHumanReason: z.string().nullable(),
  /** What the customer's message is about — only safe FAQ intents may be answered automatically. */
  replyIntent: z.enum(REPLY_INTENTS).nullable(),
  sensitiveTopics: z.array(z.enum(["discount", "custom_pricing", "proposal", "contract_promise", "refund", "legal_commitment", "unusual_delivery"])),
  reasons: z.array(z.string()).max(5),
});
export type LeadQualification = z.infer<typeof leadQualificationSchema>;

export const followUpSchema = z.object({
  subject: z.string().nullable(),
  message: z.string(),
  sensitiveTopics: z.array(z.enum(["discount", "custom_pricing", "proposal", "contract_promise", "refund", "legal_commitment", "unusual_delivery"])),
});

export const postInsightSchema = z.object({
  headline: z.string(),
  whatWorked: z.array(z.string()).max(4),
  whatDidnt: z.array(z.string()).max(4),
  tryNext: z.array(z.string()).max(4),
});
export type PostInsight = z.infer<typeof postInsightSchema>;

export const narrativeSchema = z.object({ narrative: z.string(), highlights: z.array(z.string()).max(5) });
