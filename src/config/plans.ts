import type { PlanTier } from "@/generated/prisma/enums";

/**
 * Plan entitlements. Prices intentionally live in the billing provider
 * (e.g. Stripe price IDs via env) — never hardcoded here.
 */
export type PlanEntitlements = {
  tier: PlanTier;
  businesses: number;
  socialChannels: number;
  seats: number;
  agents: readonly string[];
  /** Internal cost tracking (micro-USD); not a customer-facing limit. */
  aiMonthlyAllowanceMicro: bigint;
  /** AI tokens (input + output) included every month. Running out pauses AI until next month or a top-up. */
  aiMonthlyTokens: bigint;
  /** AI image generations + edits per month (drafts, variants and edits all count). */
  imageGenerationsPerMonth: number;
  analytics: "basic" | "advanced";
  automation: boolean;
  advancedPermissions: boolean;
  priceEnvKey: string;
};

export const PLANS: Record<PlanTier, PlanEntitlements> = {
  STARTER: {
    tier: "STARTER",
    businesses: 1,
    socialChannels: 2,
    seats: 2,
    agents: ["SOCIAL_MANAGER", "CONTENT_STRATEGIST", "DESIGNER", "PERFORMANCE_ANALYST"],
    aiMonthlyAllowanceMicro: 20_000_000n,
    aiMonthlyTokens: 2_000_000n,
    imageGenerationsPerMonth: 30,
    analytics: "basic",
    automation: false,
    advancedPermissions: false,
    priceEnvKey: "STRIPE_PRICE_STARTER",
  },
  GROWTH: {
    tier: "GROWTH",
    businesses: 1,
    socialChannels: 5,
    seats: 5,
    agents: [
      "SOCIAL_MANAGER",
      "CONTENT_STRATEGIST",
      "DESIGNER",
      "PERFORMANCE_ANALYST",
      "SALES_AGENT",
      "SALES_ASSISTANT",
    ],
    aiMonthlyAllowanceMicro: 75_000_000n,
    aiMonthlyTokens: 7_500_000n,
    imageGenerationsPerMonth: 150,
    analytics: "advanced",
    automation: false,
    advancedPermissions: false,
    priceEnvKey: "STRIPE_PRICE_GROWTH",
  },
  SCALE: {
    tier: "SCALE",
    businesses: 5,
    socialChannels: 20,
    seats: 25,
    agents: [
      "SOCIAL_MANAGER",
      "CONTENT_STRATEGIST",
      "DESIGNER",
      "PERFORMANCE_ANALYST",
      "SALES_AGENT",
      "SALES_ASSISTANT",
    ],
    aiMonthlyAllowanceMicro: 250_000_000n,
    aiMonthlyTokens: 25_000_000n,
    imageGenerationsPerMonth: 600,
    analytics: "advanced",
    automation: true,
    advancedPermissions: true,
    priceEnvKey: "STRIPE_PRICE_SCALE",
  },
};

export const PLAN_ORDER: PlanTier[] = ["STARTER", "GROWTH", "SCALE"];

/**
 * Extra AI tokens sold as one-time packs (Stripe price STRIPE_PRICE_AI_TOPUP, one pack = AI_TOPUP_TOKENS tokens).
 * Purchased tokens never expire and are used only after the monthly allowance runs out.
 */
export function topUpPack() {
  const tokens = Number(process.env.AI_TOPUP_TOKENS ?? 1_000_000);
  return { tokens: BigInt(Number.isInteger(tokens) && tokens > 0 ? tokens : 1_000_000), maxPacks: 20 };
}
