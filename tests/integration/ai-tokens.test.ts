import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { currentPeriod, getBudgetStatus, recordUsage } from "@/server/ai/budget";
import { grantTokens } from "@/server/billing/tokens";
import { handleStripeEvent } from "@/server/billing/stripe";
import { requestTokenTopUp, setPaymentProvider } from "@/server/billing/service";
import { applyPlan } from "@/server/billing/entitlements";
import { PLANS } from "@/config/plans";
import type { PaymentProvider } from "@/server/billing/provider";
import { makeTenant } from "../support/factory";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const org = (t: Tenant) => t.organization.id;
const use = (t: Tenant, tokens: number) => recordUsage({ organizationId: org(t), inputTokens: tokens, outputTokens: 0, costMicro: 0n });
const setTokens = (t: Tenant, monthlyTokens: bigint, extraTokens = 0n) => db.aiBudget.update({ where: { organizationId: org(t) }, data: { monthlyTokens, extraTokens } });

afterEach(() => setPaymentProvider(null));

describe("AI tokens per organization", () => {
  it("new organizations get their plan's monthly tokens; plan changes update them", async () => {
    const t = await makeTenant("Plan Tokens Co");
    expect((await db.aiBudget.findUniqueOrThrow({ where: { organizationId: org(t) } })).monthlyTokens).toBe(PLANS.STARTER.aiMonthlyTokens);
    await applyPlan(org(t), "SCALE");
    expect((await getBudgetStatus(org(t))).monthlyTokens).toBe(PLANS.SCALE.aiMonthlyTokens);
  });

  it("uses the monthly tokens first, then extra tokens, then stops", async () => {
    const t = await makeTenant("Accounting Co");
    await setTokens(t, 1000n, 500n);

    await use(t, 700);
    let s = await getBudgetStatus(org(t));
    expect(s).toMatchObject({ usedTokens: 700n, remainingMonthly: 300n, extraTokens: 500n, availableTokens: 800n, state: "ok" });

    await use(t, 500); // 300 from the month, 200 from extra
    s = await getBudgetStatus(org(t));
    expect(s).toMatchObject({ remainingMonthly: 0n, extraTokens: 300n, availableTokens: 300n, state: "extra" });

    await use(t, 1000); // more than what's left: extra floors at 0
    s = await getBudgetStatus(org(t));
    expect(s).toMatchObject({ extraTokens: 0n, availableTokens: 0n, state: "exhausted" });
  });

  it("warns once at the soft limit and once when used up", async () => {
    const t = await makeTenant("Warn Co");
    await setTokens(t, 1000n);
    await use(t, 850);
    await use(t, 50);
    await use(t, 200);
    await use(t, 10);
    const notes = await db.notification.findMany({ where: { organizationId: org(t), type: "USAGE_LIMIT" }, orderBy: { createdAt: "asc" } });
    expect(notes.map((n) => n.title)).toEqual([expect.stringContaining("85%"), "Your AI tokens are used up"]);
    const budget = await db.aiBudget.findUniqueOrThrow({ where: { organizationId: org(t) } });
    expect(budget).toMatchObject({ softLimitNotifiedFor: currentPeriod(), exhaustedNotifiedFor: currentPeriod() });
  });

  it("a grant adds extra tokens once per payment and re-arms the used-up warning", async () => {
    const t = await makeTenant("Grant Co");
    await setTokens(t, 100n);
    await use(t, 150);
    expect((await getBudgetStatus(org(t))).state).toBe("exhausted");

    expect(await grantTokens(org(t), 1_000_000n, { source: "stripe", externalId: "cs_test_1" })).toBe("granted");
    expect(await grantTokens(org(t), 1_000_000n, { source: "stripe", externalId: "cs_test_1" })).toBe("duplicate");
    const s = await getBudgetStatus(org(t));
    expect(s).toMatchObject({ extraTokens: 1_000_000n, state: "extra" });
    expect((await db.aiBudget.findUniqueOrThrow({ where: { organizationId: org(t) } })).exhaustedNotifiedFor).toBeNull();
    expect(await db.aiTokenGrant.count({ where: { organizationId: org(t) } })).toBe(1);
  });
});

describe("buying extra tokens", () => {
  async function customer(t: Tenant, id: string) {
    await db.subscription.update({ where: { organizationId: org(t) }, data: { billingProvider: "stripe", providerCustomerId: id } });
  }
  const paid = (eventId: string, o: { org: string; customer: string; session: string; tokens?: string; status?: string }) => ({
    id: eventId,
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: o.session, object: "checkout.session", mode: "payment", customer: o.customer, payment_status: o.status ?? "paid", amount_total: 1500, currency: "usd", metadata: { organizationId: o.org, kind: "ai_topup", packs: "1", tokens: o.tokens ?? "1000000" } } },
  });

  it("credits tokens from Stripe's confirmed payment, exactly once", async () => {
    const t = await makeTenant("Buyer Co");
    await customer(t, "cus_buyer");
    expect(await handleStripeEvent(paid("evt_topup_1", { org: org(t), customer: "cus_buyer", session: "cs_buy_1" }))).toBe("processed");
    expect(await handleStripeEvent(paid("evt_topup_1", { org: org(t), customer: "cus_buyer", session: "cs_buy_1" }))).toBe("duplicate");
    // Stripe can resend the same session under a new event id: still credited once.
    await handleStripeEvent(paid("evt_topup_2", { org: org(t), customer: "cus_buyer", session: "cs_buy_1" }));
    expect((await getBudgetStatus(org(t))).extraTokens).toBe(1_000_000n);
    expect(await db.aiTokenGrant.findFirst({ where: { organizationId: org(t) } })).toMatchObject({ source: "stripe", externalId: "cs_buy_1", amountCents: 1500, currency: "USD" });
  });

  it("ignores unpaid sessions and sessions from another customer", async () => {
    const t = await makeTenant("Careful Co");
    await customer(t, "cus_careful");
    await handleStripeEvent(paid("evt_topup_3", { org: org(t), customer: "cus_careful", session: "cs_unpaid", status: "unpaid" }));
    await handleStripeEvent(paid("evt_topup_4", { org: org(t), customer: "cus_someone_else", session: "cs_forged" }));
    expect((await getBudgetStatus(org(t))).extraTokens).toBe(0n);
  });

  it("starts checkout through the payment provider, or refuses honestly without one", async () => {
    const t = await makeTenant("Checkout Co");
    await expect(requestTokenTopUp({ organizationId: org(t), packs: 1, email: "o@x.test", actorId: t.user.id })).rejects.toMatchObject({ code: "billing_not_configured" });

    const calls: { packs: number; tokensPerPack: bigint }[] = [];
    const fake: PaymentProvider = {
      name: "fake",
      isConfigured: () => true,
      checkoutUrl: async () => "https://pay.test/plan",
      tokenTopUpUrl: async (i) => {
        calls.push({ packs: i.packs, tokensPerPack: i.tokensPerPack });
        return "https://pay.test/tokens";
      },
    };
    setPaymentProvider(fake);
    expect(await requestTokenTopUp({ organizationId: org(t), packs: 3, email: "o@x.test", actorId: t.user.id })).toEqual({ url: "https://pay.test/tokens" });
    expect(calls).toEqual([{ packs: 3, tokensPerPack: 1_000_000n }]);
    await expect(requestTokenTopUp({ organizationId: org(t), packs: 0, email: "o@x.test", actorId: t.user.id })).rejects.toMatchObject({ code: "validation" });
    // Nothing is credited until the payment is confirmed by the webhook.
    expect((await getBudgetStatus(org(t))).extraTokens).toBe(0n);
  });
});
