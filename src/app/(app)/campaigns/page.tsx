import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Megaphone } from "lucide-react";
import type { CampaignStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/cn";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { NewCampaignButton } from "@/features/campaigns/new-campaign";

export const metadata: Metadata = { title: "Campaigns" };

const TABS = ["live", "review", "paused", "completed", "archived", "all"] as const;
type Tab = (typeof TABS)[number];
const TAB_STATUSES: Record<Tab, CampaignStatus[] | null> = {
  live: ["ACTIVE"],
  review: ["DRAFT", "PENDING_APPROVAL"],
  paused: ["PAUSED"],
  completed: ["COMPLETED"],
  archived: ["ARCHIVED"],
  all: null,
};

export default async function CampaignsPage(props: PageProps<"/campaigns">) {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("app.campaigns");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const sp = await props.searchParams;
  const grouped = await ctx.db.campaign.groupBy({ by: ["status"], _count: { _all: true } });
  const count = (statuses: CampaignStatus[] | null) => grouped.filter((g) => (statuses ? statuses.includes(g.status) : g.status !== "ARCHIVED")).reduce((a, g) => a + g._count._all, 0);
  // Default: the live ones if there are any, otherwise everything that isn't archived.
  const requested = TABS.find((x) => x === sp.tab);
  const tab: Tab = requested ?? (count(TAB_STATUSES.live) ? "live" : "all");
  const statuses = TAB_STATUSES[tab];
  const campaigns = await ctx.db.campaign.findMany({
    where: statuses ? { status: { in: statuses } } : { status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { content: true, leads: true } } },
    take: 60,
  });
  const total = count(null) + count(TAB_STATUSES.archived);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={ctx.can("campaign:manage") && <NewCampaignButton />} />
      {total > 0 && (
        <nav className="mb-5 flex gap-1.5 overflow-x-auto scrollbar-none" aria-label={t("tabs.label")}>
          {TABS.map((x) => {
            const n = count(TAB_STATUSES[x]);
            if (!n && x !== tab && x !== "all") return null;
            return (
              <Link
                key={x}
                href={`/campaigns?tab=${x}`}
                aria-current={x === tab ? "page" : undefined}
                className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors", x === tab ? "border-ink bg-ink text-ink-inverse" : "border-line bg-surface text-ink-2 hover:border-line-strong")}
              >
                {t(`tabs.${x}`)}
                <span className={cn("tabular rounded-full px-1.5 text-[11px]", x === tab ? "bg-white/20" : "bg-surface-2 text-ink-3")}>{n}</span>
              </Link>
            );
          })}
        </nav>
      )}
      {campaigns.length === 0 && total > 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong bg-surface-2 py-12 text-center text-sm text-ink-3">{t("tabs.empty")}</p>
      ) : campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2">
          <EmptyState icon={<Megaphone />} title={t("empty.title")} description={t("empty.body")} action={ctx.can("campaign:manage") && <NewCampaignButton />} />
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link href={`/campaigns/${c.id}`} className="flex h-full flex-col rounded-2xl border border-line bg-surface p-6 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={c.status === "ACTIVE" ? "success" : c.status === "PENDING_APPROVAL" ? "accent" : "neutral"}>{t(`status.${c.status}` as "status.ACTIVE")}</Badge>
                  <span className="text-xs text-ink-3">{c.channel === "whatsapp" ? "WhatsApp" : c.channels.map((ch) => tc(`platforms.${ch}` as "platforms.INSTAGRAM")).join(" · ")}</span>
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
