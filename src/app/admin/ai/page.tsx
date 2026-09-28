import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/server/context";
import { adminAiUsage, adminCommandUsage } from "@/server/admin/queries";
import { Badge } from "@/components/ui/badge";
import { AdminTable } from "@/features/admin/ui";

export const metadata: Metadata = { title: "Admin · AI usage" };

export default async function AdminAiPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("settings.admin");
  const format = await getFormatter();
  const [rows, cmd] = await Promise.all([adminAiUsage(), adminCommandUsage()]);
  const usd = (micro: bigint | null) => format.number(Number(micro ?? BigInt(0)) / 1e6, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
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

      {/* Command Center routing: local / Company Brain / AI / Brain + AI. Admins only — customers never see tokens. */}
      <section data-command-usage className="space-y-3 pt-4">
        <h2 className="text-lg font-semibold text-ink">{t("cmdUsage.title")}</h2>
        <p className="text-sm text-ink-3">{t("cmdUsage.summary", { total: cmd.total, withoutAi: cmd.withoutAi, cacheHits: cmd.cacheHits })}</p>
        <AdminTable head={[t("cmdUsage.mode"), t("col.calls"), "%", t("cmdUsage.contextTokens"), t("col.tokens"), t("col.cost"), t("col.latency")]}>
          {cmd.modes.map((m) => (
            <tr key={m.mode} data-mode-row={m.mode}>
              <td className="px-4 py-3">{t(`cmdUsage.modes.${m.mode}`)}</td>
              <td className="px-4 py-3 tabular">{m.count}</td>
              <td className="px-4 py-3 tabular">{m.share}%</td>
              <td className="px-4 py-3 tabular">{format.number(m.contextTokens)}</td>
              <td className="px-4 py-3 tabular">{format.number(m.tokens)}</td>
              <td className="px-4 py-3 tabular">{usd(m.costMicro)}</td>
              <td className="px-4 py-3 tabular">{m.avgLatency} ms</td>
            </tr>
          ))}
        </AdminTable>
        <AdminTable head={[t("cmdUsage.when"), t("cmdUsage.intent"), t("cmdUsage.mode"), t("col.status"), t("cmdUsage.contextTokens"), t("col.tokens"), t("col.cost"), t("col.latency")]}>
          {cmd.recent.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3 text-xs">{format.dateTime(r.createdAt, { dateStyle: "short", timeStyle: "short" })}</td>
              <td className="px-4 py-3 font-mono text-xs">{r.intent ?? "—"}</td>
              <td className="px-4 py-3">{r.mode ? t(`cmdUsage.modes.${r.mode}`) : "—"}{r.cacheHit ? ` · ${t("cmdUsage.cached")}` : ""}</td>
              <td className="px-4 py-3 text-xs">{r.status}</td>
              <td className="px-4 py-3 tabular">{r.contextTokens ?? 0}{r.retrievedItems ? ` / ${r.retrievedItems}` : ""}</td>
              <td className="px-4 py-3 tabular">{(r.inputTokens ?? 0) + (r.outputTokens ?? 0)}</td>
              <td className="px-4 py-3 tabular">{usd(r.costMicro)}</td>
              <td className="px-4 py-3 tabular">{r.latencyMs ?? 0} ms</td>
            </tr>
          ))}
        </AdminTable>
      </section>
    </div>
  );
}
