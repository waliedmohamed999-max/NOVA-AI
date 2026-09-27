import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ApprovalCategory } from "@/generated/prisma/enums";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { ApprovalCenter, type ApprovalCard } from "@/features/approvals/center";

export const metadata: Metadata = { title: "Approvals" };

const TABS: ApprovalCategory[] = ["CONTENT", "PUBLISHING", "SALES", "PRICING", "CAMPAIGNS"];

export default async function ApprovalsPage(props: PageProps<"/approvals">) {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("app.approvals");
  const sp = await props.searchParams;
  const counts = await ctx.db.approval.groupBy({ by: ["category"], where: { status: "PENDING" }, _count: true });
  const countOf = (c: string) => counts.find((x) => x.category === c)?._count ?? 0;
  const tab = (typeof sp.tab === "string" && TABS.includes(sp.tab as ApprovalCategory) ? sp.tab : TABS.find((c) => countOf(c) > 0) ?? "CONTENT") as ApprovalCategory;
  const [pending, recent] = await Promise.all([
    ctx.db.approval.findMany({ where: { status: "PENDING", category: tab }, orderBy: { createdAt: "desc" }, take: 60 }),
    ctx.db.approval.findMany({ where: { status: { not: "PENDING" } }, orderBy: { decidedAt: "desc" }, take: 8 }),
  ]);
  const toCard = (a: (typeof pending)[number]): ApprovalCard => ({
    id: a.id,
    category: a.category,
    title: a.title,
    summary: a.summary,
    reason: a.reason,
    impact: a.impact,
    agent: a.requestedByAgent,
    status: a.status,
    href: a.entityType === "ContentItem" ? `/content/${a.entityId}` : a.entityType === "Campaign" ? `/campaigns/${a.entityId}` : a.entityType === "Message" ? `/leads/${(a.payload as { leadId?: string }).leadId ?? ""}` : null,
    at: (a.decidedAt ?? a.createdAt).toISOString(),
  });
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ApprovalCenter tab={tab} counts={Object.fromEntries(TABS.map((c) => [c, countOf(c)]))} items={pending.map(toCard)} recent={recent.map(toCard)} />
    </>
  );
}
