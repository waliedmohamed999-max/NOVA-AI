import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/server/context";
import { providerConfigStatus } from "@/server/admin/providers";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Admin · Providers" };

const TONE = { configured: "success", missing: "neutral", error: "danger" } as const;

/** Platform admins only. Env-based status with masked values — nothing here is editable or stored. */
export default async function AdminProvidersPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("settings.admin.providers");
  const rows = providerConfigStatus();
  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-ink-3">{t("intro")}</p>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5" data-provider={r.key}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{t(`names.${r.key}` as "names.meta")}</h2>
              <Badge tone={TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
            </div>
            <dl className="space-y-1.5 text-xs">
              {r.fields.map((f) => (
                <div key={f.env} className="flex items-center justify-between gap-3">
                  <dt className="truncate font-mono text-ink-3">{f.env}</dt>
                  <dd className={f.value ? "font-mono text-ink" : "text-ink-4"} dir="ltr">{f.value ?? t("unset")}</dd>
                </div>
              ))}
            </dl>
            {r.note && <p className="mt-auto rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink-2">{t(`notes.${r.note}` as "notes.local")}</p>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-4">{t("footer")}</p>
    </div>
  );
}
