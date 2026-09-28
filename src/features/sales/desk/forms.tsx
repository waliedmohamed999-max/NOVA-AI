"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Check, FileSpreadsheet, Plus, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { guessMapping, IMPORT_FIELDS, parseCsv, type ImportField } from "@/server/sales/intelligence";
import type { ImportPreviewRow, ImportRow } from "@/server/sales/operations";
import { addCustomer, assistOpportunityAction, createOpportunityAction, createQuoteAction, importLeadsAction, previewImportAction, scheduleFollowUpAction } from "../desk-actions";
import { useDesk } from "./shared";

function useErr() {
  const te = useTranslations("errors");
  return (code?: string) => toast.error(te.has((code ?? "unexpected") as "unexpected") ? te((code ?? "unexpected") as "unexpected") : te("unexpected"));
}
const CHANNELS = ["MANUAL", "PHONE", "WHATSAPP", "EMAIL", "WEBSITE", "LINKEDIN", "INSTAGRAM_DM", "FACEBOOK_DM"] as const;

// ── + Add customer ──

export function AddCustomerDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const t = useTranslations("sales.addCustomer");
  const tf = useTranslations("sales.filters");
  const desk = useDesk();
  const fail = useErr();
  const [advanced, setAdvanced] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")}>
        <form
          className="space-y-4"
          data-testid="add-customer-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const s = (k: string) => String(f.get(k) ?? "").trim();
            const value = s("value") ? Number(s("value")) : undefined;
            start(async () => {
              const r = await addCustomer({
                name: s("name"),
                company: s("company") || undefined,
                phone: s("phone") || undefined,
                email: s("email"),
                channel: (s("channel") || "MANUAL") as (typeof CHANNELS)[number],
                interest: s("interest") || undefined,
                value: value != null && Number.isFinite(value) ? value : undefined,
                source: s("source") || undefined,
                ownerId: s("owner") || undefined,
                tags: s("tags") ? s("tags").split(",").map((x) => x.trim()).filter(Boolean) : undefined,
                notes: s("notes") || undefined,
              });
              if (r.ok) {
                toast(t("created"));
                onCreated(r.data.id);
              } else fail(r.error);
            });
          }}
        >
          <Field label={t("name")}>{(p) => <Input {...p} name="name" required autoFocus dir="auto" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("company")} optional={t("optional")}>{(p) => <Input {...p} name="company" dir="auto" />}</Field>
            <Field label={t("channel")}>{(p) => <Select {...p} name="channel" defaultValue="MANUAL">{CHANNELS.map((c) => <option key={c} value={c}>{tf(`channels.${c}`)}</option>)}</Select>}</Field>
            <Field label={t("phone")} optional={t("optional")}>{(p) => <Input {...p} name="phone" type="tel" dir="ltr" />}</Field>
            <Field label={t("email")} optional={t("optional")}>{(p) => <Input {...p} name="email" type="email" dir="ltr" />}</Field>
          </div>
          <Field label={t("interest")} optional={t("optional")}>{(p) => <Input {...p} name="interest" dir="auto" placeholder={t("interestPlaceholder")} />}</Field>
          <button type="button" className="text-sm font-medium text-accent-ink hover:underline" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>{advanced ? t("lessOptions") : t("moreOptions")}</button>
          {advanced && (
            <div className="grid gap-4 rounded-2xl bg-surface-2 p-4 sm:grid-cols-2">
              <Field label={t("value", { currency: desk.currency })} optional={t("optional")}>{(p) => <Input {...p} name="value" type="number" min={0} step="1" />}</Field>
              <Field label={t("source")} optional={t("optional")}>{(p) => <Input {...p} name="source" dir="auto" />}</Field>
              <Field label={t("owner")}>{(p) => <Select {...p} name="owner" defaultValue="">{[<option key="" value="">{t("ownerMe")}</option>, ...desk.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)]}</Select>}</Field>
              <Field label={t("tags")} optional={t("optional")} hint={t("tagsHint")}>{(p) => <Input {...p} name="tags" dir="auto" />}</Field>
              <div className="sm:col-span-2"><Field label={t("notes")} optional={t("optional")} hint={t("notesHint")}>{(p) => <Textarea {...p} name="notes" rows={3} dir="auto" />}</Field></div>
            </div>
          )}
          <p className="text-xs text-ink-4">{desk.aiReady ? t("aiQualifies") : t("aiOff")}</p>
          <Button type="submit" loading={pending} className="w-full">{t("save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── + B2B opportunity (5 steps) ──

type B2BState = { company: string; contactName: string; email: string; phone: string; decisionMaker: string; industry: string; need: string; title: string; value: string; expectedCloseAt: string; stage: string; nextStep: string; nextStepAt: string; ownerId: string; source: string; summary: string; questions: string[] };
const EMPTY_B2B: B2BState = { company: "", contactName: "", email: "", phone: "", decisionMaker: "", industry: "", need: "", title: "", value: "", expectedCloseAt: "", stage: "NEW", nextStep: "", nextStepAt: "", ownerId: "", source: "", summary: "", questions: [] };

export function B2BWizard({ open, leadId, onOpenChange, onCreated }: { open: boolean; leadId?: string; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const t = useTranslations("sales.b2b");
  const desk = useDesk();
  const fail = useErr();
  const steps = leadId ? (["need", "value", "stage"] as const) : (["company", "contact", "need", "value", "stage"] as const);
  const [step, setStep] = useState(0);
  const [s, setS] = useState<B2BState>(EMPTY_B2B);
  const [pending, start] = useTransition();
  const [missing, setMissing] = useState<string[]>([]);
  const set = (k: keyof B2BState) => (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value });
  const current = steps[step];
  const canNext = current === "company" ? s.company.trim().length > 0 : current === "contact" ? s.contactName.trim().length > 0 : current === "need" ? s.title.trim().length > 0 : true;
  const reset = () => {
    setStep(0);
    setS(EMPTY_B2B);
    setMissing([]);
  };

  const assist = () =>
    start(async () => {
      const r = await assistOpportunityAction({ company: s.company || undefined, contactName: s.contactName || undefined, industry: s.industry || undefined, need: s.need || undefined, value: s.value ? Number(s.value) : null, currency: desk.currency, stage: s.stage });
      if (r.ok) {
        setS({ ...s, summary: r.data.summary, nextStep: s.nextStep || r.data.nextAction, questions: r.data.qualificationQuestions });
        setMissing(r.data.missingInformation);
      } else fail(r.error);
    });

  const save = () =>
    start(async () => {
      const r = await createOpportunityAction({
        leadId,
        // An opportunity on an existing customer is a regular deal; the company flow creates a B2B one.
        kind: leadId ? "DEAL" : "B2B",
        company: s.company || undefined,
        contactName: s.contactName || undefined,
        email: s.email,
        phone: s.phone || undefined,
        decisionMaker: s.decisionMaker || undefined,
        industry: s.industry || undefined,
        need: s.need || undefined,
        title: s.title,
        value: s.value ? Number(s.value) : null,
        currency: desk.currency,
        expectedCloseAt: s.expectedCloseAt ? new Date(s.expectedCloseAt).toISOString() : undefined,
        stage: s.stage as "NEW",
        nextStep: s.nextStep || undefined,
        nextStepAt: s.nextStepAt ? new Date(s.nextStepAt).toISOString() : undefined,
        ownerId: s.ownerId || undefined,
        source: s.source || undefined,
        summary: s.summary || undefined,
        qualificationQuestions: s.questions.length ? s.questions : undefined,
      });
      if (r.ok) {
        toast(leadId ? t("createdDeal") : t("created"));
        reset();
        onCreated();
      } else fail(r.error);
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent title={leadId ? t("titleForLead") : t("title")} description={t("description")} size="lg">
        <ol className="mb-5 flex gap-1.5" aria-label={t("progress")}>
          {steps.map((k, i) => (
            <li key={k} className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-ink" : "bg-line")} aria-current={i === step ? "step" : undefined}>
              <span className="sr-only">{t(`steps.${k}`)}</span>
            </li>
          ))}
        </ol>
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-ink-4">{t("stepOf", { n: step + 1, total: steps.length })} · {t(`steps.${current}`)}</p>
        <div className="space-y-4" data-testid={`b2b-step-${current}`}>
          {current === "company" && (
            <>
              <Field label={t("company")}>{(p) => <Input {...p} value={s.company} onChange={set("company")} autoFocus dir="auto" />}</Field>
              <Field label={t("industry")} optional={t("optional")}>{(p) => <Input {...p} value={s.industry} onChange={set("industry")} dir="auto" />}</Field>
              <Field label={t("source")} optional={t("optional")}>{(p) => <Input {...p} value={s.source} onChange={set("source")} dir="auto" />}</Field>
            </>
          )}
          {current === "contact" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("contactName")}>{(p) => <Input {...p} value={s.contactName} onChange={set("contactName")} autoFocus dir="auto" />}</Field>
              <Field label={t("decisionMaker")} optional={t("optional")}>{(p) => <Input {...p} value={s.decisionMaker} onChange={set("decisionMaker")} dir="auto" />}</Field>
              <Field label={t("email")} optional={t("optional")}>{(p) => <Input {...p} type="email" value={s.email} onChange={set("email")} dir="ltr" />}</Field>
              <Field label={t("phone")} optional={t("optional")}>{(p) => <Input {...p} type="tel" value={s.phone} onChange={set("phone")} dir="ltr" />}</Field>
            </div>
          )}
          {current === "need" && (
            <>
              <Field label={t("opportunityTitle")}>{(p) => <Input {...p} value={s.title} onChange={set("title")} autoFocus dir="auto" placeholder={t("titlePlaceholder")} />}</Field>
              <Field label={t("need")} optional={t("optional")}>{(p) => <Textarea {...p} value={s.need} onChange={set("need")} rows={4} dir="auto" />}</Field>
            </>
          )}
          {current === "value" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("value", { currency: desk.currency })} optional={t("unknownOk")}>{(p) => <Input {...p} type="number" min={0} value={s.value} onChange={set("value")} />}</Field>
              <Field label={t("expectedClose")} optional={t("optional")}>{(p) => <Input {...p} type="date" value={s.expectedCloseAt} onChange={set("expectedCloseAt")} />}</Field>
              <p className="text-xs text-ink-4 sm:col-span-2">{t("valueNote")}</p>
            </div>
          )}
          {current === "stage" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("stage")}>{(p) => <Select {...p} value={s.stage} onChange={set("stage")}>{desk.stages.filter((x) => !["WON", "LOST"].includes(x.stage)).map((x) => <option key={x.stage} value={x.stage}>{x.label}</option>)}</Select>}</Field>
                <Field label={t("owner")}>{(p) => <Select {...p} value={s.ownerId} onChange={set("ownerId")}>{[<option key="" value="">{t("ownerMe")}</option>, ...desk.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)]}</Select>}</Field>
                <Field label={t("nextStep")} optional={t("optional")}>{(p) => <Input {...p} value={s.nextStep} onChange={set("nextStep")} dir="auto" />}</Field>
                <Field label={t("nextStepAt")} optional={t("optional")}>{(p) => <Input {...p} type="datetime-local" value={s.nextStepAt} onChange={set("nextStepAt")} />}</Field>
              </div>
              <div className="space-y-2 rounded-2xl border border-accent/25 bg-accent-soft/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-accent" /> {t("assistTitle")}</p>
                  <Button size="sm" variant="secondary" disabled={!desk.aiReady} loading={pending} onClick={assist}>{t("assist")}</Button>
                </div>
                {!desk.aiReady && <p className="text-xs text-ink-3">{t("aiOff")}</p>}
                {s.summary && <Field label={t("summary")}>{(p) => <Textarea {...p} value={s.summary} onChange={set("summary")} rows={2} dir="auto" />}</Field>}
                {s.questions.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-ink-3">{t("questions")}</p>
                    <ul className="list-disc space-y-0.5 ps-5 text-sm" dir="auto">{s.questions.map((q) => <li key={q}>{q}</li>)}</ul>
                  </div>
                )}
                {missing.length > 0 && <p className="text-xs text-warning" dir="auto">{t("missing")}: {missing.join(" · ")}</p>}
                <p className="text-[11px] text-ink-4">{t("assistNote")}</p>
              </div>
            </>
          )}
        </div>
        <div className="mt-6 flex items-center justify-between gap-2">
          <Button variant="ghost" disabled={step === 0} icon={<ArrowLeft className="size-4 flip-rtl" />} onClick={() => setStep((x) => x - 1)}>{t("back")}</Button>
          {step < steps.length - 1 ? (
            <Button disabled={!canNext} iconEnd={<ArrowRight className="size-4 flip-rtl" />} onClick={() => setStep((x) => x + 1)} data-testid="b2b-next">{t("next")}</Button>
          ) : (
            <Button loading={pending} disabled={!s.title.trim()} icon={<Check className="size-4" />} onClick={save} data-testid="b2b-save">{t("save")}</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Import customers: upload → mapping → preview (duplicates) → import ──

export function ImportWizard({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const t = useTranslations("sales.import");
  const fail = useErr();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Record<number, ImportField | null>>({});
  const [preview, setPreview] = useState<ImportPreviewRow[] | null>(null);
  const [pending, start] = useTransition();
  const reset = () => {
    setRows(null);
    setPreview(null);
    setMapping({});
    setFileName("");
  };
  const mapped = (): ImportRow[] =>
    (rows ?? []).slice(1).map((r) => {
      const o: Record<string, string> = {};
      for (const [i, f] of Object.entries(mapping)) if (f && r[Number(i)]) o[f] = r[Number(i)].slice(0, f === "notes" ? 2000 : 250);
      return o as ImportRow;
    });
  const counts = preview ? { ok: preview.filter((p) => p.status === "ok").length, dup: preview.filter((p) => p.status === "duplicate").length, bad: preview.filter((p) => p.status === "invalid").length } : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent title={t("title")} description={t("description")} size="xl">
        {!rows && (
          <label className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-line-strong bg-surface-2 px-6 py-10 text-center hover:border-ink" data-testid="import-drop">
            <FileSpreadsheet className="size-8 text-ink-3" />
            <span className="font-semibold">{t("choose")}</span>
            <span className="text-sm text-ink-3">{t("hint", { max: 1000 })}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 2_000_000) return fail("file_too_large");
                const parsed = parseCsv(await f.text());
                if (parsed.length < 2) return fail("validation");
                if (parsed.length > 1001) return toast.error(t("tooMany", { max: 1000 }));
                setFileName(f.name);
                setRows(parsed);
                setMapping(guessMapping(parsed[0]));
              }}
            />
          </label>
        )}

        {rows && !preview && (
          <div className="space-y-4">
            <p className="text-sm text-ink-3">{t("mappingHelp", { file: fileName, count: rows.length - 1 })}</p>
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-surface-2 text-xs text-ink-3"><tr><th className="px-3 py-2 text-start">{t("column")}</th><th className="px-3 py-2 text-start">{t("sample")}</th><th className="px-3 py-2 text-start">{t("field")}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {rows[0].map((h, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-medium" dir="auto">{h || `#${i + 1}`}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-ink-3" dir="auto">{rows[1]?.[i] ?? ""}</td>
                      <td className="px-3 py-2">
                        <Select aria-label={t("field")} value={mapping[i] ?? ""} onChange={(e) => setMapping({ ...mapping, [i]: (e.target.value || null) as ImportField | null })} className="h-9">
                          <option value="">{t("skip")}</option>
                          {IMPORT_FIELDS.map((f) => <option key={f} value={f}>{t(`fields.${f}`)}</option>)}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={reset}>{t("back")}</Button>
              <Button
                loading={pending}
                disabled={!Object.values(mapping).some((f) => f === "name" || f === "email" || f === "company")}
                onClick={() => start(async () => {
                  const r = await previewImportAction({ rows: mapped() });
                  if (r.ok) setPreview(r.data);
                  else fail(r.error);
                })}
                data-testid="import-preview"
              >
                {t("previewCta")}
              </Button>
            </div>
          </div>
        )}

        {preview && counts && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="success">{t("okCount", { count: counts.ok })}</Badge>
              <Badge tone="warning">{t("dupCount", { count: counts.dup })}</Badge>
              <Badge tone="danger">{t("badCount", { count: counts.bad })}</Badge>
            </div>
            <div className="max-h-80 overflow-auto rounded-2xl border border-line">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="sticky top-0 bg-surface-2 text-xs text-ink-3"><tr><th className="px-3 py-2 text-start">#</th><th className="px-3 py-2 text-start">{t("fields.name")}</th><th className="px-3 py-2 text-start">{t("fields.email")}</th><th className="px-3 py-2 text-start">{t("result")}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {preview.slice(0, 200).map((p) => (
                    <tr key={p.index} className={cn(p.status !== "ok" && "text-ink-3")}>
                      <td className="px-3 py-1.5 tabular">{p.index + 2}</td>
                      <td className="px-3 py-1.5" dir="auto">{p.row.name || p.row.company || "—"}</td>
                      <td className="px-3 py-1.5" dir="ltr">{p.row.email || p.row.phone || "—"}</td>
                      <td className="px-3 py-1.5">{p.status === "ok" ? t("willImport") : t(`reasons.${p.reason ?? "exists"}` as "reasons.exists")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-4">{t("dupNote")}</p>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setPreview(null)}>{t("back")}</Button>
              <Button
                loading={pending}
                disabled={!counts.ok}
                onClick={() => start(async () => {
                  const r = await importLeadsAction({ rows: mapped() });
                  if (r.ok) {
                    toast(t("done", { created: r.data.created, skipped: r.data.skipped }));
                    reset();
                    onDone();
                  } else fail(r.error);
                })}
                data-testid="import-confirm"
              >
                {t("importCta", { count: counts.ok })}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Quote ──

export function QuoteDialog({ target, onClose, onCreated }: { target: { leadId: string; opportunityId?: string } | null; onClose: () => void; onCreated: () => void }) {
  const t = useTranslations("sales.quotes");
  const desk = useDesk();
  const fail = useErr();
  const [items, setItems] = useState([{ description: "", quantity: "1", unitPrice: "" }]);
  const [title, setTitle] = useState("");
  const [discount, setDiscount] = useState("");
  const [tax, setTax] = useState("");
  const [terms, setTerms] = useState("");
  const [validDays, setValidDays] = useState("14");
  const [pending, start] = useTransition();
  const subtotal = items.reduce((a, i) => a + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const disc = Math.min(subtotal, Number(discount) || 0);
  const total = subtotal - disc + ((subtotal - disc) * (Number(tax) || 0)) / 100;
  const needsApproval = disc > 0 || terms.trim().length > 0;
  const fmt = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: desk.currency, maximumFractionDigits: 2 }).format(n);
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t("new")} description={t("newDescription")} size="lg">
        <div className="space-y-4" data-testid="quote-form">
          <Field label={t("titleField")}>{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" />}</Field>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("items")}</p>
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_72px_110px_32px] gap-2">
                <Input aria-label={t("itemDescription")} placeholder={t("itemDescription")} value={it.description} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} dir="auto" />
                <Input aria-label={t("quantity")} type="number" min={1} value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                <Input aria-label={t("unitPrice")} placeholder={t("unitPrice")} type="number" min={0} value={it.unitPrice} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} />
                <button type="button" aria-label={t("removeItem")} disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-ink-4 hover:text-danger disabled:opacity-30"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setItems([...items, { description: "", quantity: "1", unitPrice: "" }])}>{t("addItem")}</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("discount", { currency: desk.currency })} optional={t("optional")}>{(p) => <Input {...p} type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} />}</Field>
            <Field label={t("tax")} optional={t("optional")}>{(p) => <Input {...p} type="number" min={0} max={100} value={tax} onChange={(e) => setTax(e.target.value)} />}</Field>
            <Field label={t("validDays")}>{(p) => <Input {...p} type="number" min={1} max={365} value={validDays} onChange={(e) => setValidDays(e.target.value)} />}</Field>
          </div>
          <Field label={t("terms")} optional={t("optional")}>{(p) => <Textarea {...p} rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} dir="auto" />}</Field>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-4 py-3">
            <span className="text-sm text-ink-3">{t("total")}</span>
            <span className="text-lg font-semibold tabular">{fmt(total)}</span>
          </div>
          {needsApproval && <p className="rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning">{t("approvalNote")}</p>}
          <Button
            className="w-full"
            loading={pending}
            disabled={!title.trim() || !items.every((i) => i.description.trim() && Number(i.quantity) > 0 && i.unitPrice !== "")}
            onClick={() => target && start(async () => {
              const r = await createQuoteAction({
                leadId: target.leadId,
                opportunityId: target.opportunityId,
                title: title.trim(),
                items: items.map((i) => ({ description: i.description.trim(), quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) })),
                discount: Number(discount) || 0,
                taxPercent: Number(tax) || 0,
                currency: desk.currency,
                terms: terms.trim() || undefined,
                validDays: Number(validDays) || 14,
              });
              if (r.ok) {
                toast(r.data.status === "NEEDS_APPROVAL" ? t("createdNeedsApproval", { number: r.data.number }) : t("created", { number: r.data.number }));
                onCreated();
              } else fail(r.error);
            })}
            data-testid="quote-save"
          >
            {t("save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Follow-up ──

export function FollowUpDialog({ leadId, onClose, onCreated }: { leadId: string | null; onClose: () => void; onCreated: () => void }) {
  const t = useTranslations("sales.followups");
  const tf = useTranslations("sales.filters");
  const fail = useErr();
  const [pending, start] = useTransition();
  return (
    <Dialog open={Boolean(leadId)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t("new")} size="sm">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const when = String(f.get("when"));
            start(async () => {
              const r = await scheduleFollowUpAction({ leadId: leadId!, title: String(f.get("title")).trim(), dueAt: new Date(when).toISOString(), channel: (String(f.get("channel")) || undefined) as "EMAIL" | undefined });
              if (r.ok) {
                toast(t("created"));
                onCreated();
              } else fail(r.error);
            });
          }}
        >
          <Field label={t("reason")}>{(p) => <Input {...p} name="title" required dir="auto" />}</Field>
          <Field label={t("when")}>{(p) => <Input {...p} name="when" type="datetime-local" required />}</Field>
          <Field label={t("channel")}>{(p) => <Select {...p} name="channel" defaultValue="">{[<option key="" value="">—</option>, ...(["EMAIL", "WHATSAPP", "PHONE", "LINKEDIN"] as const).map((c) => <option key={c} value={c}>{tf(`channels.${c}`)}</option>)]}</Select>}</Field>
          <Button type="submit" loading={pending} className="w-full">{t("save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
