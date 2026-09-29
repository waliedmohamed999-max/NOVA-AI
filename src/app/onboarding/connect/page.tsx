import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { loadConnections, parseConnectFlash } from "@/server/integrations/connections";
import { Logo } from "@/components/brand/logo";
import { Progress } from "@/components/ui/misc";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ConnectAccounts } from "@/features/integrations/connect-accounts";
import { ConnectStepFooter } from "@/features/onboarding/connect-footer";

export const metadata: Metadata = { title: "Connect your accounts" };

/** Optional side step of the guided setup (linked from Review): connect accounts, then back to Review. */
export default async function OnboardingConnectPage(props: PageProps<"/onboarding/connect">) {
  const ctx = await requireTenant({ allowIncompleteOnboarding: true });
  const t = await getTranslations("settings.connect");
  const to = await getTranslations("onboarding");
  const view = await loadConnections({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }, ctx.organization.isDemo);
  const done = ctx.organization.onboardingStatus === "COMPLETED";
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line/70 bg-canvas/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-5">
          <Logo />
          <div className="hidden flex-1 px-6 sm:block">
            <Progress value={90} label={to("progress")} />
          </div>
          <LocaleSwitch compact />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-5 pb-32 pt-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="max-w-xl text-ink-3">{t("description")}</p>
        </div>
        <ConnectAccounts view={view} from="onboarding" canManage={ctx.can("integrations:manage")} flash={parseConnectFlash(await props.searchParams)} />
        <ConnectStepFooter done={done} anyConnected={view.cards.some((c) => c.state === "connected")} />
      </main>
    </div>
  );
}
