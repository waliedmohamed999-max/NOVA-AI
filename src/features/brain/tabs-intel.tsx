"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Globe, Pause, Play, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { STRATEGY_TYPES } from "@/lib/brain-fields";
import {
  analyzeCompetitorsAction,
  answerQuestionAction,
  competitorUrlAction,
  draftStrategyAction,
  segmentCriteriaAction,
  sourcePauseAction,
  sourceRefreshAction,
  strategyStatusAction,
  suggestSegmentsAction,
} from "./actions";
import { removeSource } from "@/features/knowledge/actions";
import { EntityList, SectionCard, StatusBadge, useBrainAction, type EntityRow } from "./ui";

type Result = { ok: true; data?: unknown } | { ok: false; error: string };

// ── Customers ──

export type CustomerStats = {
  total: number;
  withOrders: number;
  repeat: number | null;
  avgSpend: string | null;
  topCities: { key: string; count: number }[];
  topCategories: { key: string; count: number }[];
  b2b: number;
  coverage: { city: number; spend: number; orders: number; category: number };
};
export type Insight = { kind: string; values: Record<string, string | number> };

export function CustomersTab({ stats, insights, segments, icps, canManage, canApprove }: { stats: CustomerStats; insights: Insight[]; segments: (EntityRow & { criteria: Record<string, unknown>; size: number | null })[]; icps: EntityRow[]; canManage: boolean; canApprove: boolean }) {
  const t = useTranslations("brain");
  const { pending, run } = useBrainAction();
  return (
    <>
      <SectionCard
        title={t("customers.overviewTitle")}
        description={t("customers.overviewDescription")}
        action={canManage && <Link href="/knowledge?tab=imports" className={buttonClass("secondary", "sm")}>{t("customers.import")}</Link>}
      >
        {stats.total === 0 ? (
          <p className="text-sm text-ink-3">{t("customers.noData")}</p>
        ) : (
          <div className="space-y-4" data-customer-overview>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["total", stats.total],
                ["repeat", stats.repeat ?? t("customers.notEnoughData")],
                ["avgSpend", stats.avgSpend ?? t("customers.notEnoughData")],
                ["b2b", stats.b2b],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-xl bg-sunken px-3 py-2.5">
                  <dt className="text-xs text-ink-3">{t(`customers.stats.${k}`)}</dt>
                  <dd className="mt-0.5 text-base font-semibold text-ink tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["topCities", "topCategories"] as const).map((k) => (
                <div key={k}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-4">{t(`customers.${k}`)}</p>
                  {stats[k].length ? (
                    <ul className="space-y-1">
                      {stats[k].map((x) => (
                        <li key={x.key} className="flex justify-between text-sm" dir="auto">
                          <span>{x.key}</span>
                          <span className="tabular-nums text-ink-3">{x.count}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-4">{t("customers.notEnoughData")}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-4">{t("customers.coverage", stats.coverage)}</p>
          </div>
        )}
      </SectionCard>

      <SectionCard title={t("customers.insightsTitle")} description={t("customers.insightsDescription")}>
        {insights.length === 0 ? (
          <p className="text-sm text-ink-3">{t("customers.noInsights")}</p>
        ) : (
          <ul className="space-y-2" data-customer-insights>
            {insights.map((i, n) => (
              <li key={n} className="flex items-start gap-2 text-sm text-ink-2" dir="auto">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                {t(`insights.${i.kind}`, i.values)}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={t("customers.segmentsTitle")} description={t("customers.segmentsDescription")}>
        <EntityList
          type="segment"
          canManage={canManage}
          canApprove={canApprove}
          empty={t("customers.segmentsEmpty")}
          headerExtra={canManage && stats.total > 0 && <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => suggestSegmentsAction({}) as Promise<Result>, t("customers.suggested"))}>{t("customers.suggest")}</Button>}
          rows={segments.map((s) => ({ ...s, badges: [...(s.badges ?? []), ...(s.size != null ? [t("customers.size", { count: s.size })] : [])], extra: canManage ? <CriteriaEditor id={s.id} criteria={s.criteria} /> : undefined }))}
        />
      </SectionCard>

      <SectionCard title={t("customers.icpTitle")} description={t("customers.icpDescription")}>
        <EntityList type="icp" rows={icps} canManage={canManage} canApprove={false} empty={t("customers.icpEmpty")} />
      </SectionCard>
    </>
  );
}

function CriteriaEditor({ id, criteria }: { id: string; criteria: Record<string, unknown> }) {
  const t = useTranslations("brain");
  const [open, setOpen] = useState(false);
  const [c, setC] = useState({ city: String(criteria.city ?? ""), minOrders: criteria.minOrders != null ? String(criteria.minOrders) : "", category: String(criteria.category ?? ""), tag: String(criteria.tag ?? "") });
  const { pending, run } = useBrainAction();
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-xs font-medium text-accent hover:underline">
        {t("customers.criteria")}
      </button>
    );
  const payload = { ...(c.city ? { city: c.city } : {}), ...(c.minOrders ? { minOrders: Number(c.minOrders) } : {}), ...(c.category ? { category: c.category } : {}), ...(c.tag ? { tag: c.tag } : {}) };
  return (
    <div className="grid gap-2 rounded-xl bg-sunken p-2 sm:grid-cols-4">
      {(["city", "minOrders", "category", "tag"] as const).map((k) => (
        <Input key={k} aria-label={t(`customers.criteriaFields.${k}`)} placeholder={t(`customers.criteriaFields.${k}`)} value={c[k]} inputMode={k === "minOrders" ? "numeric" : undefined} onChange={(e) => setC({ ...c, [k]: e.target.value })} dir="auto" />
      ))}
      <Button size="xs" className="sm:col-span-4" loading={pending} onClick={() => run(() => segmentCriteriaAction({ id, criteria: payload }) as Promise<Result>, t("saved"), () => setOpen(false))}>
        {t("customers.applyCriteria")}
      </Button>
    </div>
  );
}

// ── Strategy ──

export type QuestionRow = { key: string; group: string; status: "answered" | "missing" | "needs_review"; value: string | null; strategy: boolean };

export function StrategyTab({ questions, next, strategies, canManage, canApprove }: { questions: QuestionRow[]; next: QuestionRow | null; strategies: EntityRow[]; canManage: boolean; canApprove: boolean }) {
  const t = useTranslations("brain");
  const { pending, run } = useBrainAction();
  const [type, setType] = useState<(typeof STRATEGY_TYPES)[number]>("marketing");
  const groups = [...new Set(questions.map((q) => q.group))];
  const answered = questions.filter((q) => q.status === "answered").length;
  return (
    <>
      {next && canManage && <NextQuestion q={next} />}

      <SectionCard title={t("strategy.wizardTitle")} description={t("strategy.wizardDescription")}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-ink-2">
            <span className="mb-1 block text-xs text-ink-3">{t("strategy.type")}</span>
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="h-10 w-48">
              {STRATEGY_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t(`options.${s}`)}
                </option>
              ))}
            </Select>
          </label>
          {canManage && (
            <>
              <Button icon={<Wand2 className="size-4" />} loading={pending} onClick={() => run(() => draftStrategyAction({ type, fromData: false }) as Promise<Result>, t("strategy.drafted"))}>
                {t("strategy.build")}
              </Button>
              <Button variant="secondary" loading={pending} onClick={() => run(() => draftStrategyAction({ type, fromData: true }) as Promise<Result>, t("strategy.drafted"))}>
                {t("strategy.buildFromData")}
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-ink-4">{t("strategy.draftNote")}</p>
      </SectionCard>

      <SectionCard title={t("strategy.listTitle")}>
        <EntityList
          type="strategy"
          canManage={canManage}
          canApprove={false}
          empty={t("strategy.empty")}
          rows={strategies.map((s) => ({
            ...s,
            extra: canManage ? (
              <div className="flex flex-wrap gap-1.5" data-strategy-actions>
                {s.status === "DRAFT" && <Button size="xs" variant="secondary" onClick={() => run(() => strategyStatusAction({ id: s.id, status: "REVIEW" }) as Promise<Result>)}>{t("strategy.toReview")}</Button>}
                {s.status === "REVIEW" && canApprove && <Button size="xs" onClick={() => run(() => strategyStatusAction({ id: s.id, status: "APPROVED" }) as Promise<Result>, t("approvedToast"))}>{t("approve")}</Button>}
                {s.status === "REVIEW" && <Button size="xs" variant="ghost" onClick={() => run(() => strategyStatusAction({ id: s.id, status: "DRAFT" }) as Promise<Result>)}>{t("strategy.backToDraft")}</Button>}
                {s.status !== "ARCHIVED" && <Button size="xs" variant="ghost" onClick={() => run(() => strategyStatusAction({ id: s.id, status: "ARCHIVED" }) as Promise<Result>)}>{t("strategy.archive")}</Button>}
              </div>
            ) : undefined,
          }))}
        />
      </SectionCard>

      <SectionCard title={t("strategy.questionsTitle")} description={t("strategy.questionsProgress", { answered, total: questions.length })}>
        <div className="grid gap-4 lg:grid-cols-2" data-questions>
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-4">{t(`questionGroups.${g}`)}</p>
              <ul className="space-y-1.5">
                {questions
                  .filter((q) => q.group === g)
                  .map((q) => (
                    <li key={q.key} className="flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-sunken" data-question={q.key} data-status={q.status}>
                      <span className="min-w-0">
                        <span className="text-ink-2">{t(`questions.${q.key}`)}</span>
                        {q.value && <span className="block truncate text-xs text-ink-4" dir="auto">{q.value}</span>}
                      </span>
                      <StatusBadge status={q.status} />
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </SectionCard>
    </>
  );
}

function NextQuestion({ q }: { q: QuestionRow }) {
  const t = useTranslations("brain");
  const [v, setV] = useState(q.value ?? "");
  const { pending, run } = useBrainAction();
  return (
    <Card className="space-y-3 border-accent/30 p-5" data-next-question={q.key}>
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t("strategy.nextQuestion")}</p>
      <p className="text-lg font-semibold text-ink">{t(`questions.${q.key}`)}</p>
      <Textarea rows={2} value={v} onChange={(e) => setV(e.target.value)} aria-label={t(`questions.${q.key}`)} dir="auto" />
      <div className="flex justify-end">
        <Button loading={pending} disabled={!v.trim()} onClick={() => run(() => answerQuestionAction({ key: q.key, value: v }) as Promise<Result>, t("saved"), () => setV(""))}>
          {t("strategy.saveAnswer")}
        </Button>
      </div>
    </Card>
  );
}

// ── Market & competitors ──

type Analysis = { basis: "added_sources"; ai: boolean; table: { name: string; positioning: string | null; services: number; pricing: string | null; channels: string[] }[]; analysis: { summary: string; positioning: string[]; offers: string[]; messaging: string[]; contentGaps: string[] } | null };

export function MarketTab({ competitors, canManage }: { competitors: EntityRow[]; canManage: boolean }) {
  const t = useTranslations("brain");
  const te = useTranslations("errors");
  const [url, setUrl] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const { pending, run } = useBrainAction();
  return (
    <>
      {canManage && (
        <SectionCard title={t("market.importTitle")} description={t("market.importDescription")}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://competitor.com" dir="ltr" aria-label={t("market.url")} />
            <Button icon={<Globe className="size-4" />} loading={pending} disabled={url.trim().length < 4} onClick={() => run(() => competitorUrlAction({ url }) as Promise<Result>, t("market.imported"), () => setUrl(""))}>
              {t("market.importButton")}
            </Button>
          </div>
        </SectionCard>
      )}
      <SectionCard title={t("tabs.market")} description={t("market.description")}>
        <EntityList type="competitor" rows={competitors} canManage={canManage} canApprove={false} empty={t("market.empty")} />
      </SectionCard>
      {competitors.length > 0 && (
        <SectionCard
          title={t("market.analysisTitle")}
          description={t("market.basis")}
          action={
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const r = await analyzeCompetitorsAction({});
                setBusy(false);
                if (r.ok) setAnalysis(r.data as Analysis);
                else alert(te.has(r.error) ? te(r.error) : te("unexpected"));
              }}
            >
              {t("market.analyze")}
            </Button>
          }
        >
          {analysis && (
            <div className="space-y-4" data-competitor-analysis>
              <p className="rounded-xl bg-sunken px-3 py-2 text-xs text-ink-3">{t("market.basisLabel")}</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-xs text-ink-4">
                    <tr>
                      {["name", "positioning", "services", "pricing", "channels"].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-start font-medium">{t(`fields.competitor.${h}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {analysis.table.map((r) => (
                      <tr key={r.name}>
                        <td className="px-2 py-2 font-medium" dir="auto">{r.name}</td>
                        <td className="px-2 py-2 text-ink-3" dir="auto">{r.positioning ?? "—"}</td>
                        <td className="px-2 py-2 tabular-nums">{r.services}</td>
                        <td className="px-2 py-2" dir="auto">{r.pricing ?? "—"}</td>
                        <td className="px-2 py-2 text-ink-3">{r.channels.join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {analysis.analysis ? (
                <div className="space-y-2 text-sm" dir="auto">
                  <p className="text-ink-2">{analysis.analysis.summary}</p>
                  {(["positioning", "offers", "messaging", "contentGaps"] as const).map((k) =>
                    analysis.analysis![k].length ? (
                      <div key={k}>
                        <p className="text-xs font-semibold text-ink-4">{t(`market.analysis.${k}`)}</p>
                        <ul className="list-disc ps-5 text-ink-2">{analysis.analysis![k].map((x) => <li key={x}>{x}</li>)}</ul>
                      </div>
                    ) : null,
                  )}
                </div>
              ) : (
                <p className="text-xs text-ink-4">{t("market.noAiAnalysis")}</p>
              )}
            </div>
          )}
        </SectionCard>
      )}
    </>
  );
}

// ── Sources ──

export type SourceRow = { id: string; type: string; title: string; url: string | null; status: string; health: string; chunks: number; lastSync: string; language: string | null; usedBy: string[]; error: string | null };

export function SourcesTab({ rows, total, page, canManage }: { rows: SourceRow[]; total: number; page: number; canManage: boolean }) {
  const t = useTranslations("brain");
  const format = useFormatter();
  const { pending, run } = useBrainAction();
  return (
    <SectionCard title={t("tabs.sources")} description={t("sources.description")} action={canManage && <Link href="/knowledge?tab=imports" className={buttonClass("secondary", "sm")}>{t("quick.addSource")}</Link>}>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-3">{t("sources.empty")}</p>
      ) : (
        <ul className="divide-y divide-line" data-sources>
          {rows.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3" data-source={s.id} data-health={s.health}>
              <div className="min-w-0 flex-1">
                <Link href={`/knowledge/sources/${s.id}`} className="font-medium text-ink hover:underline" dir="auto">{s.title}</Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                  <span className="rounded-full bg-sunken px-2 py-0.5">{t(`sourceTypes.${s.type}`)}</span>
                  <span>{t("sources.chunks", { count: s.chunks })}</span>
                  <span>· {format.relativeTime(new Date(s.lastSync))}</span>
                  {s.language && <span>· {s.language.toUpperCase()}</span>}
                  {s.usedBy.length > 0 && <span>· {t("sources.usedBy", { agents: s.usedBy.map((u) => t(`agents.${u}`)).join("، ") })}</span>}
                </p>
              </div>
              <StatusBadge status={s.health} />
              {canManage && (
                <div className="flex gap-1">
                  <Button size="xs" variant="ghost" icon={<RefreshCw className="size-3.5" />} disabled={s.health === "paused"} loading={pending} onClick={() => run(() => sourceRefreshAction({ id: s.id }) as Promise<Result>, t("sources.refreshing"))}>
                    {t("sources.refresh")}
                  </Button>
                  <Button size="xs" variant="ghost" icon={s.health === "paused" ? <Play className="size-3.5" /> : <Pause className="size-3.5" />} onClick={() => run(() => sourcePauseAction({ id: s.id, paused: s.health !== "paused" }) as Promise<Result>)}>
                    {s.health === "paused" ? t("sources.resume") : t("sources.pause")}
                  </Button>
                  <Button size="xs" variant="ghost" className="text-ink-4" icon={<Trash2 className="size-3.5" />} aria-label={t("delete")} onClick={() => confirm(t("confirmDelete")) && run(() => removeSource({ id: s.id }) as Promise<Result>, t("deleted"))} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {total > rows.length && (
        <div className="flex justify-between text-sm">
          {page > 1 ? <Link href={`/knowledge?tab=sources&page=${page - 1}`} className="text-accent">{t("prev")}</Link> : <span />}
          {page * 20 < total && <Link href={`/knowledge?tab=sources&page=${page + 1}`} className="text-accent">{t("next")}</Link>}
        </div>
      )}
    </SectionCard>
  );
}
