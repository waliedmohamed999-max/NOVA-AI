import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { VIEWS, type ViewKey } from "@/features/content/views";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { ContentStudio, type StudioItem } from "@/features/content/studio";

export const metadata: Metadata = { title: "Content" };


export default async function ContentPage(props: PageProps<"/content">) {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("content");
  const sp = await props.searchParams;
  const counts = await ctx.db.contentItem.groupBy({ by: ["status"], _count: true });
  const countFor = (v: ViewKey) => counts.filter((c) => (VIEWS[v] as readonly string[]).includes(c.status)).reduce((a, c) => a + c._count, 0);
  const requested = typeof sp.view === "string" && sp.view in VIEWS ? (sp.view as ViewKey) : null;
  const view: ViewKey = requested ?? (countFor("approval") ? "approval" : countFor("scheduled") ? "scheduled" : "drafts");

  const items = await ctx.db.contentItem.findMany({
    where: { status: { in: [...VIEWS[view]] } },
    orderBy: view === "published" ? { publishedAt: "desc" } : [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 60,
    include: { campaign: { select: { name: true } }, assets: { take: 1, orderBy: { position: "asc" } } },
  });

  const data: StudioItem[] = items.map((i) => ({
    id: i.id,
    title: i.title,
    platform: i.platform,
    format: i.format,
    status: i.status,
    hook: i.hook,
    caption: i.caption,
    cta: i.cta,
    hashtags: i.hashtags,
    pillar: i.pillar,
    designBrief: i.designBrief as StudioItem["designBrief"],
    scheduledAt: i.scheduledAt?.toISOString() ?? null,
    publishedAt: i.publishedAt?.toISOString() ?? null,
    campaign: i.campaign?.name ?? null,
    authorAgent: i.authorAgent,
    rationale: i.aiRationale,
  }));

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ContentStudio
        view={view}
        items={data}
        counts={Object.fromEntries((Object.keys(VIEWS) as ViewKey[]).map((v) => [v, countFor(v)])) as Record<ViewKey, number>}
        brandName={ctx.organization.name}
        canApprove={ctx.can("content:approve")}
        canCreate={ctx.can("content:create")}
        autoStart={sp.start === "week"}
      />
    </>
  );
}
