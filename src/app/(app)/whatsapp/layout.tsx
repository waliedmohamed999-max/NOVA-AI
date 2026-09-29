import { getTranslations } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { numberFor, whatsappConnected } from "@/server/whatsapp/numbers";
import { WaTabs, WhatsAppGlyph, StateBadge } from "@/features/whatsapp/ui";

/** WhatsApp Business: one header + tabs over the shared CRM records (leads, conversations, campaigns). */
export default async function WhatsAppLayout({ children }: LayoutProps<"/whatsapp">) {
  const ctx = await requireTenant({ permission: "leads:read" });
  const t = await getTranslations("whatsapp");
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const [number, live] = await Promise.all([numberFor(scope), whatsappConnected(scope)]);
  const state = number ? (live ? "connected" : number.status === "reconnect_needed" ? "reconnect_needed" : "notConfigured") : "notConnected";
  return (
    <div>
      <header className="mb-4 flex flex-wrap items-center gap-4">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-[#e7f8ee] text-[#1fa855] ring-1 ring-[#1fa855]/15">
          <WhatsAppGlyph className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-ink-3">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 text-sm" data-testid="wa-connection">
          {number?.displayPhone && (
            <span className="font-medium text-ink-2" dir="ltr">
              {number.displayPhone}
            </span>
          )}
          <StateBadge state={state === "notConnected" ? "DRAFT" : state} label={t(`status.${state}`)} />
        </div>
      </header>
      <WaTabs />
      {children}
    </div>
  );
}
