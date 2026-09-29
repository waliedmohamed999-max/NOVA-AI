"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import type { Audience, AudiencePreview } from "@/server/whatsapp/campaigns";
import { previewAudienceAction, previewTemplateAction, saveCampaignAction, submitCampaignAction } from "./actions";

const STEPS = ["objective", "audience", "template", "personalize", "schedule", "review", "approval"] as const;
const OBJECTIVES = ["offer", "new_product", "reengagement", "follow_up", "appointment_reminder", "event", "lead_nurturing"] as const;
const STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
const TEMPS = ["HOT", "WARM", "COLD"] as const;
const SOURCES = ["customer_name", "company", "appointment", "order", "quote_amount", "agent_name", "static"] as const;

export type WizardTemplate = { id: string; name: string; language: string; body: string; variables: Record<string, string> };
export type WizardInit = { id?: string; name: string; objective: (typeof OBJECTIVES)[number]; templateId: string | null; audience: Audience; variables: Record<string, string>; scheduledAt: string | null };

export function CampaignWizard({ init, templates, segments, connected }: { init: WizardInit; templates: WizardTemplate[]; segments: { id: string; name: string }[]; connected: boolean }) {
  const t = useTranslations("whatsapp.campaigns");
  const tt = useTranslations("whatsapp.templates.builder");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [id, setId] = useState(init.id);
  const [c, setC] = useState(init);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [counting, setCounting] = useState(false);
  const [sample, setSample] = useState<{ text: string; missing: number[] } | null>(null);
  const [result, setResult] = useState<{ state: string; eligible: number } | null>(null);
  const [pending, start] = useTransition();
  const tpl = templates.find((x) => x.id === c.templateId) ?? null;
  const vars = useMemo(() => (tpl ? [...new Set([...tpl.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b) : []), [tpl]);

  // Live audience count (server-side, paged — never all contacts in the browser).
  useEffect(() => {
    if (step !== 1 && step !== 5) return;
    let alive = true;
    const h = setTimeout(async () => {
      setCounting(true);
      const r = await previewAudienceAction({ audience: c.audience });
      if (!alive) return;
      setCounting(false);
      if (r.ok) setPreview(r.data);
    }, 400);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [c.audience, step]);

  const firstEligible = preview?.sample.find((s) => !s.reason)?.id ?? null;
  useEffect(() => {
    if (step !== 3 || !tpl) return;
    void previewTemplateAction({ id: tpl.id, leadId: firstEligible }).then((r) => r.ok && setSample(r.data));
  }, [step, tpl, firstEligible]);

  const persist = async () => {
    const r = await saveCampaignAction({ id, campaign: { name: c.name.trim() || t("new"), objective: c.objective, templateId: c.templateId, audience: c.audience, variables: c.variables, scheduledAt: c.scheduledAt } });
    if (!r.ok) {
      toast(te((r.error ?? "validation") as "unexpected"), "error");
      return false;
    }
    setId(r.data.id);
    return r.data.id;
  };

  const next = () =>
    start(async () => {
      if (step === 0 && !c.name.trim()) return void toast(te("validation"), "error");
      if (step === 2 && !c.templateId) return void toast(te("whatsapp_campaign_template_missing"), "error");
      const ok = await persist();
      if (!ok) return;
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

  const submit = () =>
    start(async () => {
      const saved = await persist();
      if (!saved) return;
      const r = await submitCampaignAction({ id: saved, sendNow: !c.scheduledAt });
      if (!r.ok) return void toast(te((r.error ?? "unexpected") as "unexpected"), "error");
      setResult(r.data);
      setStep(6);
      router.refresh();
    });

  const aud = c.audience;
  const setAud = (patch: Partial<Audience>) => setC((x) => ({ ...x, audience: { ...x.audience, ...patch } }));

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="wa-wizard">
      <ol className="flex gap-1 overflow-x-auto [scrollbar-width:none]" aria-label={t("stepOf", { n: step + 1, total: STEPS.length })}>
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold", i === step ? "bg-ink text-ink-inverse" : i < step ? "bg-success-soft text-success" : "bg-sunken text-ink-3")}>
            {i < step ? <CheckCircle2 className="size-3.5" /> : <span>{i + 1}</span>} {t(`steps.${s}`)}
          </li>
        ))}
      </ol>

      <section className="rounded-[24px] border border-line bg-surface p-5 shadow-xs sm:p-7">
        <p className="mb-1 text-xs font-semibold text-ink-4">{t("stepOf", { n: step + 1, total: STEPS.length })}</p>
        <h2 className="mb-5 text-xl font-bold">{t(`steps.${STEPS[step]}`)}</h2>

        {step === 0 && (
          <div className="space-y-5">
            <label className="block text-sm font-semibold">
              {t("name")}
              <input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value.slice(0, 120) })} placeholder={t("namePlaceholder")} className="mt-1.5 h-11 w-full rounded-xl border border-line px-3" data-testid="wz-name" />
            </label>
            <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {OBJECTIVES.map((o) => (
                <button key={o} role="radio" aria-checked={c.objective === o} onClick={() => setC({ ...c, objective: o })} className={cn("rounded-2xl border p-3 text-start text-sm font-semibold transition", c.objective === o ? "border-[#1fa855] bg-[#e7f8ee] text-[#0e5f2f]" : "border-line hover:border-line-strong")}>
                  {t(`objectives.${o}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-3">{t("objectiveHint")}</p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <FilterPills label={t("filters.stages")} options={STAGES.map((s) => ({ value: s, label: tc(`cmd.stages.${s}` as "cmd.stages.NEW") }))} value={aud.stages ?? []} onChange={(v) => setAud({ stages: v as Audience["stages"] })} />
            <FilterPills label={t("filters.temperatures")} options={TEMPS.map((s) => ({ value: s, label: t(`filters.temp.${s}`) }))} value={aud.temperatures ?? []} onChange={(v) => setAud({ temperatures: v as Audience["temperatures"] })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Tags label={t("filters.tags")} value={aud.tags ?? []} onChange={(v) => setAud({ tags: v })} add={t("filters.addValue")} testId="wz-tags" />
              <Tags label={t("filters.interests")} value={aud.interests ?? []} onChange={(v) => setAud({ interests: v })} add={t("filters.addValue")} />
              <Tags label={t("filters.cities")} value={aud.cities ?? []} onChange={(v) => setAud({ cities: v })} add={t("filters.addValue")} />
              <Tags label={t("filters.countries")} value={aud.countries ?? []} onChange={(v) => setAud({ countries: v })} add={t("filters.addValue")} />
              <Tags label={t("filters.sources")} value={aud.sources ?? []} onChange={(v) => setAud({ sources: v })} add={t("filters.addValue")} />
              <Tags label={t("filters.purchaseCategories")} value={aud.purchaseCategories ?? []} onChange={(v) => setAud({ purchaseCategories: v })} add={t("filters.addValue")} />
              <label className="text-sm font-semibold">
                {t("filters.segment")}
                <select value={aud.segmentId ?? ""} onChange={(e) => setAud({ segmentId: e.target.value || null })} className="mt-1 h-10 w-full rounded-xl border border-line px-2 text-sm font-normal">
                  <option value="">{t("filters.anySegment")}</option>
                  {segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold">
                {t("filters.opportunity")}
                <select value={aud.opportunityStatus ?? ""} onChange={(e) => setAud({ opportunityStatus: (e.target.value || null) as Audience["opportunityStatus"] })} className="mt-1 h-10 w-full rounded-xl border border-line px-2 text-sm font-normal">
                  <option value="">{t("filters.any")}</option>
                  {["OPEN", "WON", "LOST"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <NumField label={t("filters.lastContactOlder")} value={aud.lastContactOlderThanDays ?? null} onChange={(v) => setAud({ lastContactOlderThanDays: v })} />
              <NumField label={t("filters.noPurchase")} value={aud.noPurchaseDays ?? null} onChange={(v) => setAud({ noPurchaseDays: v })} />
            </div>
            <AudienceBox preview={preview} counting={counting} />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2" role="radiogroup">
            {!templates.length && (
              <p className="rounded-2xl bg-warning-soft p-4 text-sm">
                {t("template.none")} <Link href="/whatsapp/templates" className="font-semibold underline">{t("steps.template")}</Link>
              </p>
            )}
            {templates.map((x) => (
              <button key={x.id} role="radio" aria-checked={c.templateId === x.id} onClick={() => setC({ ...c, templateId: x.id, variables: { ...x.variables } })} className={cn("block w-full rounded-2xl border p-4 text-start transition", c.templateId === x.id ? "border-[#1fa855] bg-[#e7f8ee]/60" : "border-line hover:border-line-strong")} data-testid={`wz-tpl-${x.name}`}>
                <span className="font-mono text-sm font-semibold" dir="ltr">{x.name}</span> <span className="text-xs text-ink-4">{x.language}</span>
                <span className="mt-2 block whitespace-pre-wrap text-sm text-ink-2" dir="auto">{x.body}</span>
              </button>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-ink-3">{t("personalize.hint")}</p>
            {!vars.length && <p className="text-sm">{t("personalize.noVars")}</p>}
            {vars.map((n) => {
              const cur = c.variables[String(n)] ?? "customer_name";
              const isStatic = cur.startsWith("static:");
              return (
                <div key={n} className="flex flex-wrap items-center gap-2">
                  <span className="w-24 text-sm text-ink-3">{tt("variableFor", { n })}</span>
                  <select value={isStatic ? "static" : cur} onChange={(e) => setC({ ...c, variables: { ...c.variables, [String(n)]: e.target.value === "static" ? "static:" : e.target.value } })} className="h-10 rounded-xl border border-line px-2 text-sm">
                    {SOURCES.map((s) => <option key={s} value={s}>{tt(`sources.${s}`)}</option>)}
                  </select>
                  {isStatic && <input value={cur.slice(7)} onChange={(e) => setC({ ...c, variables: { ...c.variables, [String(n)]: `static:${e.target.value}` } })} placeholder={tt("staticValue")} className="h-10 flex-1 rounded-xl border border-line px-3 text-sm" />}
                </div>
              );
            })}
            {sample && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-ink-3">{t("personalize.previewWith")}</p>
                <p className="whitespace-pre-wrap rounded-2xl bg-[#d9fdd3] p-3 text-sm text-[#0b2e13]" dir="auto" data-testid="wz-sample">{sample.text}</p>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3" role="radiogroup">
            <button role="radio" aria-checked={!c.scheduledAt} onClick={() => setC({ ...c, scheduledAt: null })} className={cn("block w-full rounded-2xl border p-4 text-start text-sm font-semibold", !c.scheduledAt ? "border-[#1fa855] bg-[#e7f8ee]/60" : "border-line")}>
              {t("schedule.now")}
            </button>
            <button role="radio" aria-checked={Boolean(c.scheduledAt)} onClick={() => setC({ ...c, scheduledAt: c.scheduledAt ?? new Date(Date.now() + 86_400_000).toISOString() })} className={cn("block w-full rounded-2xl border p-4 text-start text-sm font-semibold", c.scheduledAt ? "border-[#1fa855] bg-[#e7f8ee]/60" : "border-line")}>
              {t("schedule.later")}
            </button>
            {c.scheduledAt && (
              <label className="block text-sm font-semibold">
                {t("schedule.at")}
                <input type="datetime-local" value={toLocalInput(c.scheduledAt)} min={toLocalInput(new Date().toISOString())} onChange={(e) => e.target.value && setC({ ...c, scheduledAt: new Date(e.target.value).toISOString() })} className="mt-1 h-11 w-full rounded-xl border border-line px-3" dir="ltr" />
              </label>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Summary label={t("name")} value={c.name} />
              <Summary label={t("steps.objective")} value={t(`objectives.${c.objective}`)} />
              <Summary label={t("steps.template")} value={tpl ? `${tpl.name} · ${tpl.language}` : "—"} />
              <Summary label={t("steps.schedule")} value={c.scheduledAt ? new Date(c.scheduledAt).toLocaleString() : t("schedule.now")} />
            </dl>
            <AudienceBox preview={preview} counting={counting} />
            <p className="rounded-2xl bg-nova-blue-soft p-3 text-sm text-nova-blue">{t("review.note")}</p>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4 text-center" data-testid="wz-result">
            <CheckCircle2 className="mx-auto size-12 text-success" />
            <p className="text-lg font-bold">{result?.state === "NEEDS_APPROVAL" ? t("submitted") : t("approved")}</p>
            <div className="flex justify-center gap-2">
              {result?.state === "NEEDS_APPROVAL" && <Link href="/approvals" className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-ink-inverse">{t("openApprovals")}</Link>}
              {id && <Link href={`/whatsapp/campaigns/${id}`} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold">{t("title")}</Link>}
            </div>
          </div>
        )}
      </section>

      {step < 6 && (
        <div className="sticky bottom-3 z-10 flex items-center gap-2 rounded-2xl border border-line bg-surface/95 p-3 shadow-md backdrop-blur">
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ink-2 hover:bg-sunken">
              <ArrowLeft className="size-4 rtl:rotate-180" /> {tc("actions.back")}
            </button>
          )}
          <button onClick={() => start(async () => { if (await persist()) toast(t("saveDraft")); })} disabled={pending} className="ms-auto h-11 rounded-xl border border-line px-4 text-sm font-semibold">
            {t("saveDraft")}
          </button>
          {step < 5 ? (
            <button onClick={next} disabled={pending} className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-5 text-sm font-semibold text-ink-inverse" data-testid="wz-next">
              {pending && <Loader2 className="size-4 animate-spin" />} {tc("actions.continue")}
            </button>
          ) : (
            <button onClick={submit} disabled={pending || !connected || !preview?.eligible || !tpl} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#1fa855] px-5 text-sm font-semibold text-white disabled:opacity-50" data-testid="wz-submit">
              {pending && <Loader2 className="size-4 animate-spin" />} {t("submit")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold">{value}</dd>
    </div>
  );
}

function AudienceBox({ preview, counting }: { preview: AudiencePreview | null; counting: boolean }) {
  const t = useTranslations("whatsapp.campaigns.preview");
  const reasons = preview ? (Object.entries(preview.excluded) as [string, number][]).filter(([, n]) => n > 0) : [];
  return (
    <div className="rounded-2xl border border-line p-4" aria-live="polite" data-testid="wz-audience">
      <div className="grid grid-cols-3 gap-3 text-center">
        <Count label={t("targeted")} value={preview?.total} />
        <Count label={t("eligible")} value={preview?.eligible} tone="good" testId="wz-eligible" />
        <Count label={t("excluded")} value={preview?.excludedTotal} tone="warn" />
      </div>
      {counting && <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-ink-4"><Loader2 className="size-3 animate-spin" /> {t("counting")}</p>}
      {reasons.length > 0 && (
        <ul className="mt-3 flex flex-wrap justify-center gap-2 text-xs">
          {reasons.map(([k, n]) => (
            <li key={k} className="rounded-full bg-sunken px-2.5 py-1 text-ink-2">{t(`reasons.${k}` as "reasons.missing_phone")}: <strong dir="ltr">{n}</strong></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Count({ label, value, tone, testId }: { label: string; value: number | undefined; tone?: "good" | "warn"; testId?: string }) {
  return (
    <div>
      <p className={cn("text-2xl font-bold tabular-nums", tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : "text-ink")} data-testid={testId}>{value ?? "—"}</p>
      <p className="text-xs text-ink-3">{label}</p>
    </div>
  );
}

function FilterPills({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button key={o.value} role="checkbox" aria-checked={on} onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", on ? "border-[#1fa855] bg-[#e7f8ee] text-[#0e5f2f]" : "border-line text-ink-2")}>
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Tags({ label, value, onChange, add, testId }: { label: string; value: string[]; onChange: (v: string[]) => void; add: string; testId?: string }) {
  const [d, setD] = useState("");
  const push = () => {
    const v = d.trim();
    if (v && !value.includes(v) && value.length < 10) onChange([...value, v.slice(0, 80)]);
    setD("");
  };
  return (
    <div className="text-sm font-semibold">
      <span>{label}</span>
      <div className="mt-1 flex gap-1.5">
        <input value={d} onChange={(e) => setD(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); push(); } }} aria-label={label} className="h-10 min-w-0 flex-1 rounded-xl border border-line px-3 text-sm font-normal" data-testid={testId} />
        <button onClick={push} className="rounded-xl border border-line px-2.5" aria-label={add}><Plus className="size-4" /></button>
      </div>
      {value.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {value.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-xs font-medium">
              {v}
              <button onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`${v} ×`}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <input type="number" min={1} max={3650} value={value ?? ""} onChange={(e) => { const n = Number(e.target.value); onChange(e.target.value && Number.isInteger(n) && n >= 1 && n <= 3650 ? n : null); }} className="mt-1 h-10 w-full rounded-xl border border-line px-3 text-sm font-normal" dir="ltr" />
    </label>
  );
}
