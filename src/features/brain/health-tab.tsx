import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { Badge, type Tone } from "@/components/ui/badge";
import type { Area, AreaKey, BrainState } from "@/server/brain/health";

const TAB: Record<AreaKey, string> = { profile: "profile", products: "products", customers: "customers", sales: "sales", content: "content", faqs: "faq", strategy: "strategy", competitors: "market" };
const TONE: Record<string, Tone> = { ready: "success", needs_info: "warning", outdated: "warning", empty: "neutral" };

/** Brain Health: Ready / Needs info / Outdated / Empty per area, with the concrete reasons. */
export async function HealthTab({ areas, state }: { areas: Area[]; state: BrainState }) {
  const t = await getTranslations("brain");
  const c = state.counts;
  return (
    <div className="space-y-5">
      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold text-ink">{t("health.title")}</h2>
        <p className="mt-0.5 text-sm text-ink-3">{t("health.description")}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2" data-health>
          {areas.map((a) => (
            <li key={a.key} data-area={a.key} data-status={a.status}>
              <Link href={`/knowledge?tab=${TAB[a.key]}`} className="flex h-full flex-col gap-2 rounded-2xl border border-line p-4 transition hover:shadow-sm">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{t(`areas.${a.key}`)}</span>
                  <Badge tone={TONE[a.status]}>{t(`status.${a.status}`)}</Badge>
                </span>
                {a.missing.length > 0 ? (
                  <ul className="space-y-0.5 text-sm text-ink-3">
                    {a.missing.map((m) => (
                      <li key={m}>• {t(`missing.${m}`)}</li>
                    ))}
                  </ul>
                ) : a.status === "outdated" ? (
                  <p className="text-sm text-ink-3">{t("health.outdatedCompetitors", { count: c.competitorsStale })}</p>
                ) : (
                  <p className="text-sm text-ink-3">{a.status === "empty" ? t("health.emptyHint") : t("health.readyHint")}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="grid gap-3 p-5 sm:grid-cols-3 sm:p-6">
        <HealthStat label={t("health.staleSources")} value={c.sourcesStale} href="/knowledge?tab=sources" warn={c.sourcesStale > 0} />
        <HealthStat label={t("health.failedSources")} value={c.sourcesFailed} href="/knowledge?tab=sources" warn={c.sourcesFailed > 0} />
        <HealthStat label={t("health.pendingApprovals")} value={c.factsPending + c.faqsPending} href="/knowledge?tab=profile" warn={c.factsPending + c.faqsPending > 0} />
      </Card>
      <p className="text-xs text-ink-4">{t("health.refreshNote")}</p>
    </div>
  );
}

function HealthStat({ label, value, href, warn }: { label: string; value: number; href: string; warn: boolean }) {
  return (
    <Link href={href} className="rounded-xl bg-sunken px-3 py-2.5 hover:bg-line">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${warn ? "text-warning" : "text-ink"}`}>{value}</p>
    </Link>
  );
}
