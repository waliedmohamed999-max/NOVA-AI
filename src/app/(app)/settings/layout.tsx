import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { SettingsNav } from "@/features/settings/nav";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  await requireTenant();
  const t = await getTranslations("settings");
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
