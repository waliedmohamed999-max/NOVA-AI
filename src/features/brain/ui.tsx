"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Check, History, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { BRAIN_ENTITIES, type BrainEntityType, type FieldDef } from "@/lib/brain-fields";
import { deleteEntityAction, entityStatusAction, revisionsAction, saveEntityAction } from "./actions";

type Result = { ok: true; data?: unknown } | { ok: false; error: string };

/** Runs a server action with a toast and a refresh; one place for pending/error handling. */
export function useBrainAction() {
  const router = useRouter();
  const te = useTranslations("errors");
  const t = useTranslations("brain");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, ok = t("saved"), after?: (data: unknown) => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (ok) toast(ok);
        after?.(r.data);
        router.refresh();
      } else toast.error(te.has(r.error) ? te(r.error) : te("unexpected"));
    });
  return { pending, run };
}

const TONES: Record<string, Tone> = {
  approved: "success", ready: "success", complete: "success", healthy: "success", APPROVED: "success", IMPORTED: "success", active: "success",
  pending: "warning", needs_info: "warning", needs_review: "warning", REVIEW: "warning", suggested: "warning", stale: "warning", outdated: "warning", DRAFT: "info", draft: "info",
  rejected: "danger", failed: "danger", FAILED: "danger", empty: "neutral", weak: "danger", missing: "neutral", paused: "neutral", ARCHIVED: "neutral", retired: "neutral",
  PARSING: "info", EXTRACTING: "info", UPLOADED: "info", processing: "info",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const t = useTranslations("brain.status");
  return (
    <Badge tone={TONES[status] ?? "neutral"} className={className}>
      {t.has(status) ? t(status) : status}
    </Badge>
  );
}

export function SourceBadge({ kind }: { kind?: string | null }) {
  const t = useTranslations("brain.sourceKinds");
  if (!kind) return null;
  return <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-3">{t.has(kind) ? t(kind) : kind}</span>;
}

/** One control per field kind; lists are edited one item per line. */
export function FieldInput({ def, entity, value, onChange, disabled }: { def: FieldDef; entity: string; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const t = useTranslations("brain");
  const label = t.has(`fields.${entity}.${def.name}`) ? t(`fields.${entity}.${def.name}`) : t.has(`fields.common.${def.name}`) ? t(`fields.common.${def.name}`) : def.name;
  return (
    <Field label={label} hint={def.kind === "list" ? t("listHint") : undefined} className={def.kind === "textarea" || def.kind === "list" ? "sm:col-span-2" : undefined}>
      {(f) =>
        def.kind === "select" ? (
          <Select {...f} value={String(value ?? def.options?.[0] ?? "")} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
            {def.options?.map((o) => (
              <option key={o} value={o}>
                {t.has(`options.${o}`) ? t(`options.${o}`) : o}
              </option>
            ))}
          </Select>
        ) : def.kind === "list" ? (
          <Textarea {...f} rows={3} dir="auto" disabled={disabled} value={Array.isArray(value) ? value.join("\n") : ""} onChange={(e) => onChange(e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} />
        ) : def.kind === "textarea" ? (
          <Textarea {...f} rows={3} dir="auto" disabled={disabled} maxLength={def.max} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input {...f} dir="auto" disabled={disabled} maxLength={def.max} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        )
      }
    </Field>
  );
}

/** Single-record panel (profile, sales knowledge, content knowledge) with per-field provenance. */
export function RecordForm({
  entity,
  fields,
  values,
  canManage,
  save,
  provenance,
}: {
  entity: string;
  fields: FieldDef[];
  values: Record<string, unknown>;
  canManage: boolean;
  save: (changed: Record<string, unknown>) => Promise<Result>;
  provenance?: Record<string, { source?: string; at?: string } | undefined>;
}) {
  const t = useTranslations("brain");
  const format = useFormatter();
  const [v, setV] = useState(values);
  const { pending, run } = useBrainAction();
  const changed = Object.fromEntries(Object.entries(v).filter(([k, x]) => JSON.stringify(x ?? null) !== JSON.stringify(values[k] ?? null)));
  const dirty = Object.keys(changed).length > 0;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((def) => (
          <div key={def.name} className={cn(def.kind === "textarea" || def.kind === "list" ? "sm:col-span-2" : undefined, "space-y-1")}>
            <FieldInput def={def} entity={entity} value={v[def.name]} disabled={!canManage} onChange={(x) => setV({ ...v, [def.name]: x })} />
            {provenance?.[def.name]?.at && (
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-4">
                <span>{t("lastUpdated", { when: format.relativeTime(new Date(provenance[def.name]!.at!)) })}</span>
                <SourceBadge kind={provenance[def.name]!.source} />
              </p>
            )}
          </div>
        ))}
      </div>
      {canManage && (
        <div className="sticky bottom-3 flex justify-end">
          <Button disabled={!dirty} loading={pending} onClick={() => run(() => save(changed) as Promise<Result>)}>
            {t("save")}
          </Button>
        </div>
      )}
    </div>
  );
}

export type EntityRow = { id: string; values: Record<string, unknown>; status?: string | null; sourceKind?: string | null; badges?: string[]; extra?: ReactNode };

