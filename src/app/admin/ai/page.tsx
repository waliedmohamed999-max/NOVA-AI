import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/server/context";
import { adminAiUsage } from "@/server/admin/queries";
import { Badge } from "@/components/ui/badge";
import { AdminTable } from "@/features/admin/ui";

export const metadata: Metadata = { title: "Admin · AI usage" };

export default async function AdminAiPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("settings.admin");
  const format = await getFormatter();
  const rows = await adminAiUsage();
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3">{t("aiWindow")}</p>
      <AdminTable head={[t("col.provider"), t("col.model"), t("col.status"), t("col.calls"), t("col.tokens"), t("col.cost"), t("col.latency")]}>
        {rows.map((r) => (
          <tr key={`${r.provider}-${r.model}-${r.status}`}>
            <td className="px-4 py-3">{r.provider}</td>
            <td className="px-4 py-3 font-mono text-xs">{r.model}</td>
            <td className="px-4 py-3"><Badge tone={r.status === "SUCCESS" ? "success" : r.status === "BLOCKED" ? "warning" : "danger"}>{r.status}</Badge></td>
            <td className="px-4 py-3 tabular">{r._count}</td>
            <td className="px-4 py-3 tabular">{format.number((r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0))}</td>
            <td className="px-4 py-3 tabular">{format.number(Number(r._sum.costMicro ?? 0n) / 1e6, { style: "currency", currency: "USD" })}</td>
            <td className="px-4 py-3 tabular">{Math.round(r._avg.latencyMs ?? 0)} ms</td>
          </tr>
        ))}
      </AdminTable>
    </div>
  );
}
