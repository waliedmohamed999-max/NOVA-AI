import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/server/context";
import { adminIntegrations } from "@/server/admin/queries";
import { Badge } from "@/components/ui/badge";
import { AdminTable } from "@/features/admin/ui";

export const metadata: Metadata = { title: "Admin · Integrations" };

const STATUSES = ["CONNECTED", "ACTION_REQUIRED", "EXPIRED", "ERROR", "DISCONNECTED"];

export default async function AdminIntegrationsPage(props: PageProps<"/admin/integrations">) {
  await requirePlatformAdmin();
  const t = await getTranslations("settings.admin");
  const format = await getFormatter();
  const sp = await props.searchParams;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status) ? sp.status : undefined;
  const rows = await adminIntegrations(status);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/admin/integrations" className={!status ? "font-semibold" : "text-ink-3"}>{t("all")}</Link>
        {STATUSES.map((s) => <Link key={s} href={`/admin/integrations?status=${s}`} className={status === s ? "font-semibold" : "text-ink-3"}>{s}</Link>)}
      </div>
      <AdminTable head={[t("col.provider"), t("col.status"), t("col.accounts"), t("col.lastSync"), t("col.lastError"), t("col.org")]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="px-4 py-3">{r.provider}</td>
            <td className="px-4 py-3"><Badge tone={r.status === "CONNECTED" ? "success" : r.status === "DISCONNECTED" ? "neutral" : "danger"}>{r.status}</Badge> <span className="text-xs text-ink-3">{r.statusMessage}</span></td>
            <td className="px-4 py-3 tabular">{r._count.accounts}</td>
            <td className="px-4 py-3 text-ink-3">{r.lastSyncAt ? format.relativeTime(r.lastSyncAt) : "—"}</td>
            <td className="px-4 py-3 text-ink-3">{r.lastErrorAt ? format.relativeTime(r.lastErrorAt) : "—"}</td>
            <td className="px-4 py-3 font-mono text-xs text-ink-4">{r.organizationId.slice(0, 10)}…</td>
          </tr>
        ))}
      </AdminTable>
      <p className="text-xs text-ink-4">{t("noSecrets")}</p>
    </div>
  );
}
