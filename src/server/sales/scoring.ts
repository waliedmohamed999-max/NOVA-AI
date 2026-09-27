import type { LeadTemperature } from "@/generated/prisma/enums";

/**
 * Transparent rules-based lead score. Runs instantly for every new lead; the
 * Sales Agent may refine it with AI, and both are stored in lead_scores.
 */
export type ScoreInput = {
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  channel?: string | null;
  campaignId?: string | null;
  interests?: string[];
  estimatedValueCents?: number | null;
};

const BUYING_SIGNALS = [
  /\b(price|pricing|quote|cost|budget|buy|purchase|proposal|contract|demo|meeting|call)\b/i,
  /\b(asap|urgent|this week|today|immediately|deadline)\b/i,
  /(سعر|أسعار|الأسعار|عرض سعر|تكلفة|ميزانية|شراء|اشتراك|عقد|اجتماع|مكالمة|عرض)/,
  /(عاجل|بسرعة|هذا الأسبوع|اليوم|فورًا|فورا)/,
];

export function scoreLead(input: ScoreInput): { score: number; temperature: LeadTemperature; reasons: string[] } {
  let score = 10;
  const reasons: string[] = [];
  if (input.email) {
    score += 10;
    reasons.push("has_email");
    if (!/@(gmail|yahoo|hotmail|outlook|icloud)\./i.test(input.email)) {
      score += 8;
      reasons.push("business_email");
    }
  }
  if (input.phone) {
    score += 10;
    reasons.push("has_phone");
  }
  if (input.company) {
    score += 8;
    reasons.push("has_company");
  }
  const msg = input.message ?? "";
  if (msg.length > 60) {
    score += 8;
    reasons.push("detailed_message");
  }
  const signals = BUYING_SIGNALS.filter((r) => r.test(msg)).length;
  if (signals) {
    score += Math.min(30, signals * 15);
    reasons.push("buying_intent");
  }
  if (input.campaignId) {
    score += 6;
    reasons.push("campaign_attributed");
  }
  if (input.interests?.length) {
    score += 5;
    reasons.push("stated_interest");
  }
  if (input.estimatedValueCents && input.estimatedValueCents > 0) {
    score += 5;
    reasons.push("value_known");
  }
  score = Math.max(0, Math.min(100, score));
  return { score, temperature: temperatureFor(score), reasons };
}

export function temperatureFor(score: number): LeadTemperature {
  return score >= 70 ? "HOT" : score >= 40 ? "WARM" : "COLD";
}
