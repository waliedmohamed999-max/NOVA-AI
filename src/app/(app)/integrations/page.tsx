import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { INTEGRATION_CATALOG, SOCIAL_PROVIDERS } from "@/server/integrations/registry";
import { aiAvailability } from "@/server/ai";
import { getMailer } from "@/server/email/mailer";
import { IntegrationGrid, type IntegrationTile } from "@/features/integrations/grid";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage(props: PageProps<"/integrations">) {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("settings.integrations");
  const format = await getFormatter();
  const sp = await props.searchParams;
  const rows = await ctx.db.integration.findMany({ include: { accounts: { where: { isActive: true } } } });
  const tiles: IntegrationTile[] = INTEGRATION_CATALOG.map((c) => {
    const row = rows.find((r) => r.provider === c.provider);
    return {
      provider: c.provider,
      oauth: c.oauth,
      stage: c.stage,
      configured: c.oauth ? SOCIAL_PROVIDERS[c.oauth].isConfigured() : false,
      id: row?.id ?? null,
      status: row?.status ?? "DISCONNECTED",
      statusMessage: row?.statusMessage ?? null,
      accounts: row?.accounts.map((a) => ({ name: a.name, handle: a.handle })) ?? [],
      scopes: row?.scopes ?? [],
      lastSync: row?.lastSyncAt ? format.relativeTime(row.lastSyncAt) : null,
      envHint: c.docs,
    };
  });
  const ai = aiAvailability();
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <IntegrationGrid
        tiles={tiles}
        canManage={ctx.can("integrations:manage")}
        flash={{ connected: typeof sp.connected === "string" ? sp.connected : null, error: typeof sp.error === "string" ? sp.error : null }}
        system={{ ai: ai.configured ? (ai.offline ? "offline" : ai.providers.join(" + ")) : null, email: getMailer().configured }}
      />
    </>
  );
}
