import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { GenerateReportButton } from "@/features/reports/generate";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requireTenant({ permission: "analytics:read" });
  const t = await getTranslations("settings.reports");
  const format = await getFormatter();
  const reports = await ctx.db.report.findMany({ orderBy: { periodStart: "desc" }, take: 40 });
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={<GenerateReportButton />} />
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
    </>
  );
}
