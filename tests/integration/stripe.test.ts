import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { handleStripeEvent, StripePaymentProvider, stripeForm, stripeStatus, verifyStripeSignature } from "@/server/billing/stripe";
import { paymentProvider, requestPlanChange } from "@/server/billing/service";

/** Stripe adapter + webhook with the Stripe API mocked (no real charges, no network). */
const SECRET = "whsec_test_0123456789abcdef";
const saved: Record<string, string | undefined> = {};
function env(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in saved)) saved[k] = process.env[k];
    process.env[k] = v;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
});
const stripeEnv = () => env({ STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_STARTER: "price_starter", STRIPE_PRICE_GROWTH: "price_growth", STRIPE_PRICE_SCALE: "price_scale", APP_URL: "https://app.nova.test" });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

type Call = { method: string; path: string; body: string; idem: string | null };
function mockStripe(subs: Record<string, { status: string; price: string; customer: string; cancel?: boolean; org?: string }>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const h = new Headers(init?.headers);
    calls.push({ method: init?.method ?? "GET", path: url.pathname, body: String(init?.body ?? ""), idem: h.get("idempotency-key") });
    expect(h.get("authorization")).toBe("Bearer sk_test_abc");
    if (url.pathname === "/v1/customers") return json({ id: "cus_1" });
    if (url.pathname === "/v1/checkout/sessions") return json({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    if (url.pathname === "/v1/billing_portal/sessions") return json({ url: "https://billing.stripe.com/p/session/1" });
    const m = /^\/v1\/subscriptions\/(.+)$/.exec(url.pathname);
    if (m) {
      const s = subs[m[1]];
      if (!s) return json({ error: { message: "No such subscription" } }, 404);
      if (init?.method === "POST") {
        const p = new URLSearchParams(String(init.body));
        if (p.get("cancel_at_period_end") === "true") s.cancel = true;
        if (p.get("items[0][price]")) s.price = p.get("items[0][price]")!;
      }
      return json({ id: m[1], customer: s.customer, status: s.status, cancel_at_period_end: Boolean(s.cancel), current_period_end: 1_900_000_000, metadata: s.org ? { organizationId: s.org } : {}, items: { data: [{ id: "si_1", price: { id: s.price } }] } });
    }
    return json({ error: { message: `unmocked ${url.pathname}` } }, 500);
  }));
  return calls;
}
const sign = (payload: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${payload}`).digest("hex")}`;
const event = (id: string, type: string, object: Record<string, unknown>) => ({ id, type, created: Math.floor(Date.now() / 1000), data: { object } });

describe("Stripe", () => {
  it("is off (honest billing_not_configured) until keys, webhook secret and prices are set", async () => {
    env({ STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", STRIPE_PRICE_GROWTH: "" });
    expect(paymentProvider().name).toBe("none");
    const t = await makeTenant();
    await expect(requestPlanChange({ organizationId: t.organization.id, plan: "GROWTH", email: "a@b.test", actorId: t.user.id })).rejects.toMatchObject({ code: "billing_not_configured" });
    stripeEnv();
    expect(paymentProvider().name).toBe("stripe");
  });

  it("verifies signatures with a 5-minute tolerance and constant-time compare", () => {
    stripeEnv();
    const payload = JSON.stringify({ id: "evt_1" });
    expect(verifyStripeSignature(payload, sign(payload))).toBe(true);
    expect(verifyStripeSignature(payload + " ", sign(payload))).toBe(false);
    expect(verifyStripeSignature(payload, sign(payload, Math.floor(Date.now() / 1000) - 600))).toBe(false);
    expect(verifyStripeSignature(payload, `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`)).toBe(false);
    expect(verifyStripeSignature(payload, null)).toBe(false);
    expect(verifyStripeSignature(payload, sign(payload), "")).toBe(false);
  });

  it("checkout creates one customer and a subscription session; the plan changes only via webhook", async () => {
    stripeEnv();
    const t = await makeTenant();
    const calls = mockStripe({});
    const { url } = await requestPlanChange({ organizationId: t.organization.id, plan: "GROWTH", email: "owner@acme.test", actorId: t.user.id });
    expect(url).toBe("https://checkout.stripe.com/c/pay/cs_1");
    const session = new URLSearchParams(calls.find((c) => c.path === "/v1/checkout/sessions")!.body);
    expect(session.get("mode")).toBe("subscription");
    expect(session.get("line_items[0][price]")).toBe("price_growth");
    expect(session.get("client_reference_id")).toBe(t.organization.id);
    expect(calls.every((c) => c.method === "GET" || c.idem || c.path === "/v1/billing_portal/sessions")).toBe(true);
    // Nothing changed yet — no fake success.
    expect((await db.subscription.findUniqueOrThrow({ where: { organizationId: t.organization.id } })).plan).not.toBe("GROWTH");
  });

  it("webhook: applies the plan from Stripe's subscription, ignores duplicates, syncs invoices, handles cancel", async () => {
    stripeEnv();
    const t = await makeTenant();
    await db.subscription.update({ where: { organizationId: t.organization.id }, data: { billingProvider: "stripe", providerCustomerId: "cus_w1" } });
    const subs = { sub_1: { status: "active", price: "price_growth", customer: "cus_w1" } };
    mockStripe(subs);

    const e1 = event("evt_1", "customer.subscription.created", { id: "sub_1", customer: "cus_w1", status: "active" });
    expect(await handleStripeEvent(e1)).toBe("processed");
    let sub = await db.subscription.findUniqueOrThrow({ where: { organizationId: t.organization.id } });
    expect(sub).toMatchObject({ plan: "GROWTH", status: "ACTIVE", providerSubscriptionId: "sub_1" });
    expect(await handleStripeEvent(e1)).toBe("duplicate");
    expect(await db.billingEvent.count({ where: { externalId: "evt_1" } })).toBe(1);

    await handleStripeEvent(event("evt_2", "invoice.paid", { id: "in_1", customer: "cus_w1", status: "paid", amount_due: 4900, amount_paid: 4900, currency: "usd", hosted_invoice_url: "https://invoice.stripe.com/i/1" }));
    expect(await db.invoice.findFirstOrThrow({ where: { organizationId: t.organization.id } })).toMatchObject({ providerInvoiceId: "in_1", amountPaidCents: 4900, currency: "USD", status: "paid" });

    // Out-of-order "past_due" event: the adapter re-reads Stripe, so the stored state follows Stripe, not the payload.
    subs.sub_1.status = "past_due";
    await handleStripeEvent(event("evt_3", "customer.subscription.updated", { id: "sub_1", status: "active" }));
    sub = await db.subscription.findUniqueOrThrow({ where: { organizationId: t.organization.id } });
    expect(sub.status).toBe("PAST_DUE");

    // Cancel → cancel_at_period_end; ends → STARTER.
    await new StripePaymentProvider().cancel(t.organization.id);
    await handleStripeEvent(event("evt_4", "customer.subscription.updated", { id: "sub_1" }));
    expect((await db.subscription.findUniqueOrThrow({ where: { organizationId: t.organization.id } })).cancelAtPeriodEnd).toBe(true);
    subs.sub_1.status = "canceled";
    await handleStripeEvent(event("evt_5", "customer.subscription.deleted", { id: "sub_1" }));
    sub = await db.subscription.findUniqueOrThrow({ where: { organizationId: t.organization.id } });
    expect(sub).toMatchObject({ status: "CANCELED", plan: "STARTER" });
  });

  it("an existing subscription changes plan in place (upgrade/downgrade with proration)", async () => {
    stripeEnv();
    const t = await makeTenant();
    await db.subscription.update({ where: { organizationId: t.organization.id }, data: { billingProvider: "stripe", providerCustomerId: "cus_2", providerSubscriptionId: "sub_2", status: "ACTIVE", plan: "GROWTH" } });
    const subs = { sub_2: { status: "active", price: "price_growth", customer: "cus_2" } };
    const calls = mockStripe(subs);
    const { url } = await requestPlanChange({ organizationId: t.organization.id, plan: "SCALE", email: "o@acme.test", actorId: t.user.id });
    expect(url).toContain("/settings/billing?change=pending");
    const change = new URLSearchParams(calls.find((c) => c.method === "POST" && c.path === "/v1/subscriptions/sub_2")!.body);
    expect(change.get("items[0][price]")).toBe("price_scale");
    expect(change.get("proration_behavior")).toBe("create_prorations");
    await handleStripeEvent(event("evt_up", "customer.subscription.updated", { id: "sub_2" }));
    expect((await db.subscription.findUniqueOrThrow({ where: { organizationId: t.organization.id } })).plan).toBe("SCALE");
  });

  it("events for customers NOVA doesn't know are acknowledged but change nothing", async () => {
    stripeEnv();
    mockStripe({ sub_x: { status: "active", price: "price_scale", customer: "cus_unknown", org: "not-an-org" } });
    expect(await handleStripeEvent(event("evt_x", "customer.subscription.created", { id: "sub_x" }))).toBe("processed");
    expect(await db.subscription.count({ where: { providerSubscriptionId: "sub_x" } })).toBe(0);
  });

  it("helpers: form encoding and status mapping", () => {
    expect(stripeForm({ a: 1, line_items: [{ price: "p", quantity: 1 }], metadata: { org: "x" } }).join("&")).toBe("a=1&line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Borg%5D=x");
    expect(["trialing", "active", "past_due", "unpaid", "canceled", "incomplete"].map(stripeStatus)).toEqual(["TRIALING", "ACTIVE", "PAST_DUE", "PAST_DUE", "CANCELED", "INCOMPLETE"]);
  });
});
