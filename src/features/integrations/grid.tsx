"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, Globe, Mail, MessageCircle, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { PlatformDot } from "@/components/content/post-preview";
import { disconnect, syncNow } from "./actions";

export type IntegrationTile = {
  provider: string;
  oauth: string | null;
  stage: "available" | "future";
  configured: boolean;
  id: string | null;
  status: string;
  statusMessage: string | null;
  accounts: { name: string; handle: string | null }[];
  scopes: string[];
  lastSync: string | null;
  envHint: string;
};

const HEALTH: Record<string, "success" | "warning" | "danger" | "neutral"> = { CONNECTED: "success", ACTION_REQUIRED: "warning", EXPIRED: "danger", ERROR: "danger", DISCONNECTED: "neutral" };

export function IntegrationGrid({ tiles, canManage, flash, system }: { tiles: IntegrationTile[]; canManage: boolean; flash: { connected: string | null; error: string | null }; system: { ai: string | null; email: boolean } }) {
  const t = useTranslations("settings.integrations");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (flash.connected) toast(t("connectedToast"));
    if (flash.error) toast.error(te(flash.error as "unexpected"));
    if (flash.connected || flash.error) router.replace("/integrations");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(ok);
        router.refresh();
      } else toast.error(te((r.error ?? "unexpected") as "unexpected"));
    });

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-3">{t("social")}</h2>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tiles.map((i) => {
            const connected = i.status !== "DISCONNECTED";
            return (
              <li key={i.provider} className={cn("flex flex-col rounded-[24px] border border-line bg-surface p-6 shadow-xs", i.stage === "future" && "opacity-70")}>
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-sunken"><PlatformDot platform={i.provider} className="size-3" /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">{tc(`platforms.${i.provider}` as "platforms.INSTAGRAM")}</h3>
                    <div className="flex items-center gap-1.5 text-xs text-ink-3">
                      <StatusDot tone={HEALTH[i.status] ?? "neutral"} />
                      {i.stage === "future" ? t("comingSoon") : t(`status.${i.status}` as "status.CONNECTED")}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex-1 space-y-2 text-sm">
                  {i.accounts.length > 0 && (
                    <ul className="space-y-1">
                      {i.accounts.map((a) => <li key={a.name} className="flex items-center gap-2"><CheckCircle2 className="size-3.5 text-success" />{a.name}{a.handle && <span className="text-ink-3">{a.handle}</span>}</li>)}
                    </ul>
                  )}
                  {i.statusMessage && i.status !== "CONNECTED" && <p className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">{t(`health.${i.statusMessage}` as "health.expired")}</p>}
                  {i.lastSync && <p className="text-xs text-ink-3">{t("lastSync", { time: i.lastSync })}</p>}
                  {i.scopes.length > 0 && <p className="line-clamp-2 text-xs text-ink-4">{t("permissions")}: {i.scopes.join(", ")}</p>}
                  {i.stage === "available" && !i.configured && !connected && <p className="text-xs text-ink-3">{t("notConfigured", { vars: i.envHint })}</p>}
                  {i.stage === "available" && !connected && i.configured && <p className="text-xs text-ink-3">{t(`why.${i.provider}` as "why.INSTAGRAM")}</p>}
                </div>

                {i.stage === "available" && canManage && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {!connected || i.status !== "CONNECTED" ? (
                      i.configured ? (
                        <a href={`/api/integrations/${i.oauth}/connect`} className={buttonClass("primary", "sm")}>{connected ? tc("actions.reconnect") : tc("actions.connect")}</a>
                      ) : (
                        <Badge tone="outline">{t("adminSetup")}</Badge>
                      )
                    ) : (
                      <Button size="sm" variant="secondary" loading={pending} icon={<RefreshCw className="size-3.5" />} onClick={() => act(() => syncNow({ id: i.id! }), t("syncing"))}>{t("syncNow")}</Button>
                    )}
                    {connected && i.id && (
                      <Button size="sm" variant="ghost" onClick={() => act(() => disconnect({ id: i.id! }), t("disconnectedToast"))}>{tc("actions.disconnect")}</Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-3">{t("other")}</h2>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { key: "ai", icon: Sparkles, ok: Boolean(system.ai), detail: system.ai === "offline" ? t("aiOffline") : system.ai ?? t("aiMissing") },
            { key: "email", icon: Mail, ok: system.email, detail: system.email ? t("emailOn") : t("emailOff") },
            { key: "website", icon: Globe, ok: true, detail: t("websiteDetail"), href: "/settings/lead-capture" },
            { key: "whatsapp", icon: MessageCircle, ok: false, detail: t("whatsappDetail") },
          ].map((s) => (
            <li key={s.key} className="rounded-[22px] border border-line bg-surface p-5">
              <div className="flex items-center justify-between">
                <s.icon className="size-5 text-ink-2" />
                <StatusDot tone={s.ok ? "success" : "neutral"} />
              </div>
              <h3 className="mt-3 font-semibold">{t(`systems.${s.key}` as "systems.ai")}</h3>
              <p className="mt-1 text-xs text-ink-3">{s.detail}</p>
              {s.href && <a href={s.href} className="mt-3 inline-block text-xs font-semibold text-accent-ink hover:underline">{t("setup")}</a>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
