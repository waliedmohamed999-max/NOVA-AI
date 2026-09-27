"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, CheckCircle2, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { ChannelIcon } from "@/components/brand/channel-icon";
import type { ConnectionCard, ConnectionsView } from "@/server/integrations/connections";
import { analyzeWebsite, chooseAccounts, disconnect, websiteStatus } from "./actions";

export type ConnectFlash = { connected: string[]; choose: string[]; limited: string[]; error: string | null; upgrade?: { platform: string; capability: string } | null };

type Success = { platform: string; account: string | null };

const LATER = ["WHATSAPP", "YOUTUBE", "X"] as const;

export function ConnectAccounts({ view, from, canManage, flash }: { view: ConnectionsView; from: "onboarding" | "settings"; canManage: boolean; flash: ConnectFlash }) {
  const t = useTranslations("settings.connect");
  const th = useTranslations("settings.integrations.health");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);
  const [chooseQueue, setChooseQueue] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<ConnectionCard | null>(null);

  const platformName = (p: string) => tc(`platforms.${p}` as "platforms.INSTAGRAM");
  const errorText = (code: string) => (te.has(code as "unexpected") ? te(code as "unexpected") : te("unexpected"));

  // Handle the OAuth return exactly once, then clean the URL (no codes/tokens are ever in it).
  useEffect(() => {
    const { connected, choose, limited, error } = flash;
    if (!connected.length && !choose.length && !limited.length && !error) return;
    queueMicrotask(() => {
      if (error) toast.error(errorText(error));
      if (limited.length) toast.error(t("limited", { platforms: limited.map(platformName).join(" · ") }));
      // If any platform of a sign-in needs a choice, show everything that sign-in returned in one picker.
      const needs = view.cards.filter((c) => choose.includes(c.platform) && c.state === "choose");
      const pickers = needs.length ? view.cards.filter((c) => connected.includes(c.platform) && needs.some((n) => n.oauth === c.oauth)).map((c) => c.platform) : [];
      if (pickers.length) setChooseQueue(pickers);
      const done = pickers.length ? null : view.cards.find((c) => connected.includes(c.platform) && c.state === "connected");
      if (done) {
        const acc = done.accounts.find((a) => a.isActive);
        setSuccess({ platform: done.platform, account: acc ? (acc.handle ?? acc.name) : null });
      }
      router.replace(pathname, { scroll: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!success) return;
    const id = setTimeout(() => setSuccess(null), 4200);
    return () => clearTimeout(id);
  }, [success]);

  const connectHref = (c: ConnectionCard) => `/api/integrations/${c.oauth}/start?from=${from}`;
  const startConnect = (c: ConnectionCard) => setConnecting(c.oauth);

  // One picker for every platform the sign-in returned several accounts for (Meta: Pages + Instagram).
  const choosing = view.cards.filter((c) => chooseQueue.includes(c.platform) && c.integrationId && c.accounts.length > 0);

  const doDisconnect = (c: ConnectionCard) =>
    start(async () => {
      const r = await disconnect({ id: c.integrationId! });
      setConfirming(null);
      if (r.ok) {
        toast(t("disconnected", { platform: platformName(c.platform) }));
        router.refresh();
      } else toast.error(errorText(r.error));
    });

  // Graceful permission upgrade: a feature needed a permission this connection doesn't have yet.
  const upgrade = flash.upgrade ?? null;
  const upgradeCard = upgrade ? view.cards.find((c) => c.platform === upgrade.platform && c.integrationId) : null;
  const upgradeCapability = upgrade && t.has(`capabilities.${upgrade.capability}` as "capabilities.identity") ? t(`capabilities.${upgrade.capability}` as "capabilities.identity") : upgrade?.capability;

  return (
    <div className="space-y-8">
      {upgrade && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent-soft/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{t("upgradeTitle")}</p>
            <p className="text-sm text-ink-3">{t("upgradeBody", { platform: platformName(upgrade.platform), capability: upgradeCapability ?? "" })}</p>
          </div>
          {upgradeCard && canManage && upgradeCard.oauth === "meta" ? (
            <a href={`/api/integrations/meta/start?from=${from}&upgrade=${upgrade.platform}:${upgrade.capability}`} className={buttonClass("primary", "md", "shrink-0")}>{t("upgradeCta")}</a>
          ) : (
            <p className="text-sm text-ink-3">{t("upgradeUnavailable")}</p>
          )}
        </div>
      )}
      {view.isDemo && (
        <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
          <Badge tone="warning" className="shrink-0">{t("demo")}</Badge>
          <p>{t("demoNote")}</p>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-2">{t("social")}</h2>
          <span className="text-xs tabular text-ink-3">{t("plan", { used: view.plan.used, limit: view.plan.limit })}</span>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {view.cards.map((c) => (
            <SocialCard
              key={c.platform}
              card={c}
              name={platformName(c.platform)}
              canManage={canManage}
              connecting={connecting === c.oauth}
              href={connectHref(c)}
              onConnect={() => startConnect(c)}
              onChoose={() => setChooseQueue(view.cards.filter((x) => x.oauth === c.oauth && x.integrationId && x.accounts.length > 0).map((x) => x.platform))}
              onDisconnect={() => setConfirming(c)}
              healthText={c.healthKey ? th(c.healthKey as "expired") : null}
            />
          ))}
        </ul>
        <p className="flex items-start gap-2 text-xs text-ink-3">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          <span>{t("metaNote")} {t("oauthNote")}</span>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-2">{t("more")}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          <li className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-xs">
            <CardHead channel="EMAIL" name={t("emailTitle")} why={t("why.EMAIL")} chip={<Badge tone="outline">{t("state.soon")}</Badge>} />
            <p className="text-xs text-ink-3">{t("emailNote")}</p>
          </li>
          <WebsiteCard initial={view.website} canManage={canManage} />
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-2">{t("later")}</h2>
        <ul className="flex flex-wrap gap-2">
          {LATER.map((p) => (
            <li key={p} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pe-3.5 ps-1 text-sm text-ink-3">
              <ChannelIcon channel={p} className="size-7 rounded-full" />
              {platformName(p)}
              <span className="text-xs text-ink-4">· {t("state.soon")}</span>
            </li>
          ))}
        </ul>
      </section>

      <AccountPicker
        key={chooseQueue.join(",") || "none"}
        cards={choosing}
        onClose={() => setChooseQueue([])}
        onSaved={(platform, account) => {
          setChooseQueue([]);
          setSuccess({ platform, account });
          router.refresh();
        }}
      />

      <Dialog open={Boolean(confirming)} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent
          size="sm"
          title={confirming ? t("actions.disconnect") + " · " + platformName(confirming.platform) : ""}
          description={confirming ? t("disconnectConfirm", { platform: platformName(confirming.platform) }) : ""}
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(null)}>{tc("actions.cancel")}</Button>
            <Button variant="danger" loading={pending} onClick={() => confirming && doDisconnect(confirming)}>{t("actions.disconnect")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {success && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-4 bottom-6 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-lg"
          >
            <motion.span
              initial={{ scale: 0.4, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.08 }}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success text-white"
            >
              <Check className="size-5" strokeWidth={3} />
            </motion.span>
            <div className="min-w-0">
              <p className="font-semibold">{t("success", { platform: platformName(success.platform) })}</p>
              <p className="truncate text-sm text-ink-3">
                {success.account ? t("successBody", { account: success.account }) : t("successBodyNoHandle")}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CardHead({ channel, name, why, chip }: { channel: string; name: string; why: string; chip: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <ChannelIcon channel={channel} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <h3 className="font-semibold">{name}</h3>
          {chip}
        </div>
        <p className="mt-0.5 text-xs text-ink-3">{why}</p>
      </div>
    </div>
  );
}

function StateChip({ state, connecting }: { state: ConnectionCard["state"]; connecting: boolean }) {
  const t = useTranslations("settings.connect.state");
  if (connecting)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-3">
        <Loader2 className="size-3.5 animate-spin" /> {t("connecting")}
      </span>
    );
  if (state === "connected")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
        <CheckCircle2 className="size-3.5" /> {t("connected")}
      </span>
    );
  if (state === "reconnect")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-warning">
        <AlertTriangle className="size-3.5" /> {t("reconnect")}
      </span>
    );
  if (state === "choose") return <span className="text-xs font-semibold text-accent-ink">{t("choose")}</span>;
  if (state === "unavailable") return <span className="text-xs text-ink-4">{t("unavailable")}</span>;
  return <span className="text-xs text-ink-3">{t("idle")}</span>;
}

function SocialCard(props: {
  card: ConnectionCard;
  name: string;
  canManage: boolean;
  connecting: boolean;
  href: string;
  healthText: string | null;
  onConnect: () => void;
  onChoose: () => void;
  onDisconnect: () => void;
}) {
  const t = useTranslations("settings.connect");
  const { card: c, canManage, connecting } = props;
  const active = c.accounts.filter((a) => a.isActive);
  const link = (label: string, variant: "primary" | "secondary" = "primary") => (
    <a href={props.href} onClick={props.onConnect} aria-disabled={connecting} className={cn(buttonClass(variant, "sm"), connecting && "pointer-events-none opacity-60")}>
      {label}
    </a>
  );
  return (
    <li className={cn("flex flex-col gap-3 rounded-2xl border bg-surface p-4 shadow-xs transition", c.state === "reconnect" ? "border-warning/40" : c.state === "connected" ? "border-success/30" : "border-line")} data-platform={c.platform}>
      <CardHead channel={c.platform} name={props.name} why={t(`why.${c.platform}` as "why.INSTAGRAM")} chip={<StateChip state={c.state} connecting={connecting} />} />
      {c.state === "connected" && active.length > 0 && (
        <ul className="space-y-1 text-sm">
          {active.map((a) => (
            <li key={a.id} className="flex min-w-0 items-center gap-2">
              <Check className="size-3.5 shrink-0 text-success" />
              <span className="truncate font-medium" dir="auto">{a.handle ?? a.name}</span>
            </li>
          ))}
        </ul>
      )}
      {c.state === "reconnect" && props.healthText && <p className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">{props.healthText}</p>}
      {canManage && c.state !== "unavailable" && (
        <div className="mt-auto flex flex-wrap gap-2">
          {c.state === "idle" && link(t("actions.connect"))}
          {c.state === "reconnect" && link(t("actions.reconnect"))}
          {c.state === "choose" && <Button size="sm" onClick={props.onChoose}>{t("actions.choose")}</Button>}
          {c.state === "connected" &&
            (c.accounts.length > 1 ? <Button size="sm" variant="secondary" onClick={props.onChoose}>{t("actions.change")}</Button> : link(t("actions.change"), "secondary"))}
          {c.state !== "idle" && c.integrationId && (
            <Button size="sm" variant="ghost" onClick={props.onDisconnect}>{t("actions.disconnect")}</Button>
          )}
        </div>
      )}
    </li>
  );
}

function AccountPicker({ cards, onClose, onSaved }: { cards: ConnectionCard[]; onClose: () => void; onSaved: (platform: string, account: string | null) => void }) {
  const t = useTranslations("settings.connect");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  // Nothing is pre-selected for a fresh multi-account sign-in; "change account" starts from the current choice.
  const [picked, setPicked] = useState<string[]>(() => cards.flatMap((c) => c.accounts.filter((a) => a.isActive).map((a) => a.id)));
  const [pending, start] = useTransition();
  if (!cards.length) return null;
  const save = () =>
    start(async () => {
      const r = await chooseAccounts({ selections: cards.map((c) => ({ integrationId: c.integrationId!, accountIds: c.accounts.filter((a) => picked.includes(a.id)).map((a) => a.id) })) });
      if (!r.ok) return void toast.error(te.has(r.error as "unexpected") ? te(r.error as "unexpected") : te("unexpected"));
      const firstCard = cards.find((c) => c.accounts.some((a) => picked.includes(a.id)))!;
      const first = firstCard.accounts.find((a) => picked.includes(a.id))!;
      onSaved(firstCard.platform, first.handle ?? first.name);
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t("pickerTitle")} description={t("pickerBody")} size="lg">
        <div className="space-y-5">
          {cards.map((c) => (
            <section key={c.platform} className="space-y-2" aria-label={tc(`platforms.${c.platform}` as "platforms.INSTAGRAM")}>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-2">
                <ChannelIcon channel={c.platform} className="size-7 rounded-lg" />
                {tc(`platforms.${c.platform}` as "platforms.INSTAGRAM")}
              </h3>
              <ul className="space-y-2">
                {c.accounts.map((a) => {
                  const on = picked.includes(a.id);
                  return (
                    <li key={a.id}>
                      <label className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition", on ? "border-ink bg-surface-2" : "border-line hover:border-line-strong")}>
                        <input
                          type="checkbox"
                          className="mt-2.5 size-4 shrink-0 accent-[var(--ink)]"
                          checked={on}
                          onChange={() => setPicked((xs) => (on ? xs.filter((x) => x !== a.id) : [...xs, a.id]))}
                          aria-label={a.name}
                        />
                        {a.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- remote platform avatar, sized small
                          <img src={a.avatarUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <ChannelIcon channel={c.platform} className="rounded-full" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium" dir="auto">{a.name}</span>
                          {a.handle && <span className="block truncate text-xs text-ink-3" dir="ltr">{a.handle}</span>}
                          {a.capabilities && (
                            <span className="mt-1.5 flex flex-wrap gap-1">
                              {a.capabilities.map((cap) => (
                                <span
                                  key={cap.key}
                                  title={cap.available ? undefined : t(`capabilityReasons.${cap.reason ?? "permission_missing"}` as "capabilityReasons.permission_missing")}
                                  className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", cap.available ? "bg-success-soft text-success" : "bg-sunken text-ink-4")}
                                >
                                  {cap.available ? "✓" : "○"} {t(`capabilities.${cap.key}` as "capabilities.identity")}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <Button className="mt-5 w-full" disabled={picked.length === 0} loading={pending} onClick={save}>{t("pickerContinue")}</Button>
      </DialogContent>
    </Dialog>
  );
}

function WebsiteCard({ initial, canManage }: { initial: ConnectionsView["website"]; canManage: boolean }) {
  const t = useTranslations("settings.connect");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [url, setUrl] = useState(initial.url ?? "");
  const [status, setStatus] = useState<string | null>(initial.status);
  const [pending, start] = useTransition();
  const working = status === "PENDING" || status === "PROCESSING";

  useEffect(() => {
    if (!working) return;
    const id = setInterval(async () => {
      const r = await websiteStatus({});
      if (r.ok) setStatus(r.data.status);
    }, 2500);
    return () => clearInterval(id);
  }, [working]);

  const steps = useMemo(() => {
    if (!status) return [];
    const order = ["PENDING", "PROCESSING", "READY"] as const;
    if (status === "FAILED") return [{ key: "FAILED", done: false, failed: true }];
    const at = order.indexOf(status as (typeof order)[number]);
    return order.map((k, i) => ({ key: k, done: i < at || status === "READY", failed: false, current: i === at && status !== "READY" }));
  }, [status]);

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-xs">
      <CardHead channel="WEBSITE" name={tc("platforms.WEBSITE")} why={t("why.WEBSITE")} chip={status === "READY" ? <StateChip state="connected" connecting={false} /> : <span />} />
      {canManage && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await analyzeWebsite({ url });
              if (!r.ok) return void toast.error(te.has(r.error as "unexpected") ? te(r.error as "unexpected") : te("unexpected"));
              setUrl(r.data.url);
              setStatus("PENDING");
            });
          }}
        >
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("website.placeholder")} dir="ltr" aria-label={tc("platforms.WEBSITE")} className="h-9 min-w-0 flex-1" />
          <Button type="submit" size="sm" loading={pending} disabled={url.trim().length < 3 || working}>
            {status === "READY" || status === "FAILED" ? t("website.reanalyze") : t("website.analyze")}
          </Button>
        </form>
      )}
      {steps.length > 0 && (
        <ol className="space-y-1 text-xs" aria-live="polite">
          {steps.map((s) => (
            <li key={s.key} className={cn("flex items-center gap-2", s.failed ? "text-danger" : s.done ? "text-success" : "text-ink-3")}>
              {s.failed ? <AlertTriangle className="size-3.5" /> : s.done ? <Check className="size-3.5" /> : "current" in s && s.current ? <Loader2 className="size-3.5 animate-spin" /> : <span className="size-3.5" />}
              {t(`website.steps.${s.key}` as "website.steps.READY")}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