/** Generic list + editor for any Company Brain entity (definitions shared with the server). */
export function EntityList({ type, rows, canManage, canApprove, empty, headerExtra }: { type: BrainEntityType; rows: EntityRow[]; canManage: boolean; canApprove: boolean; empty: string; headerExtra?: ReactNode }) {
  const t = useTranslations("brain");
  const def = BRAIN_ENTITIES[type];
  const [editing, setEditing] = useState<EntityRow | "new" | null>(null);
  const { pending, run } = useBrainAction();
  const approvable = "approvable" in def && def.approvable;
  return (
    <div className="space-y-3" data-entity-list={type}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-3">{t("countItems", { count: rows.length })}</p>
        <div className="flex flex-wrap gap-2">
          {headerExtra}
          {canManage && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
              {t(`add.${type}`)}
            </Button>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <Card className="p-0">
          <EmptyState compact title={empty} />
        </Card>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="flex h-full flex-col gap-2 p-4" data-entity-row={r.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink" dir="auto">{String(r.values[def.title] ?? "—")}</p>
                    {def.subtitle && r.values[def.subtitle] ? <p className="mt-0.5 line-clamp-3 text-sm text-ink-3" dir="auto">{String(r.values[def.subtitle])}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {r.status && <StatusBadge status={r.status} />}
                    <SourceBadge kind={r.sourceKind} />
                  </div>
                </div>
                {r.badges?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {r.badges.map((b) => (
                      <span key={b} className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-3" dir="auto">{b}</span>
                    ))}
                  </div>
                ) : null}
                {r.extra}
                <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
                  {approvable && canApprove && r.status && r.status !== "approved" && (
                    <Button size="xs" variant="secondary" icon={<Check className="size-3.5" />} loading={pending} onClick={() => run(() => entityStatusAction({ type, id: r.id, status: "approved" }) as Promise<Result>, t("approvedToast"))}>
                      {t("approve")}
                    </Button>
                  )}
                  {approvable && canApprove && r.status && r.status !== "rejected" && r.status !== "approved" && (
                    <Button size="xs" variant="ghost" icon={<X className="size-3.5" />} onClick={() => run(() => entityStatusAction({ type, id: r.id, status: "rejected" }) as Promise<Result>)}>
                      {t("reject")}
                    </Button>
                  )}
                  {canManage && (
                    <Button size="xs" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(r)}>
                      {t("edit")}
                    </Button>
                  )}
                  <HistoryButton entityType={type} entityId={r.id} />
                  {canManage && (
                    <Button size="xs" variant="ghost" className="ms-auto text-ink-4" icon={<Trash2 className="size-3.5" />} aria-label={t("delete")} onClick={() => confirm(t("confirmDelete")) && run(() => deleteEntityAction({ type, id: r.id }) as Promise<Result>, t("deleted"))} />
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing !== null && <EntityEditor type={type} row={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

function EntityEditor({ type, row, onDone }: { type: BrainEntityType; row: EntityRow | null; onDone: () => void }) {
  const t = useTranslations("brain");
  const def = BRAIN_ENTITIES[type];
  const [v, setV] = useState<Record<string, unknown>>(() => Object.fromEntries(def.fields.map((f) => [f.name, row?.values[f.name] ?? (f.kind === "list" ? [] : f.kind === "select" ? f.options?.[0] : "")])));
  const { pending, run } = useBrainAction();
  const submit = () => {
    const data = Object.fromEntries(def.fields.map((f) => [f.name, f.kind === "list" ? (v[f.name] ?? []) : v[f.name] ?? ""]));
    run(() => saveEntityAction({ type, id: row?.id, data }) as Promise<Result>, t("saved"), onDone);
  };
  return (
    <DialogContent
      size="lg"
      title={row ? t(`edit_${type}`) : t(`add.${type}`)}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            {t("cancel")}
          </Button>
          <Button loading={pending} onClick={submit}>
            {t("save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {def.fields.map((f) => (
          <FieldInput key={f.name} def={f} entity={type} value={v[f.name]} onChange={(x) => setV({ ...v, [f.name]: x })} />
        ))}
      </div>
    </DialogContent>
  );
}

/** Version history: who, when, source, before → after. */
export function HistoryButton({ entityType, entityId }: { entityType: string; entityId: string }) {
  const t = useTranslations("brain");
  const format = useFormatter();
  const [rows, setRows] = useState<{ id: string; action: string; before: unknown; after: unknown; sourceKind: string; at: string; by: string | null }[] | null>(null);
  const [open, setOpen] = useState(false);
  const load = async () => {
    setOpen(true);
    const r = await revisionsAction({ entityType, entityId });
    setRows(r.ok ? r.data : []);
  };
  const show = (x: unknown) => (x && typeof x === "object" ? Object.entries(x as Record<string, unknown>).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v ?? "—")}`).join(" · ") : "—");
  return (
    <>
      <Button size="xs" variant="ghost" icon={<History className="size-3.5" />} onClick={load}>
        {t("history")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t("history")} size="lg">
          {!rows ? (
            <p className="text-sm text-ink-3">…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-ink-3">{t("noHistory")}</p>
          ) : (
            <ol className="space-y-3">
              {rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    <StatusBadge status={r.action} />
                    <span>{format.dateTime(new Date(r.at), { dateStyle: "medium", timeStyle: "short" })}</span>
                    {r.by && <span>· {r.by}</span>}
                    <SourceBadge kind={r.sourceKind} />
                  </div>
                  {r.before ? <p className="mt-1.5 text-ink-4 line-through" dir="auto">{show(r.before)}</p> : null}
                  {r.after ? <p className="mt-1 text-ink-2" dir="auto">{show(r.after)}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SectionCard({ title, description, children, action, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <Card className={cn("space-y-4 p-5 sm:p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-3">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}
