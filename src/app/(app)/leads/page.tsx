import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { LeadBoard } from "@/features/sales/board";
import { loadLeadCards, stageLabels } from "@/server/sales/queries";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage(props: PageProps<"/leads">) {
  const ctx = await requireTenant({ permission: "leads:read" });
  const t = await getTranslations("leads");
  const sp = await props.searchParams;
  const [leads, labels] = await Promise.all([loadLeadCards(ctx), stageLabels(ctx)]);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <LeadBoard leads={leads} stageLabels={labels} mode={sp.view === "board" ? "board" : "table"} canManage={ctx.can("leads:manage")} />
    </>
  );
}
