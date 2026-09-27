import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { loadConnections, parseConnectFlash } from "@/server/integrations/connections";
import { ConnectAccounts } from "@/features/integrations/connect-accounts";

export const metadata: Metadata = { title: "Connected accounts" };

export default async function ConnectedAccountsPage(props: PageProps<"/settings/connected-accounts">) {
  const ctx = await requireTenant();
  const t = await getTranslations("settings.connect");
  const view = await loadConnections({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }, ctx.organization.isDemo);
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">{t("settingsTitle")}</h2>
        <p className="mt-1 text-sm text-ink-3">{t("settingsDescription")}</p>
      </header>
      <ConnectAccounts view={view} from="settings" canManage={ctx.can("integrations:manage")} flash={parseConnectFlash(await props.searchParams)} />
    </div>
  );
}
