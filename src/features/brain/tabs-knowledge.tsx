"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

import { Input, Select, Textarea } from "@/components/ui/input";
import { CONTENT_FIELDS, PROFILE_FIELDS, SALES_FIELDS } from "@/lib/brain-fields";
import { addFactAction, decideFactAction, saveContentAction, saveProfileAction, saveSalesAction } from "./actions";
import { EntityList, HistoryButton, RecordForm, SectionCard, SourceBadge, StatusBadge, useBrainAction, type EntityRow } from "./ui";

type Result = { ok: true; data?: unknown } | { ok: false; error: string };
export type FactRow = { id: string; key: string; value: string; category: string; sourceKind: string; status: string; critical: boolean; confidence: number };

export function ProfileTab({ values, provenance, facts, canManage, canApprove }: { values: Record<string, unknown>; provenance: Record<string, { source?: string; at?: string }>; facts: FactRow[]; canManage: boolean; canApprove: boolean }) {
  const t = useTranslations("brain");
  return (
    <>
      <SectionCard title={t("tabs.profile")} description={t("profile.description")}>
        <RecordForm entity="profile" fields={PROFILE_FIELDS} values={values} provenance={provenance} canManage={canManage} save={(d) => saveProfileAction(d) as Promise<Result>} />
      </SectionCard>
      <FactsPanel facts={facts} canManage={canManage} canApprove={canApprove} />
    </>
  );
}

const FACT_CATEGORIES = ["general", "pricing", "discount", "policy", "legal", "positioning", "proof", "catalog", "strategy", "customer_language"] as const;

