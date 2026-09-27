import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { BrandKitEditor } from "@/features/knowledge/brand-kit";
import { signedFileUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Brand Kit" };

export default async function BrandPage() {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("settings.brand");
  const [kit, templates] = await Promise.all([ctx.db.brandKit.findFirst(), ctx.db.designTemplate.findMany({ orderBy: { createdAt: "asc" } })]);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <BrandKitEditor
        canManage={ctx.can("brand:manage")}
        logoUrl={kit?.logoAssetId ? signedFileUrl(kit.logoAssetId) : null}
        kit={{
          tone: kit?.tone ?? "",
          voiceTraits: kit?.voiceTraits ?? [],
          primaryColors: kit?.primaryColors ?? [],
          secondaryColors: kit?.secondaryColors ?? [],
          headingFont: kit?.headingFont ?? "",
          bodyFont: kit?.bodyFont ?? "",
          imageStyle: kit?.imageStyle ?? "",
          layoutRules: kit?.layoutRules ?? [],
          forbiddenStyles: kit?.forbiddenStyles ?? [],
          doSay: kit?.doSay ?? [],
          dontSay: kit?.dontSay ?? [],
        }}
        templates={templates.map((x) => ({ id: x.id, name: x.name, format: x.format, spec: x.spec as { width: number; height: number } }))}
      />
    </>
  );
}
