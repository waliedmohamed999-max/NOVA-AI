import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Megaphone } from "lucide-react";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { NewCampaignButton } from "@/features/campaigns/new-campaign";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("app.campaigns");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const campaigns = await ctx.db.campaign.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { content: true, leads: true } } }, take: 50 });
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={ctx.can("campaign:manage") && <NewCampaignButton />} />
      {campaigns.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line-strong bg-surface-2">
          <EmptyState icon={<Megaphone />} title={t("empty.title")} description={t("empty.body")} action={ctx.can("campaign:manage") && <NewCampaignButton />} />
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link href={`/campaigns/${c.id}`} className="flex h-full flex-col rounded-[20px] border border-line bg-surface p-6 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={c.status === "ACTIVE" ? "success" : c.status === "PENDING_APPROVAL" ? "accent" : "neutral"}>{t(`status.${c.status}` as "status.ACTIVE")}</Badge>
                  <span className="text-xs text-ink-3">{c.channels.map((ch) => tc(`platforms.${ch}` as "platforms.INSTAGRAM")).join(" · ")}</span>
                </div>
                <h3 className="mt-4 text-lg font-semibold tracking-tight">{c.name}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-ink-3">{c.objective}</p>
                <div className="mt-auto flex gap-5 pt-5 text-sm text-ink-2">
                  <span><strong className="tabular">{c._count.content}</strong> {t("posts")}</span>
                  <span><strong className="tabular">{c._count.leads}</strong> {t("leads")}</span>
                  {c.startDate && <span className="ms-auto text-xs text-ink-4">{format.dateTime(c.startDate, { month: "short", day: "numeric" })}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
