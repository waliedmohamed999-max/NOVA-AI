import type { PlanTier } from "@/generated/prisma/enums";
import { audit } from "../audit";
import { UserFacingError } from "../errors";
import { applyPlan, canMoveTo, getUsage } from "./entitlements";
import { UnconfiguredPayments, type PaymentProvider } from "./provider";

let provider: PaymentProvider = new UnconfiguredPayments();

export function paymentProvider(): PaymentProvider {
  return provider;
}

/** Test/extension hook for plugging a real payment adapter. */
export function setPaymentProvider(p: PaymentProvider) {
  provider = p;
}

export { getUsage };

/**
 * Plan change entry point. Downgrades are validated against current usage.
 * Paid changes always go through the payment provider; without one, the
 * request is refused with `billing_not_configured` (never a fake success).
 */
export async function requestPlanChange(input: { organizationId: string; plan: PlanTier; email: string; actorId: string }) {
  const check = await canMoveTo(input.organizationId, input.plan);
  if (!check.ok) throw new UserFacingError("plan_limit");
  if (!provider.isConfigured()) throw new UserFacingError("billing_not_configured");
  const url = await provider.checkoutUrl({ organizationId: input.organizationId, plan: input.plan, email: input.email });
  await audit({ organizationId: input.organizationId, actorType: "USER", actorId: input.actorId, action: "billing.plan_change_started", summary: `Plan change to ${input.plan} started (${check.direction})` });
  return { url };
}

/** Called by a payment adapter once the provider confirms a subscription change. */
export async function confirmPlanChange(organizationId: string, plan: PlanTier) {
  await applyPlan(organizationId, plan);
  await audit({ organizationId, actorType: "SYSTEM", action: "billing.plan_changed", summary: `Plan changed to ${plan}` });
}
