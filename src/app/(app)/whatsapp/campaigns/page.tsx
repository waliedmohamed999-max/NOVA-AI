import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireTenant } from "@/server/context";
import { listWhatsAppCampaigns } from "@/server/whatsapp/campaigns";
import { StateBadge } from "@/features/whatsapp/ui";

export const metadata: Metadata = { title: "WhatsApp · Campaigns" };

export default async function WhatsAppCampaigns() {
  const ctx = await requireTenant({ permission: "leads:read" });
  const t = await getTranslations("whatsapp.campaigns");
  const format = await getFormatter();
  const rows = await listWhatsAppCampaigns({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
  const canManage = ctx.can("campaign:manage");
  return (
    <section className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Link href="/whatsapp/campaigns/new" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1fa855] px-4 text-sm font-semibold text-white" data-testid="wa-new-campaign">
            <Plus className="size-4" /> {t("new")}
          </Link>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line-strong bg-surface-2 p-10 text-center">
          <p className="font-bold">{t("empty.title")}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-3">{t("empty.body")}</p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={c.state === "DRAFT" ? `/whatsapp/campaigns/new?id=${c.id}` : `/whatsapp/campaigns/${c.id}`} className="flex h-full flex-col rounded-[20px] border border-line bg-surface p-5 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <StateBadge state={c.state} label={t(`states.${c.state}` as "states.DRAFT")} />
                  <span className="text-xs text-ink-4">{t(`objectives.${c.objective}` as "objectives.offer")}</span>
                </div>
                <h3 className="mt-3 text-base font-bold">{c.name}</h3>
                <div className="mt-auto flex gap-4 pt-4 text-sm text-ink-2">
                  <span><strong className="tabular-nums">{c.recipients}</strong> {t("recipients")}</span>
                  <span><strong className="tabular-nums">{c.sent}</strong> {t("sent")}</span>
                  {c.failed > 0 && <span className="text-danger"><strong className="tabular-nums">{c.failed}</strong> {t("failed")}</span>}
                  <span className="ms-auto text-xs text-ink-4">{format.relativeTime(new Date(c.updatedAt))}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