/** Structured facts (key → value) with source, confidence and approval. Critical ones wait for a manager. */
export function FactsPanel({ facts, canManage, canApprove, title }: { facts: FactRow[]; canManage: boolean; canApprove: boolean; title?: string }) {
  const t = useTranslations("brain");
  const { pending, run } = useBrainAction();
  const [draft, setDraft] = useState({ key: "", value: "", category: "general" });
  const [editing, setEditing] = useState<Record<string, string>>({});
  const sorted = [...facts].sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0));
  return (
    <SectionCard title={title ?? t("facts.title")} description={t("facts.description")}>
      {canManage && (
        <div className="grid gap-2 rounded-xl bg-sunken p-3 sm:grid-cols-[1fr_1.5fr_150px_auto]">
          <Input aria-label={t("facts.key")} placeholder={t("facts.keyPlaceholder")} value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} dir="ltr" />
          <Input aria-label={t("facts.value")} placeholder={t("facts.value")} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} dir="auto" />
          <Select aria-label={t("facts.category")} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            {FACT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`factCategories.${c}`)}
              </option>
            ))}
          </Select>
          <Button icon={<Plus className="size-4" />} loading={pending} disabled={draft.key.trim().length < 2 || !draft.value.trim()} onClick={() => run(() => addFactAction(draft) as Promise<Result>, t("saved"), () => setDraft({ key: "", value: "", category: "general" }))}>
            {t("facts.add")}
          </Button>
        </div>
      )}
      {sorted.length === 0 ? (
        <p className="text-sm text-ink-3">{t("facts.empty")}</p>
      ) : (
        <ul className="divide-y divide-line" data-facts>
          {sorted.map((f) => (
            <li key={f.id} className="flex flex-wrap items-start gap-3 py-3" data-fact={f.key} data-status={f.status}>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-ink-4" dir="ltr">{f.key}</p>
                {editing[f.id] !== undefined ? (
                  <Textarea rows={2} value={editing[f.id]} onChange={(e) => setEditing({ ...editing, [f.id]: e.target.value })} dir="auto" className="mt-1" />
                ) : (
                  <p className="mt-0.5 text-sm text-ink" dir="auto">{f.value}</p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-3">{t(`factCategories.${f.category}`)}</span>
                  <SourceBadge kind={f.sourceKind} />
                  {f.critical && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] text-danger">{t("facts.critical")}</span>}
                  {f.confidence < 1 && <span className="text-[11px] text-ink-4">{t("facts.confidence", { value: Math.round(f.confidence * 100) })}</span>}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                <StatusBadge status={f.status} />
                {canApprove && f.status !== "approved" && (
                  <Button size="xs" variant="secondary" icon={<Check className="size-3.5" />} onClick={() => run(() => decideFactAction({ id: f.id, decision: "approved", value: editing[f.id] }) as Promise<Result>, t("approvedToast"), () => setEditing({}))}>
                    {t("approve")}
                  </Button>
                )}
                {canApprove && f.status === "pending" && (
                  <>
                    <Button size="xs" variant="ghost" onClick={() => setEditing({ ...editing, [f.id]: f.value })}>
                      {t("edit")}
                    </Button>
                    <Button size="xs" variant="ghost" icon={<X className="size-3.5" />} onClick={() => run(() => decideFactAction({ id: f.id, decision: "rejected" }) as Promise<Result>)}>
                      {t("reject")}
                    </Button>
                  </>
                )}
                <HistoryButton entityType="fact" entityId={f.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function ProductsTab({ rows, canManage }: { rows: EntityRow[]; canManage: boolean }) {
  const t = useTranslations("brain");
  return (
    <SectionCard title={t("tabs.products")} description={t("products.description")}>
      <EntityList type="offering" rows={rows} canManage={canManage} canApprove={false} empty={t("products.empty")} />
    </SectionCard>
  );
}

export function SalesTab({ values, objections, stages, canManage, canApprove }: { values: Record<string, unknown>; objections: EntityRow[]; stages: { label: string; probability: number }[]; canManage: boolean; canApprove: boolean }) {
  const t = useTranslations("brain");
  return (
    <>
      <SectionCard title={t("sales.playbookTitle")} description={t("sales.description")}>
        <RecordForm entity="sales" fields={SALES_FIELDS} values={values} canManage={canManage} save={(d) => saveSalesAction(d) as Promise<Result>} />
      </SectionCard>
      <SectionCard title={t("sales.objectionsTitle")} description={t("sales.objectionsDescription")}>
        <EntityList type="objection" rows={objections} canManage={canManage} canApprove={canApprove} empty={t("sales.objectionsEmpty")} />
      </SectionCard>
      <SectionCard title={t("sales.stagesTitle")} description={t("sales.stagesDescription")} action={<Link href="/sales?view=pipeline" className="text-sm font-medium text-accent hover:underline">{t("sales.openPipeline")}</Link>}>
        <ol className="flex flex-wrap gap-2">
          {stages.map((s) => (
            <li key={s.label} className="rounded-full bg-sunken px-3 py-1 text-sm text-ink-2">
              {s.label} <span className="text-ink-4">· {s.probability}%</span>
            </li>
          ))}
        </ol>
      </SectionCard>
    </>
  );
}

export function ContentTab({ values, competitorThemes, canManage }: { values: Record<string, unknown>; competitorThemes: string[]; canManage: boolean }) {
  const t = useTranslations("brain");
  return (
    <>
      <SectionCard title={t("tabs.content")} description={t("content.description")} action={<Link href="/brand" className="text-sm font-medium text-accent hover:underline">{t("content.openBrandKit")}</Link>}>
        <RecordForm entity="content" fields={CONTENT_FIELDS} values={values} canManage={canManage} save={(d) => saveContentAction(d) as Promise<Result>} />
      </SectionCard>
      <SectionCard title={t("content.competitorTopics")} description={t("content.competitorTopicsHint")}>
        {competitorThemes.length ? (
          <ul className="flex flex-wrap gap-2">
            {competitorThemes.map((x) => (
              <li key={x} className="rounded-full bg-sunken px-3 py-1 text-sm text-ink-2" dir="auto">
                {x}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">{t("content.noCompetitorTopics")}</p>
        )}
      </SectionCard>
    </>
  );
}

export function FaqTab({ rows, canManage, canApprove }: { rows: EntityRow[]; canManage: boolean; canApprove: boolean }) {
  const t = useTranslations("brain");
  const pending = rows.filter((r) => r.status === "pending").length;
  return (
    <SectionCard title={t("tabs.faq")} description={t("faq.description")} action={<Link href="/knowledge?tab=imports" className="text-sm font-medium text-accent hover:underline">{t("faq.import")}</Link>}>
      {pending > 0 && <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">{t("faq.pendingNote", { count: pending })}</p>}
      <EntityList type="faq" rows={rows} canManage={canManage} canApprove={canApprove} empty={t("faq.empty")} />
    </SectionCard>
  );
}

