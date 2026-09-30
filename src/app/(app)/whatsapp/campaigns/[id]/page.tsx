import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { campaignAnalytics } from "@/server/whatsapp/campaigns";
import { CampaignControls } from "@/features/whatsapp/campaign-controls";
import { Metric, StateBadge } from "@/features/whatsapp/ui";

export const metadata: Metadata = { title: "WhatsApp · Campaign" };

/** Campaign detail: provider-reported delivery states and CRM attribution — nothing estimated. */
export default async function WhatsAppCampaignDetail(props: PageProps<"/whatsapp/campaigns/[id]">) {
  const ctx = await requireTenant({ permission: "leads:read" });
  const { id } = await props.params;
  const t = await getTranslations("whatsapp.campaigns");
  const format = await getFormatter();
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const c = await ctx.db.campaign.findUnique({ where: { id } });
  if (!c || c.channel !== "whatsapp") notFound();
  const [s, tpl] = await Promise.all([campaignAnalytics(scope, id), c.waTemplateId ? ctx.db.whatsAppTemplate.findUnique({ where: { id: c.waTemplateId }, select: { name: true, body: true } }) : null]);
  const state = s.state ?? "DRAFT";
  return (
    <div className="space-y-5" data-testid="wa-campaign">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">{c.name}</h2>
        <StateBadge state={state} label={t(`states.${state}` as "states.DRAFT")} />
        <span className="text-sm text-ink-3">{t(`objectives.${c.objective}` as "objectives.offer")}</span>
        <div className="ms-auto">{ctx.can("campaign:manage") && <CampaignControls id={c.id} state={state} />}</div>
      </div>
      {tpl && <p className="max-w-xl whitespace-pre-wrap rounded-2xl bg-[#d9fdd3] p-3 text-sm text-[#0b2e13]" dir="auto">{tpl.body}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label={t("recipients")} value={s.recipients} />
        <Metric label={t("stats.queued")} value={s.queued} />
        <Metric label={t("stats.sent")} value={s.sent} tone={s.sent ? "good" : undefined} />
        <Metric label={t("stats.delivered")} value={s.delivered} />
        <Metric label={t("stats.read")} value={s.read} />
        <Metric label={t("stats.failed")} value={s.failed} tone={s.failed ? "attention" : undefined} />
        <Metric label={t("stats.skipped")} value={s.skipped} />
        <Metric label={t("stats.replies")} value={s.replies} tone={s.replies ? "good" : undefined} />
      </div>
      <p className="text-xs text-ink-4">{t("readNote")}</p>
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
        <h3 className="mb-3 text-[15px] font-bold">{t("attribution")}</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Metric label={t("stats.optOuts")} value={s.optOuts} />
          <Metric label={t("stats.leads")} value={s.leads} />
          <Metric label={t("stats.opportunities")} value={s.opportunities} />
          <Metric label={t("stats.won")} value={s.wonDeals} />
          <Metric label={t("stats.revenue")} value={s.revenue ? format.number(s.revenue.cents / 100, { style: "currency", currency: s.revenue.currency, maximumFractionDigits: 0 }) : <span className="text-sm font-medium text-ink-4">{t("stats.noRevenue")}</span>} />
        </div>
      </section>
    </div>
  );
}
