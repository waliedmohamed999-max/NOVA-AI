import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/server/context";
import { adminOrganizations } from "@/server/admin/queries";
import { Badge } from "@/components/ui/badge";
import { AdminSearch, AdminTable } from "@/features/admin/ui";

export const metadata: Metadata = { title: "Admin · Organizations" };

export default async function AdminOrgsPage(props: PageProps<"/admin/organizations">) {
  await requirePlatformAdmin();
  const t = await getTranslations("settings.admin");
  const format = await getFormatter();
  const q = String((await props.searchParams).q ?? "").slice(0, 100);
  const orgs = await adminOrganizations(q);
  return (
    <div className="space-y-5">
      <AdminSearch placeholder={t("searchOrgs")} />
      <AdminTable head={[t("col.name"), t("col.plan"), t("col.members"), t("col.onboarding"), t("col.aiCost"), t("col.created")]}>
        {orgs.map((o) => (
          <tr key={o.id}>
            <td className="px-4 py-3"><div className="font-medium">{o.name}</div><div className="text-xs text-ink-4">{o.slug}{o.isDemo && " · demo"}</div></td>
            <td className="px-4 py-3"><Badge>{o.subscription?.plan ?? "—"}</Badge> <span className="text-xs text-ink-3">{o.subscription?.status}</span></td>
            <td className="px-4 py-3 tabular">{o._count.members}</td>
            <td className="px-4 py-3 text-ink-3">{o.onboardingStatus}</td>
            <td className="px-4 py-3 tabular">{format.number(Number(o.aiCostMicro) / 1e6, { style: "currency", currency: "USD" })}</td>
            <td className="px-4 py-3 text-ink-3">{format.dateTime(o.createdAt, { dateStyle: "medium" })}</td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
