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
  aiMonthlyAllowanceMicro: bigint;
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
    analytics: "advanced",
    automation: true,
    advancedPermissions: true,
    priceEnvKey: "STRIPE_PRICE_SCALE",
  },
};

export const PLAN_ORDER: PlanTier[] = ["STARTER", "GROWTH", "SCALE"];
