import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowUpRight, CheckCircle2, Circle, MessageCircle } from "lucide-react";
import { requireTenant } from "@/server/context";
import { numberFor, whatsappConnected } from "@/server/whatsapp/numbers";
import { overviewMetrics, setupChecklist } from "@/server/whatsapp/followups";
import { signupConfig } from "@/server/whatsapp/cloud-api";
import { listConversations } from "@/server/whatsapp/inbox";
import { ConnectWhatsAppButton } from "@/features/whatsapp/connect-button";
import { Metric, WhatsAppGlyph } from "@/features/whatsapp/ui";

export const metadata: Metadata = { title: "WhatsApp" };

export default async function WhatsAppOverview() {
  const ctx = await requireTenant({ permission: "leads:read" });
  const t = await getTranslations("whatsapp");
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const [number, live, metrics, checklist, recent] = await Promise.all([numberFor(scope), whatsappConnected(scope), overviewMetrics(scope), setupChecklist(scope), listConversations(scope, { filter: "all" })]);

  if (!number) {
    return (
      <section className="flex flex-col items-center gap-5 rounded-[28px] border border-dashed border-line-strong bg-surface-2 px-6 py-16 text-center" data-testid="wa-empty">
        <span className="flex size-16 items-center justify-center rounded-3xl bg-[#e7f8ee] text-[#1fa855]">
          <WhatsAppGlyph className="size-8" />
        </span>
        <div className="max-w-md space-y-2">
          <h2 className="text-xl font-bold">{t("empty.title")}</h2>
          <p className="text-sm text-ink-3">{t("empty.body")}</p>
        </div>
        {ctx.can("integrations:manage") && <ConnectWhatsAppButton config={signupConfig()} size="lg" />}
      </section>
    );
  }

  const done = checklist.filter((c) => c.done).length;
  return (
    <div className="space-y-6">
      <section aria-label={t("metrics.hint")} className="space-y-2">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label={t("metrics.conversationsToday")} value={metrics.conversationsToday} />
          <Metric label={t("metrics.unread")} value={metrics.unread} tone={metrics.unread ? "attention" : undefined} />
          <Metric label={t("metrics.needsHuman")} value={metrics.needsHuman} tone={metrics.needsHuman ? "attention" : undefined} />
          <Metric label={t("metrics.newLeads")} value={metrics.newLeads} tone={metrics.newLeads ? "good" : undefined} />
          <Metric label={t("metrics.activeCampaigns")} value={metrics.activeCampaigns} />
          <Metric label={t("metrics.sent")} value={metrics.sent} />
          <Metric label={t("metrics.delivered")} value={metrics.delivered} />
          <Metric label={t("metrics.replies")} value={metrics.replies} />
        </div>
        <p className="text-xs text-ink-4">{t("metrics.hint")}</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-[24px] border border-line bg-surface p-5 shadow-xs">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-bold">{t("tabs.inbox")}</h2>
            <Link href="/whatsapp/inbox" className="inline-flex items-center gap-1 text-sm font-medium text-nova-blue hover:underline">
              {t("tabs.inbox")} <ArrowUpRight className="size-4 flip-rtl" />
            </Link>
          </div>
          {recent.items.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-3">{live ? t("empty.waiting") : t("status.reconnect_needed")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.items.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link href={`/whatsapp/inbox?c=${c.id}`} className="flex items-center gap-3 py-3 hover:bg-surface-2">
                    <MessageCircle className="size-4 shrink-0 text-[#1fa855]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{c.name}</span>
                      <span className="block truncate text-xs text-ink-3" dir="auto">
                        {c.last?.body ?? "—"}
                      </span>
                    </span>
                    {c.needsHuman && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-ink">{t("inbox.needsHuman")}</span>}
                    {c.unread > 0 && <span className="flex size-5 items-center justify-center rounded-full bg-[#1fa855] text-[11px] font-bold text-white">{c.unread}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[24px] border border-line bg-surface p-5 shadow-xs" data-testid="wa-checklist">
          <h2 className="text-[15px] font-bold">{t("checklist.title")}</h2>
          <p className="mb-3 text-xs text-ink-3" dir="ltr">
            {done}/{checklist.length}
          </p>
          <ul className="space-y-1">
            {checklist.map((c) => (
              <li key={c.key}>
                <Link href={c.href} className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-surface-2">
                  {c.done ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-line-strong" />}
                  <span className={c.done ? "text-ink-3 line-through decoration-ink-4/40" : "font-medium text-ink"}>{t(`checklist.${c.key}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
