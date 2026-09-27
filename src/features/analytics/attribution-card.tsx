import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Route } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { attributionReport } from "@/server/analytics/attribution";

/** Campaign → lead → opportunity → deal. Revenue only from won deals with a recorded value. */
export async function AttributionCard({ report }: { report: Awaited<ReturnType<typeof attributionReport>> }) {
  const t = await getTranslations("analytics.attribution");
  const format = await getFormatter();
  const money = (cents: number | null) =>
    cents == null ? "—" : report.currency && report.currency !== "MIXED" ? format.number(cents / 100, { style: "currency", currency: report.currency, maximumFractionDigits: 0 }) : t("mixedCurrencies");
  const { totals } = report;
  return (
    <Card className="p-6" data-testid="attribution">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-3"><Route className="size-4" /> {t("title")}</h2>
        <span className="text-xs text-ink-4">{t("window")}</span>
      </div>
      {totals.leads === 0 ? (
        <p className="text-sm text-ink-3">{t("empty")}</p>
      ) : (
        <>
          <dl className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-5">
            {([
              ["leads", String(totals.leads)],
              ["attributed", String(totals.attributed)],
              ["opportunities", String(totals.opportunities)],
              ["won", String(totals.won)],
              ["revenue", money(totals.revenueCents)],
            ] as const).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-ink-3">{t(`kpi.${k}`)}</dt>
                <dd className="text-2xl font-semibold tabular">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-start text-xs text-ink-3">
                  <th className="py-2 text-start font-medium">{t("cols.campaign")}</th>
                  <th className="py-2 text-end font-medium">{t("kpi.leads")}</th>
                  <th className="py-2 text-end font-medium">{t("kpi.opportunities")}</th>
                  <th className="py-2 text-end font-medium">{t("kpi.won")}</th>
                  <th className="py-2 text-end font-medium">{t("kpi.revenue")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="py-2.5">
                      {r.campaignId ? <Link href={`/campaigns/${r.campaignId}`} className="font-medium hover:underline">{r.label}</Link> : r.key === "none" ? <span className="text-ink-3">{t("unattributed")}</span> : <span className="font-medium" dir="auto">{r.label} <span className="text-xs text-ink-4">utm</span></span>}
                    </td>
                    <td className="py-2.5 text-end tabular">{r.leads}</td>
                    <td className="py-2.5 text-end tabular">{r.opportunities}</td>
                    <td className="py-2.5 text-end tabular">{r.won}</td>
                    <td className="py-2.5 text-end tabular">
                      {money(r.revenueCents)}
                      {r.wonWithoutValue > 0 && <span className="block text-[11px] text-ink-4">{t("noValue", { count: r.wonWithoutValue })}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-4">{t("note")}</p>
        </>
      )}
    </Card>
  );
}
