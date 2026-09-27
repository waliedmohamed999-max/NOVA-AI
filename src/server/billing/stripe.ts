import { createHmac } from "node:crypto";
import type { PlanTier, SubscriptionStatus } from "@/generated/prisma/enums";
import { db } from "../db/client";
import { audit } from "../audit";
import { safeEqual } from "../crypto";
import { logger } from "../logger";
import { reportError } from "../observability";
import { applyPlan } from "./entitlements";
import type { PaymentProvider } from "./provider";

/**
 * Stripe adapter (REST over fetch, API version pinned). Plans are applied ONLY from verified webhooks —
 * never from the redirect back from Checkout — so a customer can't grant themselves a plan.
 *
 *   STRIPE_SECRET_KEY        sk_test_… / sk_live_…
 *   STRIPE_WEBHOOK_SECRET    whsec_… (endpoint: {APP_URL}/api/webhooks/stripe)
 *   STRIPE_PRICE_STARTER / _GROWTH / _SCALE   recurring price ids
 */
const API = "https://api.stripe.com/v1";
export const STRIPE_API_VERSION = "2024-06-20";
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "") ?? "";
const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export class StripeError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string | null,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

/** Stripe's form encoding: nested objects/arrays as a[b][0][c]=v. */
export function stripeForm(data: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? out.push(...stripeForm(item as Record<string, unknown>, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)));
    else if (typeof v === "object") out.push(...stripeForm(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

async function stripe<T>(method: "GET" | "POST" | "DELETE", path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${clean(process.env.STRIPE_SECRET_KEY)}`,
      "stripe-version": STRIPE_API_VERSION,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body ? stripeForm(body).join("&") : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } } & T;
  if (!res.ok) throw new StripeError(json.error?.message ?? `Stripe ${res.status}`, res.status, json.error?.code ?? null);
  return json;
}

export function priceFor(plan: PlanTier) {
  return clean(process.env[`STRIPE_PRICE_${plan}`]) || null;
}
export function planForPrice(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null;
  for (const p of ["STARTER", "GROWTH", "SCALE"] as const) if (priceFor(p) === priceId) return p;
  return null;
}

export function stripeStatus(s: string): SubscriptionStatus {
  switch (s) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
    case "incomplete_expired":
      return "CANCELED";
    default:
      return "INCOMPLETE";
  }
}

type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  trial_end?: number | null;
  metadata?: Record<string, string>;
  items: { data: { id: string; price: { id: string }; current_period_end?: number }[] };
};

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  isConfigured() {
    return Boolean(clean(process.env.STRIPE_SECRET_KEY) && clean(process.env.STRIPE_WEBHOOK_SECRET) && priceFor("GROWTH"));
  }

  /** Reuses the organization's Stripe customer, creating it once (idempotent per organization). */
  async ensureCustomer(organizationId: string, email: string) {
    const sub = await db.subscription.findUnique({ where: { organizationId } });
    if (sub?.billingProvider === "stripe" && sub.providerCustomerId) return sub.providerCustomerId;
    const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
    const c = await stripe<{ id: string }>("POST", "/customers", { email, name: org.name, metadata: { organizationId } }, `customer:${organizationId}`);
    await db.subscription.update({ where: { organizationId }, data: { billingProvider: "stripe", providerCustomerId: c.id } });
    return c.id;
  }

  /**
   * New subscription → Checkout. Existing active subscription → plan change on the subscription itself
   * (upgrade/downgrade with proration); the plan is applied when Stripe's webhook confirms it.
   */
  async checkoutUrl({ organizationId, plan, email }: { organizationId: string; plan: PlanTier; email: string }) {
    const price = priceFor(plan);
    if (!price) throw new StripeError(`No Stripe price configured for ${plan}`, 400, "price_missing");
    const sub = await db.subscription.findUnique({ where: { organizationId } });
    if (sub?.billingProvider === "stripe" && sub.providerSubscriptionId && sub.status !== "CANCELED") {
      await this.changePlan(organizationId, plan);
      return `${appUrl()}/settings/billing?change=pending`;
    }
    const customer = await this.ensureCustomer(organizationId, email);
    const session = await stripe<{ url: string }>(
      "POST",
      "/checkout/sessions",
      {
        mode: "subscription",
        customer,
        client_reference_id: organizationId,
        line_items: [{ price, quantity: 1 }],
        success_url: `${appUrl()}/settings/billing?checkout=success`,
        cancel_url: `${appUrl()}/settings/billing?checkout=cancelled`,
        allow_promotion_codes: false,
        metadata: { organizationId, plan },
        subscription_data: { metadata: { organizationId, plan } },
      },
      `checkout:${organizationId}:${plan}:${new Date().toISOString().slice(0, 13)}`,
    );
    return session.url;
  }

  async changePlan(organizationId: string, plan: PlanTier) {
    const sub = await db.subscription.findUniqueOrThrow({ where: { organizationId } });
    const price = priceFor(plan);
    if (!sub.providerSubscriptionId || !price) throw new StripeError("No active Stripe subscription", 400, "no_subscription");
    const current = await stripe<StripeSubscription>("GET", `/subscriptions/${encodeURIComponent(sub.providerSubscriptionId)}`);
    const item = current.items.data[0];
    await stripe("POST", `/subscriptions/${encodeURIComponent(current.id)}`, { items: [{ id: item.id, price }], proration_behavior: "create_prorations", cancel_at_period_end: false, metadata: { organizationId, plan } }, `change:${current.id}:${plan}:${item.price.id}`);
  }

  async cancel(organizationId: string) {
    const sub = await db.subscription.findUniqueOrThrow({ where: { organizationId } });
    if (!sub.providerSubscriptionId) throw new StripeError("No active Stripe subscription", 400, "no_subscription");
    await stripe("POST", `/subscriptions/${encodeURIComponent(sub.providerSubscriptionId)}`, { cancel_at_period_end: true }, `cancel:${sub.providerSubscriptionId}`);
  }

  async portalUrl(organizationId: string) {
    const sub = await db.subscription.findUniqueOrThrow({ where: { organizationId } });
    if (!sub.providerCustomerId) throw new StripeError("No Stripe customer yet", 400, "no_customer");
    const s = await stripe<{ url: string }>("POST", "/billing_portal/sessions", { customer: sub.providerCustomerId, return_url: `${appUrl()}/settings/billing` });
    return s.url;
  }

  /** Authoritative sync from Stripe (used by webhooks — handles out-of-order events). */
  async syncSubscription(subscriptionId: string) {
    const s = await stripe<StripeSubscription>("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
    return applySubscription(s);
  }
}

async function orgForCustomer(customer: string, metadataOrg?: string) {
  const byCustomer = await db.subscription.findFirst({ where: { providerCustomerId: customer }, select: { organizationId: true } });
  if (byCustomer) return byCustomer.organizationId;
  // First event for a brand-new customer: trust only metadata we set ourselves on a customer we created.
  if (metadataOrg && (await db.organization.findUnique({ where: { id: metadataOrg }, select: { id: true } }))) return metadataOrg;
  return null;
}

async function applySubscription(s: StripeSubscription) {
  const organizationId = await orgForCustomer(s.customer, s.metadata?.organizationId);
  if (!organizationId) {
    logger.warn({ subscription: s.id }, "stripe: subscription for unknown customer ignored");
    return null;
  }
  const status = stripeStatus(s.status);
  const plan = planForPrice(s.items.data[0]?.price.id);
  const periodEnd = s.current_period_end ?? s.items.data[0]?.current_period_end;
  const before = await db.subscription.findUniqueOrThrow({ where: { organizationId } });
  await db.subscription.update({
    where: { organizationId },
    data: {
      billingProvider: "stripe",
      providerCustomerId: s.customer,
      providerSubscriptionId: s.id,
      status,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      trialEndsAt: s.trial_end ? new Date(s.trial_end * 1000) : before.trialEndsAt,
    },
  });
  // Entitlements follow the paid plan only while the subscription is in good standing.
  if (plan && (status === "ACTIVE" || status === "TRIALING") && plan !== before.plan) {
    await applyPlan(organizationId, plan);
    await audit({ organizationId, actorType: "SYSTEM", actorLabel: "Stripe", action: "billing.plan_changed", summary: `Plan changed to ${plan} (Stripe ${s.id})` });
  }
  if (status === "CANCELED" && before.status !== "CANCELED") {
    await applyPlan(organizationId, "STARTER");
    await audit({ organizationId, actorType: "SYSTEM", actorLabel: "Stripe", action: "billing.subscription_canceled", summary: `Subscription ${s.id} ended; moved to STARTER` });
  }
  return { organizationId, status, plan };
}

// ── Webhook ──

/** Verifies Stripe-Signature (t=…,v1=…) over "t.payload" with the endpoint secret; 5-minute tolerance. */
export function verifyStripeSignature(payload: string, header: string | null, secret = clean(process.env.STRIPE_WEBHOOK_SECRET), now = Date.now()) {
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex");
  return sigs.some((s) => safeEqual(s, expected));
}

type StripeEvent = { id: string; type: string; created: number; data: { object: Record<string, unknown> } };
type StripeInvoice = { id: string; customer: string; status: string; amount_due: number; amount_paid: number; currency: string; hosted_invoice_url?: string | null; period_start?: number; period_end?: number; subscription?: string | null };

/**
 * Processes a verified event exactly once (billing_events unique on provider+event id). Duplicates return
 * "duplicate"; failures are recorded and re-thrown so Stripe retries.
 */
export async function handleStripeEvent(event: StripeEvent, provider = new StripePaymentProvider()) {
  const existing = await db.billingEvent.findUnique({ where: { provider_externalId: { provider: "stripe", externalId: event.id } } });
  if (existing?.processedAt) return "duplicate" as const;
  const row = existing ?? (await db.billingEvent.create({ data: { provider: "stripe", externalId: event.id, type: event.type, payload: event as object } }).catch(() => null));
  if (!row) return "duplicate" as const; // lost a race with a concurrent delivery
  try {
    const obj = event.data.object;
    let organizationId: string | null = null;
    switch (event.type) {
      case "checkout.session.completed": {
        const customer = String(obj.customer ?? "");
        const org = String((obj.metadata as Record<string, string> | undefined)?.organizationId ?? obj.client_reference_id ?? "");
        const sub = await db.subscription.findFirst({ where: { organizationId: org, providerCustomerId: customer } });
        if (sub && obj.subscription) organizationId = (await provider.syncSubscription(String(obj.subscription)))?.organizationId ?? null;
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        organizationId = (await provider.syncSubscription(String(obj.id)))?.organizationId ?? null;
        break;
      case "invoice.created":
      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.voided": {
        const inv = obj as unknown as StripeInvoice;
        organizationId = await orgForCustomer(inv.customer);
        if (organizationId) {
          await db.invoice.upsert({
            where: { provider_providerInvoiceId: { provider: "stripe", providerInvoiceId: inv.id } },
            create: { organizationId, provider: "stripe", providerInvoiceId: inv.id, status: inv.status, amountDueCents: inv.amount_due, amountPaidCents: inv.amount_paid, currency: inv.currency.toUpperCase(), hostedUrl: inv.hosted_invoice_url ?? null, periodStart: inv.period_start ? new Date(inv.period_start * 1000) : null, periodEnd: inv.period_end ? new Date(inv.period_end * 1000) : null },
            update: { status: inv.status, amountDueCents: inv.amount_due, amountPaidCents: inv.amount_paid, hostedUrl: inv.hosted_invoice_url ?? null },
          });
          if (event.type === "invoice.payment_failed" && inv.subscription) await provider.syncSubscription(inv.subscription);
        }
        break;
      }
      default:
        break; // other events are acknowledged and stored
    }
    await db.billingEvent.update({ where: { id: row.id }, data: { processedAt: new Date(), organizationId, error: null } });
    return "processed" as const;
  } catch (err) {
    await db.billingEvent.update({ where: { id: row.id }, data: { error: String(err instanceof Error ? err.message : err).slice(0, 500) } });
    reportError(err, "webhook", { provider: "stripe", type: event.type, eventId: event.id });
    throw err;
  }
}
