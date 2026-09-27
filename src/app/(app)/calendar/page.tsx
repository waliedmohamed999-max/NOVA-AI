import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { CalendarBoard, type CalItem } from "@/features/calendar/board";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage(props: PageProps<"/calendar">) {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("content.calendar");
  const sp = await props.searchParams;
  const anchor = typeof sp.date === "string" && !Number.isNaN(Date.parse(sp.date)) ? new Date(sp.date) : new Date();
  const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 20));
  const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 12));
  const items = await ctx.db.contentItem.findMany({
    where: { OR: [{ scheduledAt: { gte: from, lte: to } }, { publishedAt: { gte: from, lte: to } }], status: { notIn: ["REJECTED", "IDEA"] } },
    orderBy: { scheduledAt: "asc" },
    take: 400,
  });
  const data: CalItem[] = items.map((i) => ({
    id: i.id,
    title: i.title,
    platform: i.platform,
    format: i.format,
    status: i.status,
    hook: i.hook,
    caption: i.caption,
    cta: i.cta,
    hashtags: i.hashtags,
    designBrief: i.designBrief as CalItem["designBrief"],
    at: (i.publishedAt ?? i.scheduledAt)!.toISOString(),
  }));
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <CalendarBoard items={data} anchor={anchor.toISOString()} brandName={ctx.organization.name} canEdit={ctx.can("content:create")} />
    </>
  );
}
