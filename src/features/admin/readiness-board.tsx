"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import type { ReadinessRow } from "@/server/admin/readiness";
import { linkWhatsAppNumberAction, storageTestAction, validateProviderAction } from "./actions";

const NAMES: Record<string, string> = { openai: "OpenAI", linkedin: "LinkedIn", instagram: "Instagram Direct", facebook: "Facebook Pages", tiktok: "TikTok", google: "Google", microsoft: "Microsoft", whatsapp: "WhatsApp Business", email: "Email", storage: "Storage", stripe: "Stripe" };

function YesNo({ v, yes, no, unknown }: { v: boolean | null; yes: string; no: string; unknown: string }) {
  if (v == null) return <span className="inline-flex items-center gap-1 text-ink-4"><CircleDashed className="size-3.5" /> {unknown}</span>;
  return v ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-3.5" /> {yes}</span> : <span className="inline-flex items-center gap-1 text-danger"><XCircle className="size-3.5" /> {no}</span>;
}

/**
 * Platform-admin readiness matrix. Every YES comes from a recorded live validation; the admin sees the
 * provider's real error text here (customers never do). No secrets are rendered.
 */
export function ReadinessBoard({ rows }: { rows: ReadinessRow[] }) {
  const t = useTranslations("settings.admin.readiness");
  const te = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [wa, setWa] = useState({ phoneNumberId: "", wabaId: "" });
  const [storageSteps, setStorageSteps] = useState<string | null>(null);
  const err = (code: string) => (te.has(code as "unexpected") ? te(code as "unexpected") : code);

  const validate = (provider: string) => {
    setBusy(provider);
    start(async () => {
      const r = await validateProviderAction({ provider });
      setBusy(null);
      if (!r.ok) return toast.error(err(r.error));
      (r.data.ok ? toast : toast.error)(`${NAMES[provider]}: ${r.data.detail ?? (r.data.ok ? "OK" : "failed")}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[980px] text-sm" data-testid="readiness">
          <thead className="border-b border-line bg-surface-2 text-xs text-ink-3">
            <tr>
              {["provider", "configured", "credentials", "accounts", "lastSuccess", "lastError", "capabilities", "pending", "liveTested", ""].map((h) => (
                <th key={h} className="px-3 py-2.5 text-start font-medium">{h ? t(`cols.${h}`) : ""}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line align-top">
            {rows.map((r) => (
              <tr key={r.provider} data-provider={r.provider}>
                <td className="px-3 py-3 font-semibold">{NAMES[r.provider]}</td>
                <td className="px-3 py-3"><YesNo v={r.configured} yes={t("yes")} no={t("no")} unknown="—" /></td>
                <td className="px-3 py-3"><YesNo v={r.credentialsValid} yes={t("valid")} no={t("invalid")} unknown={t("notChecked")} /></td>
                <td className="px-3 py-3 tabular">{r.liveAccounts ?? "—"}</td>
                <td className="px-3 py-3 text-xs text-ink-3">{r.lastSuccessAt ? format.dateTime(new Date(r.lastSuccessAt), { dateStyle: "short", timeStyle: "short" }) : "—"}</td>
                <td className="max-w-[240px] px-3 py-3 text-xs">
                  {r.lastError ? (
                    <details>
                      <summary className="cursor-pointer text-danger">{r.lastError.check}</summary>
                      <p className="mt-1 break-words font-mono text-[11px] text-ink-2" dir="ltr">{r.lastError.detail ?? "—"}</p>
                    </details>
                  ) : "—"}
                </td>
                <td className="px-3 py-3">
                  <div className="flex max-w-[200px] flex-wrap gap-1">{r.capabilities.map((c) => <code key={c} className={cn("rounded px-1.5 py-0.5 text-[11px]", r.liveTestedChecks.some((x) => c.includes(x) || x.includes(c)) ? "bg-success-soft text-success" : "bg-sunken text-ink-3")}>{c}</code>)}</div>
                </td>
                <td className="max-w-[260px] px-3 py-3 text-xs text-ink-2">{r.pendingApproval.length ? <ul className="list-disc space-y-1 ps-4">{r.pendingApproval.map((p) => <li key={p}>{p}</li>)}</ul> : "—"}</td>
                <td className="px-3 py-3">
                  <Badge tone={r.liveTested ? "success" : "outline"}>{r.liveTested ? t("yes") : t("no")}</Badge>
                  {r.liveTestedChecks.length > 0 && <div className="mt-1 text-[11px] text-ink-4">{r.liveTestedChecks.join(", ")}</div>}
                  {r.note && <div className="mt-1 text-[11px] text-ink-4">{t(`notes.${r.note}` as "notes.local_storage")}</div>}
                </td>
                <td className="px-3 py-3 text-end">
                  {r.provider === "storage" ? (
                    <Button size="xs" variant="outline" loading={pending && busy === "storage"} onClick={() => { setBusy("storage"); start(async () => { const x = await storageTestAction(); setBusy(null); if (!x.ok) return toast.error(err(x.error)); setStorageSteps(`${x.data.driver}: ${x.data.steps.map((s) => `${s.step} ${s.ok ? "✓" : `✗${s.detail ? ` (${s.detail})` : ""}`}`).join(" · ")}`); router.refresh(); }); }}>{t("storageTest")}</Button>
                  ) : (
                    <Button size="xs" variant="outline" loading={pending && busy === r.provider} onClick={() => validate(r.provider)}>{t("validate")}</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {storageSteps && <p className="rounded-xl bg-surface-2 px-3 py-2 font-mono text-xs" dir="ltr">{storageSteps}</p>}
      <p className="text-xs text-ink-4">{t("footnote")}</p>

      <form
        className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await linkWhatsAppNumberAction(wa);
            if (!r.ok) return toast.error(err(r.error));
            toast(t("waLinked", { phone: r.data.displayPhone ?? wa.phoneNumberId }));
            setWa({ phoneNumberId: "", wabaId: "" });
            router.refresh();
          });
        }}
      >
        <div className="flex-1 space-y-1">
          <p className="text-sm font-semibold">{t("waTitle")}</p>
          <p className="text-xs text-ink-3">{t("waBody")}</p>
        </div>
        <Input value={wa.phoneNumberId} onChange={(e) => setWa({ ...wa, phoneNumberId: e.target.value })} placeholder="phone_number_id" aria-label="phone_number_id" dir="ltr" className="sm:w-48" required />
        <Input value={wa.wabaId} onChange={(e) => setWa({ ...wa, wabaId: e.target.value })} placeholder="WABA id (optional)" aria-label="WABA id" dir="ltr" className="sm:w-48" />
        <Button type="submit" size="sm" loading={pending && !busy}>{t("waLink")}</Button>
      </form>
    </div>
  );
}
