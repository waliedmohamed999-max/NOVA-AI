import type { PlanTier } from "@/generated/prisma/enums";
import { audit } from "../audit";
import { UserFacingError } from "../errors";
import { applyPlan, canMoveTo, getUsage } from "./entitlements";
import { UnconfiguredPayments, type PaymentProvider } from "./provider";
import { StripePaymentProvider } from "./stripe";

let override: PaymentProvider | null = null;

/** Stripe when its keys, webhook secret and prices are set; otherwise the honest "not configured" provider. */
export function paymentProvider(): PaymentProvider {
  if (override) return override;
  const stripe = new StripePaymentProvider();
  return stripe.isConfigured() ? stripe : new UnconfiguredPayments();
}

/** Test/extension hook for plugging a payment adapter (null restores the default). */
export function setPaymentProvider(p: PaymentProvider | null) {
  override = p;
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
  const provider = paymentProvider();
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

export async function billingPortalUrl(organizationId: string) {
  const provider = paymentProvider();
  if (!provider.isConfigured() || !provider.portalUrl) throw new UserFacingError("billing_not_configured");
  return provider.portalUrl(organizationId);
}

export async function cancelSubscription(organizationId: string, actorId: string) {
  const provider = paymentProvider();
  if (!provider.isConfigured() || !provider.cancel) throw new UserFacingError("billing_not_configured");
  await provider.cancel(organizationId);
  // The subscription status changes when Stripe's webhook confirms it — not here.
  await audit({ organizationId, actorType: "USER", actorId, action: "billing.cancel_requested", summary: "Cancellation at period end requested" });
}
