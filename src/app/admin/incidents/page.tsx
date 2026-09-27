import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/server/context";
import { adminIncidents } from "@/server/admin/queries";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Admin · Incidents" };

export default async function AdminIncidentsPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("settings.admin");
  const format = await getFormatter();
  const items = await adminIncidents();
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-3">{t("incidentsWindow")}</p>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface px-5 py-8 text-center text-sm text-ink-3">{t("noIncidents")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-[20px] border border-line bg-surface">
          {items.map((i) => (
            <li key={`${i.kind}-${i.id}`} className="flex items-start gap-3 px-5 py-3 text-sm">
              <Badge tone={i.kind === "job" ? "danger" : i.kind === "integration" ? "warning" : "info"}>{t(`kinds.${i.kind}` as "kinds.job")}</Badge>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{i.title}</div>
                <div className="truncate text-xs text-ink-3">{i.detail ?? "—"}</div>
              </div>
              <span className="text-xs text-ink-4">{i.at ? format.relativeTime(i.at) : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
