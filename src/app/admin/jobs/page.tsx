import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/server/context";
import { adminJobs } from "@/server/admin/queries";
import { Badge } from "@/components/ui/badge";
import { AdminTable, RetryJob } from "@/features/admin/ui";

export const metadata: Metadata = { title: "Admin · Jobs" };

const STATUSES = ["DEAD", "RETRYING", "RUNNING", "QUEUED", "COMPLETED"];

export default async function AdminJobsPage(props: PageProps<"/admin/jobs">) {
  await requirePlatformAdmin();
  const t = await getTranslations("settings.admin");
  const format = await getFormatter();
  const sp = await props.searchParams;
  const status = typeof sp.status === "string" && STATUSES.includes(sp.status) ? sp.status : "DEAD";
  const jobs = await adminJobs(status);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 text-sm">
        {STATUSES.map((s) => <Link key={s} href={`/admin/jobs?status=${s}`} className={status === s ? "font-semibold" : "text-ink-3"}>{s}</Link>)}
      </div>
      <AdminTable head={[t("col.type"), t("col.status"), t("col.attempts"), t("col.error"), t("col.created"), ""]}>
        {jobs.map((j) => (
          <tr key={j.id}>
            <td className="px-4 py-3 font-mono text-xs">{j.type}</td>
            <td className="px-4 py-3"><Badge tone={j.status === "DEAD" ? "danger" : j.status === "COMPLETED" ? "success" : "info"}>{j.status}</Badge></td>
            <td className="px-4 py-3 tabular">{j.attempts}/{j.maxAttempts}</td>
            <td className="max-w-md truncate px-4 py-3 text-xs text-ink-3" title={j.lastError ?? ""}>{j.lastError ?? "—"}</td>
            <td className="px-4 py-3 text-ink-3">{format.relativeTime(j.createdAt)}</td>
            <td className="px-4 py-3">{j.status === "DEAD" && <RetryJob id={j.id} />}</td>
          </tr>
        ))}
      </AdminTable>
      {jobs.length === 0 && <p className="text-sm text-ink-3">{t("noJobs")}</p>}
    </div>
  );
}
