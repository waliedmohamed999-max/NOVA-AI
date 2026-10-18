import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { GenerateReportButton } from "@/features/reports/generate";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Reports" };

const TABS = ["all", "WEEKLY_REPORT", "DAILY_BRIEF"] as const;
const PAGE = 24;

export default async function ReportsPage(props: PageProps<"/reports">) {
  const ctx = await requireTenant({ permission: "analytics:read" });
  const t = await getTranslations("settings.reports");
  const format = await getFormatter();
  const sp = await props.searchParams;
  const kind = TABS.find((x) => x === sp.kind && x !== "all") as Exclude<(typeof TABS)[number], "all"> | undefined;
  const cursor = typeof sp.cursor === "string" ? sp.cursor : null;
  const [rows, counts] = await Promise.all([
    ctx.db.report.findMany({ where: kind ? { kind } : {}, orderBy: [{ periodStart: "desc" }, { id: "desc" }], take: PAGE + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
    ctx.db.report.groupBy({ by: ["kind"], _count: { _all: true } }),
  ]);
  const reports = rows.slice(0, PAGE);
  const next = rows.length > PAGE ? reports[reports.length - 1].id : null;
  const count = (k: (typeof TABS)[number]) => counts.filter((c) => k === "all" || c.kind === k).reduce((a, c) => a + c._count._all, 0);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={<GenerateReportButton />} />
      {count("all") > 0 && (
        <nav className="mb-5 flex gap-1.5 overflow-x-auto scrollbar-none" aria-label={t("filterLabel")}>
          {TABS.map((x) => {
            const active = (kind ?? "all") === x;
            return (
              <Link
                key={x}
                href={x === "all" ? "/reports" : `/reports?kind=${x}`}
                aria-current={active ? "page" : undefined}
                className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors", active ? "border-ink bg-ink text-ink-inverse" : "border-line bg-surface text-ink-2 hover:border-line-strong")}
              >
                {x === "all" ? t("filterAll") : t(`kinds.${x}`)}
                <span className={cn("tabular rounded-full px-1.5 text-[11px]", active ? "bg-white/20" : "bg-surface-2 text-ink-3")}>{count(x)}</span>
              </Link>
            );
          })}
        </nav>
      )}
      {reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2">
          <EmptyState icon={<FileText />} title={t("empty.title")} description={t("empty.body")} action={<GenerateReportButton />} />
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {reports.map((r) => (
            <li key={r.id}>
              <Link href={`/reports/${r.id}`} className="block rounded-2xl border border-line bg-surface p-5 transition hover:shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={r.kind === "WEEKLY_REPORT" ? "accent" : "neutral"}>{t(`kinds.${r.kind}`)}</Badge>
                  <span className="text-xs text-ink-3">{format.dateTime(r.periodStart, { dateStyle: "medium" })}</span>
                </div>
                <p className="mt-3 line-clamp-3 text-sm text-ink-2" dir="auto">{r.narrative}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <div className="mt-5 text-center">
          <Link href={`/reports?${new URLSearchParams({ ...(kind ? { kind } : {}), cursor: next })}`} className={buttonClass("secondary", "sm")}>
            {t("loadMore")}
          </Link>
        </div>
      )}
    </>
  );
}
