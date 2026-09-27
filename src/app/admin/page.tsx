import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/server/context";
import { adminOverview } from "@/server/admin/queries";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminOverviewPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("settings.admin");
  const format = await getFormatter();
  const o = await adminOverview();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("tabs.overview")}</h1>
      <Card className="grid grid-cols-2 gap-6 p-6 md:grid-cols-4">
        <Stat label={t("orgs")} value={o.orgs} />
        <Stat label={t("users")} value={o.users} />
        <Stat label={t("aiSpend")} value={format.number(Number(o.spendMicro) / 1e6, { style: "currency", currency: "USD" })} hint={t("requests", { count: o.requests })} />
        <Stat label={t("deadJobs")} value={o.dead} />
      </Card>
      <Card className="grid grid-cols-2 gap-6 p-6 md:grid-cols-4">
        <Stat label={t("aiErrors24h")} value={o.failedRuns} />
        <Stat label={t("integrationIssues")} value={o.integrationIssues} />
        {o.subs.map((s) => <Stat key={`${s.plan}-${s.status}`} label={`${s.plan} · ${s.status}`} value={s._count} />)}
      </Card>
    </div>
  );
}
