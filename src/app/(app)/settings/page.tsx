import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { OrganizationForm } from "@/features/settings/forms";

export const metadata: Metadata = { title: "Settings" };

export default async function OrganizationSettingsPage() {
  const ctx = await requireTenant();
  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organization.id } });
  return (
    <OrganizationForm
      canEdit={ctx.can("settings:manage")}
      org={{ name: org.name, timezone: org.timezone, locale: org.locale === "ar" ? "ar" : "en", website: org.website ?? "", slug: org.slug }}
      timezones={Intl.supportedValuesOf("timeZone")}
    />
  );
}
