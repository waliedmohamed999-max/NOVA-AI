"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { FileSpreadsheet, FileText, Globe, ShoppingBag, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Dialog, DialogContent, SheetContent } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/controls";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { IMPORT_FIELDS, type ImportField } from "@/server/sales/intelligence";
import { applyImportAction, importFileAction, importStatusAction, importUrlAction, previewCustomersAction } from "./actions";
import { SectionCard, StatusBadge } from "./ui";

export type ImportRowView = { id: string; kind: string; status: string; title: string; error: string | null; createdAt: string };
type Candidate = { id: string; type: string; data: Record<string, unknown>; critical: boolean; origin: string; selected: boolean; evidence?: string };
type ImportView = { id: string; kind: string; status: string; title: string; error: string | null; preview: Record<string, unknown>; candidates: Candidate[]; mapping: Record<string, ImportField | null> | null; stats: Record<string, unknown> };

const CARDS: { key: "website" | "store" | "sheet" | "document"; icon: LucideIcon; accept?: string }[] = [
  { key: "website", icon: Globe },
  { key: "store", icon: ShoppingBag },
  { key: "sheet", icon: FileSpreadsheet, accept: ".csv,.xlsx" },
  { key: "document", icon: FileText, accept: ".pdf,.docx,.txt,.md" },
];

