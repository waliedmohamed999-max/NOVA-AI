import { getTranslations } from "next-intl/server";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CallbackEntry } from "@/server/integrations/registry";

/** Server component: every URL to register with providers, flagged when it isn't public HTTPS. */
export async function CallbackMatrix({ rows }: { rows: CallbackEntry[] }) {
  const t = await getTranslations("settings.admin.callbacks");
  const problems = rows.filter((r) => r.problem).length;
  return (
    <div className="space-y-3">
      {problems > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t("warning", { count: problems })}
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[760px] text-sm" data-testid="callback-matrix">
          <thead className="border-b border-line bg-surface-2 text-xs text-ink-3">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("cols.kind")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("cols.name")}</th>
              <th className="px-3 py-2 text-start font-medium">URL</th>
              <th className="px-3 py-2 text-start font-medium">{t("cols.where")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("cols.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.name}`}>
                <td className="px-3 py-2"><Badge tone="outline">{r.kind}</Badge></td>
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 font-mono text-xs" dir="ltr">{r.url || "—"}</td>
                <td className="px-3 py-2 text-xs text-ink-3">{r.registerAt}</td>
                <td className="px-3 py-2 text-xs">
                  {r.problem ? <span className="text-warning">{t(`problems.${r.problem}`)}</span> : <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-3.5" /> HTTPS</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
