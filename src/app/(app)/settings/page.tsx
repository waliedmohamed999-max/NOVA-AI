import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { OrganizationForm } from "@/features/settings/forms";
import { SetupIncompleteCard } from "@/features/settings/setup-incomplete";
import { setupIncomplete } from "@/server/onboarding/service";

export const metadata: Metadata = { title: "Settings" };

export default async function OrganizationSettingsPage() {
  const ctx = await requireTenant();
  const org = await ctx.db.organization.findUniqueOrThrow({ where: { id: ctx.organization.id } });
  const incomplete = setupIncomplete(org.onboardingData);
  return (
    <div className="space-y-6">
      {incomplete.length > 0 && <SetupIncompleteCard steps={incomplete} canEdit={ctx.can("settings:manage")} />}
      <OrganizationForm
        canEdit={ctx.can("settings:manage")}
        org={{ name: org.name, timezone: org.timezone, locale: org.locale === "ar" ? "ar" : "en", website: org.website ?? "", slug: org.slug }}
        timezones={Intl.supportedValuesOf("timeZone")}
      />
    </div>
  );
}
