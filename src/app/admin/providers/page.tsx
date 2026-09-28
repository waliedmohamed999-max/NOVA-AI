import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePlatformAdmin, resolveTenant } from "@/server/context";
import { providerConfigStatus } from "@/server/admin/providers";
import { db } from "@/server/db/client";
import { TEST_POST_CONFIRMATION, TEST_POST_TEXT } from "@/server/integrations/diagnostics";
import { Badge } from "@/components/ui/badge";
import { ConnectionTests } from "@/features/admin/connection-tests";
import { OAuthDiagnostics } from "@/features/admin/oauth-diagnostics";
import { OpenAiTests } from "@/features/admin/openai-tests";
import { imageCostSummary } from "@/server/admin/image-costs";
import { contentAiConfigured } from "@/server/ai";
import { modelCatalog } from "@/server/ai/models";
import { imageModels, imageProvider } from "@/server/design/image-provider";
import { oauthDiagnostics } from "@/server/admin/oauth-diagnostics";
import { providerReadiness } from "@/server/admin/readiness";
import { ReadinessBoard } from "@/features/admin/readiness-board";
import { CallbackMatrix } from "@/features/admin/callback-matrix";
import { LiveTestsPanel } from "@/features/admin/live-tests-panel";
import { CALENDAR_TEST_CONFIRMATION, WHATSAPP_SEND_CONFIRMATION, workspaceAccountDiagnostics } from "@/server/admin/live-tests";
import { getMailer } from "@/server/email/mailer";
import { whatsappStatus } from "@/server/whatsapp/cloud-api";
import { callbackMatrix } from "@/server/integrations/registry";

export const metadata: Metadata = { title: "Admin · Providers" };

const TONE = { configured: "success", missing: "neutral", error: "danger" } as const;

/** Platform admins only. Env-based status with masked values — nothing here is editable or stored. */
export default async function AdminProvidersPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("settings.admin.providers");
  const tt = await getTranslations("settings.admin.tests");
  const to = await getTranslations("settings.admin.oauth");
  const rows = providerConfigStatus();
  // Connection tests run only against the admin's own workspace connections.
  const tenant = await resolveTenant();
  const own = tenant
    ? await db.integration.findMany({
        where: { organizationId: tenant.organization.id, workspaceId: tenant.workspace.id, provider: { in: ["FACEBOOK", "INSTAGRAM", "LINKEDIN", "TIKTOK", "GOOGLE", "MICROSOFT"] }, status: { not: "DISCONNECTED" } },
        include: { _count: { select: { accounts: true } } },
        orderBy: { provider: "asc" },
      })
    : [];
  const tr = await getTranslations("settings.admin.readiness");
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{tr("title")}</h2>
          <p className="max-w-3xl text-sm text-ink-3">{tr("intro")}</p>
        </div>
        <ReadinessBoard rows={await providerReadiness()} />
      </section>
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{tr("liveTitle")}</h2>
          <p className="max-w-3xl text-sm text-ink-3">{tr("liveIntro")}</p>
        </div>
        <LiveTestsPanel
          emailProvider={{ name: getMailer().name, configured: getMailer().configured }}
          accounts={tenant ? await workspaceAccountDiagnostics({ organizationId: tenant.organization.id, workspaceId: tenant.workspace.id }) : []}
          whatsapp={{ configured: whatsappStatus().configured, testRecipient: process.env.WHATSAPP_TEST_RECIPIENT?.trim() ? `…${process.env.WHATSAPP_TEST_RECIPIENT.replace(/[^\d]/g, "").slice(-4)}` : null }}
          stripeMode={process.env.STRIPE_SECRET_KEY?.trim() ? (process.env.STRIPE_SECRET_KEY.includes("_live_") ? "live" : "test") : null}
          confirmations={{ whatsapp: WHATSAPP_SEND_CONFIRMATION, calendar: CALENDAR_TEST_CONFIRMATION }}
        />
      </section>
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
                    <dd className={f.value ? "min-w-0 truncate font-mono text-ink" : "text-ink-4"} dir="ltr">{f.value ?? t("unset")}</dd>
                  </div>
                ))}
              </dl>
              {r.note && <p className="mt-auto rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink-2">{t(`notes.${r.note}` as "notes.local")}</p>}
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-4">{t("footer")}</p>
      </div>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">OpenAI</h2>
        <OpenAiTests
          configured={{ text: contentAiConfigured(), image: imageProvider().isConfigured() }}
          textModel={modelCatalog().find((m) => m.provider === "openai" && m.tier === "best")?.model ?? "—"}
          imageModels={imageModels()}
          costs={await imageCostSummary()}
        />
      </section>
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{to("title")}</h2>
          <p className="max-w-2xl text-sm text-ink-3">{to("intro")}</p>
        </div>
        <OAuthDiagnostics rows={await oauthDiagnostics(tenant?.organization.id ?? null)} />
      </section>
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{tr("callbacksTitle")}</h2>
          <p className="max-w-3xl text-sm text-ink-3">{tr("callbacksIntro")}</p>
        </div>
        <CallbackMatrix rows={callbackMatrix()} />
      </section>
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{tt("title")}</h2>
          <p className="max-w-2xl text-sm text-ink-3">{tt("intro")}</p>
        </div>
        <ConnectionTests rows={own.map((i) => ({ id: i.id, provider: i.provider, status: i.status, accounts: i._count.accounts }))} testText={TEST_POST_TEXT} confirmWord={TEST_POST_CONFIRMATION} />
      </section>
    </div>
  );
}
