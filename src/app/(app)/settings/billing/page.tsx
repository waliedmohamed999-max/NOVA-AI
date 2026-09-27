import type { Metadata } from "next";
import { getFormatter } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { getUsage } from "@/server/billing/entitlements";
import { paymentProvider } from "@/server/billing/service";
import { currentPeriod } from "@/server/ai/budget";
import { BillingSettings } from "@/features/settings/sections";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage() {
  const ctx = await requireTenant();
  const format = await getFormatter();
  const [usage, byAgent, invoices, sub] = await Promise.all([
    getUsage(ctx.organization.id),
    ctx.db.aiUsage.findMany({ where: { period: currentPeriod() }, orderBy: { costMicro: "desc" } }),
    ctx.db.invoice.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
    ctx.db.subscription.findUnique({ where: { organizationId: ctx.organization.id } }),
  ]);
  const usd = (micro: bigint) => Number(micro) / 1_000_000;
  return (
    <BillingSettings
      plan={usage.plan}
      status={usage.status}
      trialEndsAt={usage.trialEndsAt?.toISOString() ?? null}
      seats={usage.seats}
      channels={usage.socialChannels}
      ai={{ spentUsd: usd(usage.ai.spentMicro), allowanceUsd: usd(usage.ai.allowanceMicro), percent: usage.ai.percent, softLimitPercent: usage.ai.softLimitPercent, hardLimitEnabled: usage.ai.hardLimitEnabled }}
      byAgent={byAgent.map((a) => ({ agent: a.agentKey, requests: a.requests, costUsd: usd(a.costMicro) }))}
      paymentsConfigured={paymentProvider().isConfigured()}
      hasSubscription={Boolean(sub?.providerSubscriptionId)}
      cancelAtPeriodEnd={Boolean(sub?.cancelAtPeriodEnd)}
      currentPeriodEnd={sub?.currentPeriodEnd?.toISOString() ?? null}
      canManage={ctx.can("billing:manage")}
      invoices={invoices.map((i) => ({ id: i.id, status: i.status, amount: format.number(i.amountDueCents / 100, { style: "currency", currency: i.currency }), date: format.dateTime(i.createdAt, { dateStyle: "medium" }), url: i.hostedUrl }))}
    />
  );
}
