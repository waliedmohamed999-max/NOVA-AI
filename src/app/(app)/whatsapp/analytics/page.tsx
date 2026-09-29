import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { campaignAnalytics } from "@/server/whatsapp/campaigns";
import { periodAnalytics } from "@/server/whatsapp/followups";
import { Metric, StateBadge } from "@/features/whatsapp/ui";

export const metadata: Metadata = { title: "WhatsApp · Analytics" };

/** Last 30 days from our own records and provider-reported states only (no open rates, no estimates). */
export default async function WhatsAppAnalytics() {
  const ctx = await requireTenant({ permission: "analytics:read" });
  const t = await getTranslations("whatsapp");
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const { conversations, inbound, outbound, delivered, read, failed, campaignIds } = await periodAnalytics(scope);
  const stats = await Promise.all(campaignIds.map((id) => campaignAnalytics(scope, id)));
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-3">{t("analytics.period")}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Metric label={t("analytics.conversations")} value={conversations} />
        <Metric label={t("analytics.inbound")} value={inbound} />
        <Metric label={t("analytics.outbound")} value={outbound} />
        <Metric label={t("campaigns.stats.delivered")} value={delivered} />
        <Metric label={t("campaigns.stats.read")} value={read} />
        <Metric label={t("campaigns.stats.failed")} value={failed} tone={failed ? "attention" : undefined} />
      </div>
      <p className="text-xs text-ink-4">{t("campaigns.readNote")}</p>
      <section className="rounded-[24px] border border-line bg-surface shadow-xs">
        <h2 className="border-b border-line px-5 py-3 text-[15px] font-bold">{t("analytics.campaigns")}</h2>
        {stats.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-3">{t("analytics.noData")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-xs text-ink-3">
                <tr>
                  {["tabs.campaigns", "campaigns.stats.sent", "campaigns.stats.delivered", "campaigns.stats.read", "campaigns.stats.failed", "campaigns.stats.replies", "campaigns.stats.optOuts", "campaigns.stats.leads", "campaigns.stats.opportunities", "campaigns.stats.won"].map((k) => (
                    <th key={k} className="px-4 py-2.5 text-start font-medium">{t(k as "tabs.campaigns")}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stats.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3">
                      <Link href={`/whatsapp/campaigns/${s.id}`} className="font-semibold hover:underline">{s.name}</Link>{" "}
                      <StateBadge state={s.state ?? "DRAFT"} label={t(`campaigns.states.${s.state ?? "DRAFT"}` as "campaigns.states.DRAFT")} />
                    </td>
                    {[s.sent, s.delivered, s.read, s.failed, s.replies, s.optOuts, s.leads, s.opportunities, s.wonDeals].map((v, i) => (
                      <td key={i} className="px-4 py-3 tabular-nums">{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
