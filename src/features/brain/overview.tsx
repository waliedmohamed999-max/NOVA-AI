import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowUpRight, CircleCheck, CircleDashed, FilePlus2, Sparkles, Target, Upload, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Area, AreaKey, BrainState, Overall } from "@/server/brain/health";

const AREA_TAB: Record<AreaKey, string> = { profile: "profile", products: "products", customers: "customers", sales: "sales", content: "content", faqs: "faq", strategy: "strategy", competitors: "market" };
const DOT: Record<string, string> = { ready: "bg-success", needs_info: "bg-warning", outdated: "bg-warning", empty: "bg-line-strong" };

export async function BrainOverview({ state, areas, overall, missing, canManage }: { state: BrainState; areas: Area[]; overall: Overall; missing: { area: AreaKey; key: string }[]; canManage: boolean }) {
  const t = await getTranslations("brain");
  const format = await getFormatter();
  const c = state.counts;
  const isNew = areas.filter((a) => a.status === "empty").length >= 6;
  const actions: { key: string; href: string; icon: LucideIcon }[] = [
    { key: "addSource", href: "/knowledge?tab=imports", icon: FilePlus2 },
    { key: "importData", href: "/knowledge?tab=imports", icon: Upload },
    { key: "buildStrategy", href: "/knowledge?tab=strategy", icon: Target },
    { key: "completeInfo", href: "/knowledge?tab=health", icon: Sparkles },
  ];
  const stats: [string, number | string][] = [
    ["sources", c.sources],
    ["lastRefresh", state.lastRefresh ? format.relativeTime(state.lastRefresh) : "—"],
    ["products", c.offerings],
    ["segments", c.segments],
    ["faqs", c.faqs],
    ["strategies", c.strategies],
    ["customers", c.customers],
    ["documents", c.documents],
    ["websitePages", c.websitePages],
  ];
  const node = (key: AreaKey) => areas.find((a) => a.key === key)!;

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section
        className="relative overflow-hidden rounded-[24px] border border-[var(--nova-line)] px-5 py-7 shadow-[0_18px_50px_-30px_rgba(30,70,140,.35)] sm:px-8"
        style={{ background: "linear-gradient(180deg, var(--nova-hero-from) 0%, var(--nova-hero-to) 100%)" }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[34px]">{t("hero.title")}</h1>
            <p className="mt-2 text-[15px] text-ink-3">{t("hero.subtitle")}</p>
          </div>
          <span data-brain-overall={overall} className={cn("rounded-full px-3 py-1 text-sm font-semibold", overall === "complete" || overall === "ready" ? "bg-success-soft text-success" : overall === "weak" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
            {t(`overall.${overall}`)}
          </span>
        </div>
        {canManage && (
          <div className="mt-5 flex flex-wrap gap-2">
            {actions.map((a) => (
              <Link key={a.key} href={a.href} className={buttonClass("secondary", "sm")}>
                <a.icon className="size-4" aria-hidden />
                {t(`quick.${a.key}`)}
              </Link>
            ))}
          </div>
        )}
      </section>

      {isNew ? (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-ink">{t("empty.title")}</h2>
          <ol className="mt-4 grid gap-2 sm:grid-cols-5">
            {(["website", "products", "customers", "questions", "strategy"] as const).map((k, i) => (
              <li key={k}>
                <Link href={`/knowledge?tab=${{ website: "imports", products: "products", customers: "imports", questions: "strategy", strategy: "strategy" }[k]}`} className="flex h-full items-start gap-2 rounded-xl border border-line p-3 text-sm transition hover:bg-sunken">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
                  <span>{t(`empty.steps.${k}`)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {/* Brain map: Company → areas (status + count) */}
      <Card className="p-5 sm:p-6" data-brain-map>
        <div className="flex justify-center">
          <MapNode label={t("map.company")} status={node("profile").status} count={null} href="/knowledge?tab=profile" strong />
        </div>
        <div className="mx-auto my-3 h-5 w-px bg-line-strong" aria-hidden />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {(["products", "customers", "sales", "content", "strategy", "competitors"] as const).map((k) => (
            <MapNode key={k} label={t(`map.${k}`)} status={node(k).status} count={node(k).count} href={`/knowledge?tab=${AREA_TAB[k]}`} statusLabel={t(`status.${node(k).status}`)} />
          ))}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-5 sm:p-6">
          <h2 className="text-base font-semibold text-ink">{t("overview.statsTitle")}</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {stats.map(([k, v]) => (
              <div key={k} className="rounded-xl bg-sunken px-3 py-2.5">
                <dt className="text-xs text-ink-3">{t(`overview.stats.${k}`)}</dt>
                <dd className="mt-0.5 text-lg font-semibold text-ink tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {(c.factsPending > 0 || c.faqsPending > 0 || c.segmentsSuggested > 0) && (
            <p className="mt-4 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">{t("overview.pending", { facts: c.factsPending, faqs: c.faqsPending, segments: c.segmentsSuggested })}</p>
          )}
        </Card>
        <Card className="p-5 sm:p-6" data-brain-missing>
          <h2 className="text-base font-semibold text-ink">{t("overview.missingTitle")}</h2>
          {missing.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-success">
              <CircleCheck className="size-4" /> {t("overview.nothingMissing")}
            </p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {missing.slice(0, 8).map((m) => (
                <li key={`${m.area}-${m.key}`}>
                  <Link href={`/knowledge?tab=${AREA_TAB[m.area]}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-2 hover:bg-sunken">
                    <CircleDashed className="size-4 shrink-0 text-warning" aria-hidden />
                    <span className="flex-1">{t(`missing.${m.key}`)}</span>
                    <ArrowUpRight className="size-3.5 text-ink-4 rtl:-scale-x-100" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function MapNode({ label, status, count, href, strong, statusLabel }: { label: string; status: string; count: number | null; href: string; strong?: boolean; statusLabel?: string }) {
  return (
    <Link href={href} data-map-node={status} className={cn("flex items-center gap-2.5 rounded-2xl border border-line bg-surface px-3.5 py-2.5 transition hover:shadow-sm", strong && "px-5 py-3 font-semibold")}>
      <span className={cn("size-2.5 shrink-0 rounded-full", DOT[status])} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{label}</span>
      {count != null && <span className="text-sm font-semibold tabular-nums text-ink-2">{count}</span>}
      {statusLabel && <span className="sr-only">{statusLabel}</span>}
    </Link>
  );
}
