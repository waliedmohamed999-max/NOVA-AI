import type { PlanTier } from "@/generated/prisma/enums";

/**
 * Payment provider boundary. The product ships with the "unconfigured"
 * provider: plan changes and checkout report `billing_not_configured`, and no
 * payment is ever simulated. A real processor adapter implements this
 * interface (see docs/INTEGRATIONS.md → Billing).
 */
export interface PaymentProvider {
  readonly name: string;
  isConfigured(): boolean;
  checkoutUrl(input: { organizationId: string; plan: PlanTier; email: string }): Promise<string>;
  /** Self-service portal (payment method, invoices, cancel). */
  portalUrl?(organizationId: string): Promise<string>;
  /** Cancel at the end of the paid period. */
  cancel?(organizationId: string): Promise<void>;
}

export class UnconfiguredPayments implements PaymentProvider {
  readonly name = "none";
  isConfigured() {
    return false;
  }
  async checkoutUrl(): Promise<string> {
    throw new Error("Payments are not configured");
  }
}