export function ImportsTab({ rows, canManage, openId }: { rows: ImportRowView[]; canManage: boolean; openId?: string | null }) {
  const t = useTranslations("brain");
  const te = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [urlKind, setUrlKind] = useState<"website" | "store" | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<string | null>(openId ?? null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [accept, setAccept] = useState("");

  const err = (code: string) => toast.error(te.has(code) ? te(code) : te("unexpected"));
  const startUrl = async () => {
    if (!urlKind) return;
    setBusy(true);
    const r = await importUrlAction({ kind: urlKind, url });
    setBusy(false);
    if (!r.ok) return err(r.error);
    setUrlKind(null);
    setUrl("");
    setReview(r.data.id);
    router.refresh();
  };
  const upload = async (file: File) => {
    setBusy(true);
    const body = new FormData();
    body.append("file", file);
    body.append("purpose", "brain_import");
    const res = await fetch("/api/uploads", { method: "POST", body });
    const json = await res.json().catch(() => ({ error: "unexpected" }));
    if (!res.ok) {
      setBusy(false);
      return err(json.error ?? "unexpected");
    }
    const r = await importFileAction({ fileId: json.id });
    setBusy(false);
    if (!r.ok) return err(r.error);
    setReview(r.data.id);
    router.refresh();
  };

  return (
    <>
      {canManage && (
        <SectionCard title={t("imports.title")} description={t("imports.description")}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-import-cards>
            {CARDS.map((c) => (
              <button
                key={c.key}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (c.key === "website" || c.key === "store") setUrlKind(c.key);
                  else {
                    setAccept(c.accept!);
                    setTimeout(() => fileRef.current?.click(), 0);
                  }
                }}
                className="flex flex-col items-start gap-2 rounded-2xl border border-line bg-surface p-4 text-start transition hover:border-accent/40 hover:shadow-sm disabled:opacity-60"
                data-import-card={c.key}
              >
                <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <c.icon className="size-5" aria-hidden />
                </span>
                <span className="font-semibold text-ink">{t(`imports.cards.${c.key}`)}</span>
                <span className="text-xs text-ink-3">{t(`imports.cardsHint.${c.key}`)}</span>
              </button>
            ))}
          </div>
          <input ref={fileRef} type="file" hidden accept={accept} data-import-file onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          {busy && (
            <p className="flex items-center gap-2 text-sm text-ink-3">
              <Spinner className="size-4" /> {t("imports.uploading")}
            </p>
          )}
        </SectionCard>
      )}

      <SectionCard title={t("imports.jobsTitle")}>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-3">{t("imports.noJobs")}</p>
        ) : (
          <ul className="divide-y divide-line" data-import-jobs>
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3" data-import={r.id} data-status={r.status}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink" dir="auto">{r.title}</p>
                  <p className="text-xs text-ink-3">
                    {t(`imports.kinds.${r.kind}`)} · {format.relativeTime(new Date(r.createdAt))}
                    {r.error && <span className="text-danger"> · {te.has(r.error) ? te(r.error) : r.error}</span>}
                  </p>
                </div>
                <StatusBadge status={r.status} />
                {r.status === "REVIEW" && canManage && (
                  <Button size="xs" onClick={() => setReview(r.id)}>
                    {t("imports.review")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Dialog open={urlKind !== null} onOpenChange={(o) => !o && setUrlKind(null)}>
        <DialogContent
          title={urlKind ? t(`imports.cards.${urlKind}`) : ""}
          description={urlKind === "store" ? t("imports.storeNote") : t("imports.websiteNote")}
          footer={
            <Button loading={busy} disabled={url.trim().length < 4} onClick={startUrl}>
              {t("imports.start")}
            </Button>
          }
        >
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" dir="ltr" aria-label={t("imports.url")} autoFocus />
        </DialogContent>
      </Dialog>

      <Dialog open={review !== null} onOpenChange={(o) => !o && setReview(null)}>
        {review && <ReviewSheet id={review} onDone={() => setReview(null)} />}
      </Dialog>
    </>
  );
}

/** Review before anything enters the brain. Full-screen sheet on mobile. */
function ReviewSheet({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useTranslations("brain");
  const te = useTranslations("errors");
  const tf = useTranslations("sales.import.fields");
  const router = useRouter();
  const [imp, setImp] = useState<ImportView | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mapping, setMapping] = useState<Record<string, ImportField | null>>({});
  const [preview, setPreview] = useState<{ total: number; ok: number; duplicates: number; invalid: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await importStatusAction({ id });
      if (!alive) return;
      if (r.ok) {
        const v = r.data as unknown as ImportView;
        setImp(v);
        if (v.status === "REVIEW") {
          setSelected(new Set(v.candidates.filter((c) => c.selected).map((c) => c.id)));
          setMapping(v.mapping ?? {});
          return;
        }
        if (v.status === "FAILED" || v.status === "IMPORTED") return;
      }
      timer = setTimeout(tick, 1200);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);

  const apply = async (payload: Parameters<typeof applyImportAction>[0]) => {
    setBusy(true);
    const r = await applyImportAction(payload);
    setBusy(false);
    if (!r.ok) return toast.error(te.has(r.error) ? te(r.error) : te("unexpected"));
    toast(t("imports.done"));
    router.refresh();
    onDone();
  };

  const isSheet = imp?.kind === "csv" || imp?.kind === "excel";
  const groups = imp ? [...new Set(imp.candidates.map((c) => c.type))] : [];
  const headers = ((imp?.preview.headers as string[]) ?? []) as string[];
  const sample = ((imp?.preview.sample as string[][]) ?? []) as string[][];

  return (
    <SheetContent
      title={imp?.title ?? t("imports.review")}
      description={imp ? t(`imports.kinds.${imp.kind}`) : undefined}
      footer={
        imp?.status === "REVIEW" ? (
          isSheet ? (
            <>
              <Button variant="secondary" loading={busy} onClick={async () => {
                setBusy(true);
                const r = await previewCustomersAction({ id, mapping });
                setBusy(false);
                if (r.ok) setPreview(r.data);
                else toast.error(te.has(r.error) ? te(r.error) : te("unexpected"));
              }}>
                {t("imports.previewButton")}
              </Button>
              <Button loading={busy} disabled={!preview || preview.ok === 0} onClick={() => apply({ id, mapping })}>
                {t("imports.importCustomers", { count: preview?.ok ?? 0 })}
              </Button>
            </>
          ) : (
            <Button loading={busy} disabled={selected.size === 0} onClick={() => apply({ id, selectedIds: [...selected] })}>
              {t("imports.addToBrain", { count: selected.size })}
            </Button>
          )
        ) : undefined
      }
    >
      <div className="space-y-4" data-import-review={imp?.status ?? "loading"}>
        {!imp || ["UPLOADED", "PARSING", "EXTRACTING"].includes(imp.status) ? (
          <p className="flex items-center gap-2 text-sm text-ink-3">
            <Spinner className="size-4" /> {imp ? t(`status.${imp.status}`) : "…"}
          </p>
        ) : imp.status === "FAILED" ? (
          <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" data-import-error={imp.error ?? "unexpected"}>
            {te.has(imp.error ?? "") ? te(imp.error!) : te("unexpected")}
          </p>
        ) : imp.status === "IMPORTED" ? (
          <p className="rounded-xl bg-success-soft px-3 py-2 text-sm text-success">{t("imports.done")}</p>
        ) : isSheet ? (
          <>
            <p className="text-sm text-ink-3">{t("imports.mapHelp", { count: Number(imp.preview.rowCount ?? 0) })}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm" data-mapping>
                <thead className="text-xs text-ink-4">
                  <tr>
                    <th className="px-2 py-1.5 text-start">{t("imports.column")}</th>
                    <th className="px-2 py-1.5 text-start">{t("imports.sample")}</th>
                    <th className="px-2 py-1.5 text-start">{t("imports.field")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {headers.map((h, i) => (
                    <tr key={i}>
                      <td className="px-2 py-2 font-medium" dir="auto">{h}</td>
                      <td className="px-2 py-2 text-ink-3" dir="auto">{sample[0]?.[i] ?? ""}</td>
                      <td className="px-2 py-2">
                        <Select aria-label={`${t("imports.field")}: ${h}`} value={mapping[i] ?? ""} onChange={(e) => { setMapping({ ...mapping, [i]: (e.target.value || null) as ImportField | null }); setPreview(null); }} className="h-9">
                          <option value="">{t("imports.skip")}</option>
                          {IMPORT_FIELDS.map((f) => (
                            <option key={f} value={f}>{tf(f)}</option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-4">{t("imports.duplicateRules")}</p>
            {preview && (
              <div className="grid grid-cols-3 gap-2 text-center" data-customer-preview>
                {(["ok", "duplicates", "invalid"] as const).map((k) => (
                  <div key={k} className="rounded-xl bg-sunken px-2 py-2">
                    <p className="text-lg font-semibold tabular-nums">{preview[k]}</p>
                    <p className="text-xs text-ink-3">{t(`imports.previewStats.${k}`)}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-ink-4">{t("imports.piiNote")}</p>
          </>
        ) : (
          <>
            {imp.kind === "store" && Boolean(imp.preview.customersRequireIntegration) && <p className="rounded-xl bg-sunken px-3 py-2 text-xs text-ink-3">{t("imports.storeCustomers")}</p>}
            {typeof imp.preview.excerpt === "string" && (
              <details className="rounded-xl border border-line p-3 text-sm">
                <summary className="cursor-pointer text-ink-2">{t("imports.extractedText")}</summary>
                <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-ink-3" dir="auto">{String(imp.preview.excerpt)}</p>
              </details>
            )}
            <div data-found>
              <p className="text-sm font-semibold text-ink">{t("imports.found")}</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {groups.map((g) => (
                  <li key={g} className="rounded-full bg-sunken px-3 py-1 text-sm">{t("imports.foundItem", { count: imp.candidates.filter((c) => c.type === g).length, type: t(`candidateTypes.${g}`) })}</li>
                ))}
              </ul>
              {groups.length === 0 && <p className="text-sm text-ink-3">{t("imports.nothingFound")}</p>}
            </div>
            {groups.map((g) => (
              <Card key={g} className="space-y-2 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-4">{t(`candidateTypes.${g}`)}</p>
                <ul className="space-y-1.5">
                  {imp.candidates
                    .filter((c) => c.type === g)
                    .map((c) => (
                      <li key={c.id} className="flex items-start gap-2" data-candidate={c.type}>
                        <Checkbox
                          checked={selected.has(c.id)}
                          onChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(c.id); else n.delete(c.id); return n; })}
                          label={String(c.data.name ?? c.data.question ?? c.data.objection ?? c.data.key ?? c.data.value ?? c.data.description ?? "—").slice(0, 140)}
                        />
                        <span className="ms-auto flex shrink-0 gap-1">
                          {c.critical && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] text-danger">{t("facts.critical")}</span>}
                          {c.origin === "ai" && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent">{t("imports.aiExtracted")}</span>}
                        </span>
                      </li>
                    ))}
                </ul>
              </Card>
            ))}
            <p className="text-xs text-ink-4">{t("imports.criticalNote")}</p>
          </>
        )}
      </div>
    </SheetContent>
  );
}
