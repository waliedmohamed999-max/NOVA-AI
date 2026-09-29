"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Loader2, RefreshCw, Unplug } from "lucide-react";
import { toast } from "@/components/ui/toast";
import type { ConnectionHealth } from "@/server/whatsapp/settings";
import { disconnectNumberAction, refreshNumberAction } from "./actions";
import { ConnectWhatsAppButton, type SignupConfig } from "./connect-button";
import { StateBadge } from "./ui";

export function NumbersView({ health, signup, canManage }: { health: ConnectionHealth; signup: SignupConfig; canManage: boolean }) {
  const t = useTranslations("whatsapp.numbers");
  const ts = useTranslations("whatsapp.status");
  const te = useTranslations("errors");
  const f = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast(te((r.error ?? "unexpected") as "unexpected"), "error");
      router.refresh();
    });
  const active = health.numbers.filter((n) => n.status !== "disconnected");
  const when = (iso: string | null) => (iso ? f.relativeTime(new Date(iso)) : t("never"));
  return (
    <div className="space-y-4">
      {active.length === 0 && canManage && <ConnectWhatsAppButton config={signup} size="lg" />}
      <ul className="grid gap-3 md:grid-cols-2">
        {health.numbers.map((n) => (
          <li key={n.id} className="rounded-[20px] border border-line bg-surface p-5 shadow-xs" data-testid="wa-number">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold" dir="ltr">{n.display ?? "—"}</span>
              <StateBadge state={n.status} label={ts(n.status as "connected")} />
            </div>
            <p className="text-sm text-ink-3">{n.name}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-xs text-ink-4">{t("quality")}</dt><dd className="font-medium">{n.quality ?? "—"}</dd></div>
              <div><dt className="text-xs text-ink-4">{t("tier")}</dt><dd className="font-medium">{n.tier ?? "—"}</dd></div>
              <div><dt className="text-xs text-ink-4">{t("lastWebhook")}</dt><dd className="font-medium">{when(n.lastWebhookAt)}</dd></div>
              <div><dt className="text-xs text-ink-4">{t("lastSend")}</dt><dd className="font-medium">{when(n.lastSendAt)}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-ink-4">{t("connectedAt")}</dt><dd className="font-medium">{f.dateTime(new Date(n.connectedAt), { dateStyle: "medium" })} · {t(`via.${n.via}` as "via.platform")}</dd></div>
            </dl>
            {canManage && n.status !== "disconnected" && (
              <div className="mt-4 flex gap-2">
                <button disabled={pending} onClick={() => run(() => refreshNumberAction({ id: n.id }))} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-semibold hover:bg-surface-2">
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {t("refresh")}
                </button>
                <button disabled={pending} onClick={() => run(() => disconnectNumberAction({ id: n.id }))} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-danger hover:bg-danger-soft">
                  <Unplug className="size-4" /> {t("disconnect")}
                </button>
              </div>
            )}
            {n.status === "reconnect_needed" && canManage && <div className="mt-3"><ConnectWhatsAppButton config={signup} /></div>}
          </li>
        ))}
      </ul>
      {active.length > 0 && <p className="text-xs text-ink-4">{t("one")}</p>}
    </div>
  );
}
