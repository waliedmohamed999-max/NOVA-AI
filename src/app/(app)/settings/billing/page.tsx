import type { Metadata } from "next";
import { getFormatter } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { getUsage } from "@/server/billing/entitlements";
import { paymentProvider, tokenPurchasesAvailable } from "@/server/billing/service";
import { recentGrants } from "@/server/billing/tokens";
import { topUpPack } from "@/config/plans";
import { currentPeriod } from "@/server/ai/budget";
import { BillingSettings } from "@/features/settings/sections";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage() {
  const ctx = await requireTenant();
  const format = await getFormatter();
  const [usage, byAgent, invoices, sub, grants] = await Promise.all([
    getUsage(ctx.organization.id),
    ctx.db.aiUsage.findMany({ where: { period: currentPeriod() } }),
    ctx.db.invoice.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
    ctx.db.subscription.findUnique({ where: { organizationId: ctx.organization.id } }),
    recentGrants(ctx.organization.id, 5),
  ]);
  const ai = usage.ai;
  const pack = topUpPack();
  return (
    <BillingSettings
      plan={usage.plan}
      status={usage.status}
      trialEndsAt={usage.trialEndsAt?.toISOString() ?? null}
      seats={usage.seats}
      channels={usage.socialChannels}
      ai={{ usedTokens: Number(ai.usedTokens), monthlyTokens: Number(ai.monthlyTokens), extraTokens: Number(ai.extraTokens), availableTokens: Number(ai.availableTokens), percent: ai.percent, softLimitPercent: ai.softLimitPercent, state: ai.state }}
      topUp={{ available: tokenPurchasesAvailable(), tokensPerPack: Number(pack.tokens), maxPacks: pack.maxPacks }}
      grants={grants.map((g) => ({ id: g.id, tokens: Number(g.tokens), source: g.source, date: format.dateTime(g.createdAt, { dateStyle: "medium" }) }))}
      byAgent={byAgent.map((a) => ({ agent: a.agentKey, requests: a.requests, tokens: Number(a.inputTokens + a.outputTokens) })).sort((x, y) => y.tokens - x.tokens)}
      paymentsConfigured={paymentProvider().isConfigured()}
      hasSubscription={Boolean(sub?.providerSubscriptionId)}
      cancelAtPeriodEnd={Boolean(sub?.cancelAtPeriodEnd)}
      currentPeriodEnd={sub?.currentPeriodEnd?.toISOString() ?? null}
      canManage={ctx.can("billing:manage")}
      invoices={invoices.map((i) => ({ id: i.id, status: i.status, amount: format.number(i.amountDueCents / 100, { style: "currency", currency: i.currency }), date: format.dateTime(i.createdAt, { dateStyle: "medium" }), url: i.hostedUrl }))}
    />
  );
}
