"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, buttonClass } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { calendarTestAction, testEmailAction, whatsappTestAction } from "./actions";

type Account = { integrationId: string; provider: "GOOGLE" | "MICROSOFT"; account: string | null; identity: boolean; emailSend: boolean; calendarRead: boolean; calendarWrite: boolean; reauthNeeded: boolean };

/**
 * Manual live tests (platform admin, own workspace). Nothing here runs in automated tests. Actions that can
 * reach a person or create data need the exact confirmation phrase.
 */
export function LiveTestsPanel({ emailProvider, accounts, whatsapp, stripeMode, confirmations }: {
  emailProvider: { name: string; configured: boolean };
  accounts: Account[];
  whatsapp: { configured: boolean; testRecipient: string | null };
  stripeMode: "test" | "live" | null;
  confirmations: { whatsapp: string; calendar: string };
}) {
  const t = useTranslations("settings.admin.live");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [emailTo, setEmailTo] = useState("");
  const [waConfirm, setWaConfirm] = useState("");
  const [calConfirm, setCalConfirm] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  const err = (code: string) => (te.has(code as "unexpected") ? te(code as "unexpected") : code);
  const run = (key: string, fn: () => Promise<{ ok: true; data: { detail?: string } & Record<string, unknown> } | { ok: false; error: string }>, format?: (d: Record<string, unknown>) => string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setResults((x) => ({ ...x, [key]: format ? format(r.data) : String(r.data.detail ?? "OK") }));
        router.refresh();
      } else {
        setResults((x) => ({ ...x, [key]: `✗ ${err(r.error)}` }));
        toast.error(err(r.error));
      }
    });
  const result = (k: string) => (results[k] ? <p className="font-mono text-[11px] text-ink-2" dir="ltr">{results[k]}</p> : null);

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="live-tests">
      <section className="space-y-3 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{t("email.title")}</h3>
          <Badge tone={emailProvider.configured ? "success" : "outline"}>{emailProvider.name}</Badge>
        </div>
        <p className="text-xs text-ink-3">{t("email.body")}</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run("email", () => testEmailAction({ to: emailTo }), (d) => `${d.provider}: accepted ${d.messageId ?? ""}${d.developmentMailbox ? " (development mailbox)" : ""}`); }}>
          <Input type="email" required value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="admin@company.com" aria-label={t("email.to")} dir="ltr" className="h-9" />
          <Button type="submit" size="sm" loading={pending}>{t("email.send")}</Button>
        </form>
        {result("email")}
        <p className="text-[11px] text-ink-4">{t("email.note")}</p>
      </section>

      <section className="space-y-3 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">WhatsApp</h3>
          <Badge tone={whatsapp.configured ? "success" : "outline"}>{whatsapp.configured ? t("configured") : t("notConfigured")}</Badge>
        </div>
        <Button size="sm" variant="secondary" loading={pending} onClick={() => run("wa-conn", () => whatsappTestAction({ kind: "connection" }))}>{t("whatsapp.connection")}</Button>
        {result("wa-conn")}
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-xs text-ink-3">{whatsapp.testRecipient ? t("whatsapp.sendBody", { to: whatsapp.testRecipient, word: confirmations.whatsapp }) : t("whatsapp.noRecipient")}</p>
          <div className="flex gap-2">
            <Input value={waConfirm} onChange={(e) => setWaConfirm(e.target.value)} placeholder={confirmations.whatsapp} aria-label={t("confirm")} dir="ltr" className="h-9" />
            <Button size="sm" variant="danger" disabled={waConfirm !== confirmations.whatsapp || !whatsapp.testRecipient} loading={pending} onClick={() => run("wa-send", () => whatsappTestAction({ kind: "send", confirmation: waConfirm }))}>{t("whatsapp.send")}</Button>
          </div>
          {result("wa-send")}
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
        <h3 className="font-semibold">{t("calendar.title")}</h3>
        {accounts.length === 0 ? (
          <p className="text-sm text-ink-3">{t("calendar.none")} <Link href="/settings/connected-accounts" className="font-medium text-accent-ink hover:underline">{t("calendar.connect")}</Link></p>
        ) : (
          <ul className="space-y-3">
            {accounts.map((a) => (
              <li key={a.integrationId} className="space-y-2 rounded-xl bg-surface-2 p-3" data-calendar={a.provider}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{a.provider === "GOOGLE" ? "Google" : "Microsoft"}</span>
                  <span className="text-ink-3" dir="ltr">{a.account ?? ""}</span>
                  {(["identity", "emailSend", "calendarRead", "calendarWrite"] as const).map((k) => <Badge key={k} tone={a[k] ? "success" : "outline"}>{t(`calendar.caps.${k}`)}</Badge>)}
                  {a.reauthNeeded && <Badge tone="warning">{t("calendar.reauth")}</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="xs" variant="secondary" disabled={!a.calendarRead} loading={pending} onClick={() => run(`cal-a-${a.integrationId}`, () => calendarTestAction({ integrationId: a.integrationId, kind: "availability" }))}>{t("calendar.availability")}</Button>
                  <Input value={calConfirm[a.integrationId] ?? ""} onChange={(e) => setCalConfirm({ ...calConfirm, [a.integrationId]: e.target.value })} placeholder={confirmations.calendar} aria-label={t("confirm")} dir="ltr" className="h-8 w-56" />
                  <Button size="xs" variant="danger" disabled={!a.calendarWrite || calConfirm[a.integrationId] !== confirmations.calendar} loading={pending} onClick={() => run(`cal-m-${a.integrationId}`, () => calendarTestAction({ integrationId: a.integrationId, kind: "meeting", confirmation: calConfirm[a.integrationId] }))}>{t("calendar.meeting")}</Button>
                </div>
                {result(`cal-a-${a.integrationId}`)}
                {result(`cal-m-${a.integrationId}`)}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-ink-4">{t("calendar.note")}</p>
      </section>

      <section className="space-y-2 rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Stripe</h3>
          <Badge tone={stripeMode === "test" ? "info" : stripeMode === "live" ? "warning" : "outline"}>{stripeMode ? `${stripeMode} mode` : t("notConfigured")}</Badge>
        </div>
        <p className="text-xs text-ink-3">{t("stripe.body")}</p>
        <Link href="/settings/billing" className={buttonClass("secondary", "sm")}>{t("stripe.open")}</Link>
      </section>
    </div>
  );
}
