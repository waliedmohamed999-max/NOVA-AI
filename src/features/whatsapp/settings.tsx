"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Lock, Plus, ShieldAlert, Trash2, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import type { ConnectionHealth } from "@/server/whatsapp/settings";
import { addSuppressionAction, removeSuppressionAction, saveSettingsAction } from "./actions";

const LEVELS = ["OFF", "DRAFT", "SAFE_AUTO", "CUSTOM"] as const;
const SAFE = ["greeting", "opening_hours", "location", "services_info", "contact_details", "booking_info"] as const;

type Settings = { level: (typeof LEVELS)[number]; safeIntents: string[]; optOutKeywords: string[]; requireConsent: boolean };

export function SettingsView({ initial, suppressions, health, canManage, isAdmin }: { initial: Settings; suppressions: { rows: { id: string; phone: string; reason: string; note: string | null; at: string }[]; total: number }; health: ConnectionHealth; canManage: boolean; isAdmin: boolean }) {
  const t = useTranslations("whatsapp.settings");
  const te = useTranslations("errors");
  const f = useFormatter();
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [word, setWord] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();
  const save = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    start(async () => {
      const r = await saveSettingsAction(patch as Parameters<typeof saveSettingsAction>[0]);
      if (!r.ok) return void toast(te((r.error ?? "unexpected") as "unexpected"), "error");
      toast(t("saved"));
    });
  };
  const n = health.numbers.find((x) => x.status !== "disconnected");

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
          <h2 className="mb-3 text-[15px] font-bold">{t("level.title")}</h2>
          <div role="radiogroup" aria-label={t("level.title")} className="grid gap-2 sm:grid-cols-2">
            {LEVELS.map((l) => (
              <button key={l} role="radio" aria-checked={s.level === l} disabled={!canManage || pending} onClick={() => save({ level: l })} className={cn("rounded-2xl border p-4 text-start transition disabled:opacity-60", s.level === l ? "border-[#1fa855] bg-[#e7f8ee]/60" : "border-line hover:border-line-strong")} data-testid={`wa-level-${l}`}>
                <span className="block text-sm font-bold">{t(`level.${l}.title`)}</span>
                <span className="mt-1 block text-xs text-ink-3">{t(`level.${l}.desc`)}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-2xl bg-danger-soft/60 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-danger"><Lock className="size-3.5" /> {t("never.title")}</p>
            <p className="mt-1 text-xs text-ink-2">{t("never.items")}</p>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
          <h2 className="mb-3 text-[15px] font-bold">{t("safe.title")}</h2>
          <div className="flex flex-wrap gap-2">
            {SAFE.map((i) => {
              const on = s.safeIntents.includes(i);
              return (
                <button key={i} role="checkbox" aria-checked={on} disabled={!canManage || pending} onClick={() => save({ safeIntents: on ? s.safeIntents.filter((x) => x !== i) : [...s.safeIntents, i] })} className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", on ? "border-[#1fa855] bg-[#e7f8ee] text-[#0e5f2f]" : "border-line text-ink-2")}>
                  {t(`safe.${i}`)}
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
          <h2 className="text-[15px] font-bold">{t("optOut.title")}</h2>
          <p className="mb-3 text-xs text-ink-3">{t("optOut.hint")}</p>
          <div className="flex flex-wrap gap-1.5">
            {["STOP", "إلغاء", ...s.optOutKeywords].map((w, i) => (
              <span key={`${w}${i}`} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs font-semibold">
                {w}
                {i > 1 && canManage && <button onClick={() => save({ optOutKeywords: s.optOutKeywords.filter((x) => x !== w) })} aria-label={`${w} ×`}><XCircle className="size-3" /></button>}
              </span>
            ))}
          </div>
          {canManage && (
            <div className="mt-3 flex gap-2">
              <input value={word} onChange={(e) => setWord(e.target.value)} maxLength={30} placeholder={t("optOut.placeholder")} aria-label={t("optOut.placeholder")} className="h-10 flex-1 rounded-xl border border-line px-3 text-sm" />
              <button disabled={!word.trim()} onClick={() => { save({ optOutKeywords: [...s.optOutKeywords, word.trim()].slice(0, 10) }); setWord(""); }} className="rounded-xl border border-line px-3"><Plus className="size-4" /></button>
            </div>
          )}
          <label className="mt-5 flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-4 accent-[#1fa855]" checked={s.requireConsent} disabled={!canManage} onChange={(e) => save({ requireConsent: e.target.checked })} />
            <span>
              <span className="block text-sm font-semibold">{t("consent.title")}</span>
              <span className="block text-xs text-ink-3">{t("consent.desc")}</span>
            </span>
          </label>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5 shadow-xs" data-testid="wa-suppression">
          <h2 className="text-[15px] font-bold">{t("suppression.title")}</h2>
          <p className="mb-3 text-xs text-ink-3">{t("suppression.hint")}</p>
          {canManage && (
            <div className="mb-3 flex gap-2">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("suppression.phone")} aria-label={t("suppression.phone")} dir="ltr" className="h-10 flex-1 rounded-xl border border-line px-3 text-sm" />
              <button
                disabled={pending || phone.replace(/\D/g, "").length < 8}
                onClick={() => start(async () => { const r = await addSuppressionAction({ phone, reason: "blocked" }); if (!r.ok) return void toast(te((r.error ?? "unexpected") as "unexpected"), "error"); setPhone(""); router.refresh(); })}
                className="h-10 rounded-xl bg-ink px-3 text-sm font-semibold text-ink-inverse"
              >
                {t("suppression.add")}
              </button>
            </div>
          )}
          {suppressions.rows.length === 0 ? (
            <p className="text-sm text-ink-3">{t("suppression.empty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {suppressions.rows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="font-medium" dir="ltr">+{r.phone}</span>
                  <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px]">{t(`suppression.reasons.${r.reason}` as "suppression.reasons.manual")}</span>
                  <span className="ms-auto text-xs text-ink-4">{f.relativeTime(new Date(r.at))}</span>
                  {canManage && r.reason !== "opt_out" && (
                    <button onClick={() => start(async () => { const x = await removeSuppressionAction({ id: r.id }); if (!x.ok) return void toast(te((x.error ?? "unexpected") as "unexpected"), "error"); router.refresh(); })} className="text-ink-3 hover:text-danger" aria-label={t("suppression.remove")}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-xs" data-testid="wa-health">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold">{t("health.title")} {pending && <Loader2 className="size-4 animate-spin" />}</h2>
          <ul className="space-y-2.5 text-sm">
            <li className="flex items-center gap-2"><Status ok={n?.status === "connected"} /> {t("health.connection")} <span className="ms-auto text-ink-3" dir="ltr">{n?.display ?? "—"}</span></li>
            <li className="flex items-center gap-2"><Status ok={health.webhookReady} /> {t("health.webhook")} <span className="ms-auto text-ink-3">{health.webhookReady ? t("health.ok") : t("health.notReady")}</span></li>
            <li className="flex items-center gap-2"><Status ok={health.approvedTemplates > 0} /> {t("health.templates")} <span className="ms-auto text-ink-3">{health.approvedTemplates}</span></li>
            <li className="flex items-center gap-2 text-ink-3">{t("health.lastWebhook")} <span className="ms-auto">{n?.lastWebhookAt ? f.relativeTime(new Date(n.lastWebhookAt)) : "—"}</span></li>
            <li className="flex items-center gap-2 text-ink-3">{t("health.lastSend")} <span className="ms-auto">{health.lastSuccessfulSend ? f.relativeTime(new Date(health.lastSuccessfulSend)) : "—"}</span></li>
          </ul>
          {n?.status === "reconnect_needed" && <a href="/whatsapp/numbers" className="mt-3 inline-flex rounded-xl bg-[#1fa855] px-3 py-2 text-sm font-semibold text-white">{t("health.reconnect")}</a>}
          {isAdmin && health.admin && (
            <div className="mt-4 rounded-2xl bg-sunken p-3 text-xs">
              <p className="mb-1 flex items-center gap-1 font-bold"><ShieldAlert className="size-3.5" /> {t("health.admin")}</p>
              {health.admin.missingEnv.length ? <p>{t("health.missing", { vars: health.admin.missingEnv.join(", ") })}</p> : <p>OK</p>}
              {n?.lastError && <p className="mt-1 text-danger">{n.lastError}</p>}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function Status({ ok }: { ok: boolean }) {
  return ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />;
}
