"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowUpRight, Building2, Check, Lightbulb, Plug, Send, Sparkles, Upload, UserPlus, Wand2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import type { Forecast, Insight, Money, Signal, TempReason } from "@/server/sales/intelligence";
import { prepareFollowUpsAction, quoteOutcomeAction, sendQuoteAction } from "../desk-actions";
import { Panel, QuietEmpty, Section, TempPill, useDesk, useMoney, useRelative } from "./shared";

function useHref() {
  const sp = useSearchParams();
  return (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    return s ? `/sales?${s}` : "/sales";
  };
}

function Pager({ page, hasMore }: { page: number; hasMore: boolean }) {
  const t = useTranslations("sales");
  const href = useHref();
  if (page <= 1 && !hasMore) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      {page > 1 ? <Link href={href({ page: page === 2 ? null : String(page - 1) })} className="font-medium text-ink-3 hover:text-ink">{t("followups.prev")}</Link> : <span />}
      {hasMore && <Link href={href({ page: String(page + 1) })} className="font-medium text-ink-3 hover:text-ink">{t("followups.next")}</Link>}
    </div>
  );
}

// ── Empty workspace: Getting started + a small preview ──

export function GettingStarted({ steps }: { steps: { lead: boolean; channel: boolean; opportunity: boolean; agent: boolean } }) {
  const t = useTranslations("sales.start");
  const desk = useDesk();
  const items = [
    { key: "lead", done: steps.lead, action: desk.canManage ? <Button size="sm" onClick={desk.openAddCustomer}>{t("lead.cta")}</Button> : null },
    { key: "channel", done: steps.channel, action: <Link href="/settings/connected-accounts" className={buttonClass("secondary", "sm")}><Plug className="size-4" /> {t("channel.cta")}</Link> },
    { key: "opportunity", done: steps.opportunity, action: desk.canManage ? <Button size="sm" variant="secondary" onClick={() => desk.openB2B()}>{t("opportunity.cta")}</Button> : null },
    { key: "agent", done: steps.agent, action: <Link href="/settings/ai" className={buttonClass("secondary", "sm")}>{t("agent.cta")}</Link> },
  ] as const;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" data-testid="getting-started">
      <Panel className="space-y-5 p-6">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2>
          <p className="text-sm text-ink-3">{t("body")}</p>
        </div>
        <ol className="space-y-2.5">
          {items.map((s, i) => (
            <li key={s.key} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-4 py-3">
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", s.done ? "bg-success text-white" : "bg-sunken text-ink-3")}>{s.done ? <Check className="size-4" /> : i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className={cn("font-medium", s.done && "text-ink-3 line-through")}>{t(`${s.key}.title`)}</p>
                <p className="text-xs text-ink-3">{t(`${s.key}.body`)}</p>
              </div>
              {!s.done && s.action}
            </li>
          ))}
        </ol>
        {desk.canManage && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button icon={<UserPlus className="size-4" />} onClick={desk.openAddCustomer} data-testid="start-add-customer">{t("primary")}</Button>
            <Button variant="secondary" icon={<Upload className="size-4" />} onClick={desk.openImport}>{t("secondary")}</Button>
          </div>
        )}
      </Panel>
      <Panel className="space-y-3 p-6" aria-hidden>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-4">{t("previewLabel")}</p>
        <div className="space-y-2 opacity-70">
          {(["pipeline", "followups", "forecast"] as const).map((k) => (
            <div key={k} className="rounded-2xl border border-dashed border-line-strong bg-surface-2 px-4 py-3">
              <p className="text-sm font-medium">{t(`preview.${k}.title`)}</p>
              <p className="text-xs text-ink-3">{t(`preview.${k}.body`)}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ── Daily brief (only with data) ──

export function MorningBrief({ brief }: { brief: { dueToday: number; hot: number; pendingApprovals: number; stalled: number } }) {
  const t = useTranslations("sales.brief");
  const href = useHref();
  const rows = [
    ["dueToday", brief.dueToday, href({ view: "followups", tab: "today" })],
    ["hot", brief.hot, href({ view: "hot" })],
    ["pendingApprovals", brief.pendingApprovals, "/approvals"],
    ["stalled", brief.stalled, href({ view: "pipeline" })],
  ] as const;
  return (
    <Panel className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center" data-testid="morning-brief">
      <p className="shrink-0 text-sm font-semibold">{t("title")}</p>
      <ul className="flex flex-1 flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {rows.filter(([, n]) => n > 0).map(([k, n, h]) => (
          <li key={k}><Link href={h} className="hover:underline"><span className="font-semibold tabular">{n}</span> <span className="text-ink-3">{t(k, { count: n })}</span></Link></li>
        ))}
      </ul>
      <Link href={href({ view: "followups", tab: brief.dueToday ? "today" : "overdue" })} className={buttonClass("primary", "sm", "shrink-0")}>{t("start")}</Link>
    </Panel>
  );
}

// ── 01 Funnel (current snapshot) ──

export function Funnel({ rows, total }: { rows: { stage: string; label: string; count: number }[]; total: number }) {
  const t = useTranslations("sales.funnel");
  const desk = useDesk();
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Section n="01" id="funnel" title={t("title")} description={t("description")}>
      {total === 0 ? (
        <QuietEmpty title={t("empty")} action={desk.canManage ? <Button size="sm" onClick={desk.openAddCustomer}>{t("cta")}</Button> : undefined} />
      ) : (
        <Panel className="space-y-2 p-5" data-testid="funnel">
          {rows.map((r) => (
            <div key={r.stage} className="grid grid-cols-[110px_1fr_48px] items-center gap-3 text-sm sm:grid-cols-[150px_1fr_56px]">
              <span className="truncate text-ink-2">{r.label}</span>
              <div className="h-7 overflow-hidden rounded-lg bg-sunken">
                <div className={cn("h-full rounded-lg transition-all", r.stage === "WON" ? "bg-success/80" : "bg-[var(--nova-blue)]/75")} style={{ width: `${(r.count / max) * 100}%`, minWidth: r.count ? 6 : 0 }} />
              </div>
              <span className="text-end font-semibold tabular">{r.count}</span>
            </div>
          ))}
          <p className="pt-1 text-[11px] text-ink-4">{t("note")}</p>
        </Panel>
      )}
    </Section>
  );
}

// ── Hot leads ──

export type HotLead = { id: string; name: string; company: string | null; temperature: string; intent: string | null; lastContactAt: string | null; nextAction: string | null; reasons: TempReason[]; signals: Signal[] };

export function HotLeads({ leads, n = "02" }: { leads: HotLead[]; n?: string }) {
  const t = useTranslations("sales");
  const desk = useDesk();
  const rel = useRelative();
  const level = (r: TempReason[]) => (r.length >= 3 ? "high" : r.length >= 1 ? "medium" : "low");
  return (
    <Section n={n} id="hot" eyebrow={t("hot.eyebrow")} title={t("hot.title")}>
      {leads.length === 0 ? (
        <QuietEmpty title={t("hot.empty")} body={t("hot.emptyBody")} action={desk.canManage ? <Button size="sm" onClick={desk.openAddCustomer}>{t("hot.cta")}</Button> : undefined} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="hot-leads">
          {leads.map((l) => (
            <li key={l.id}>
              <button onClick={() => desk.openLead(l.id)} className="flex h-full w-full flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-start shadow-xs transition hover:border-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold" dir="auto">{l.name}</p>
                    {l.company && <p className="truncate text-xs text-ink-3" dir="auto">{l.company}</p>}
                  </div>
                  <TempPill t={l.temperature} />
                </div>
                {l.intent && <p className="line-clamp-2 text-sm text-ink-2" dir="auto">{l.intent}</p>}
                <p className="text-xs text-ink-3">
                  <span className="font-medium text-ink-2">{t(`hot.level.${level(l.reasons)}`)}</span>
                  {l.reasons.length > 0 && <> — {l.reasons.slice(0, 3).map((r) => t(`reasons.${r}`)).join(" · ")}</>}
                </p>
                <div className="mt-auto space-y-0.5 border-t border-line pt-2 text-xs text-ink-3">
                  <p>{t("pipeline.lastContact")}: {rel(l.lastContactAt)}</p>
                  <p className="font-medium text-accent-ink" dir="auto">{l.signals[0] ? t(`signals.${l.signals[0].kind}`, { days: l.signals[0].days }) : (l.nextAction ?? t("hot.noNext"))}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ── Conversations ──

export type ConversationItem = { id: string; channel: string; lead: { id: string; name: string; company: string | null } | null; preview: string | null; at: string; unread: boolean; needsHuman: boolean; draftReady: boolean };

export function Conversations({ items, page, pageSize }: { items: ConversationItem[]; page: number; pageSize: number }) {
  const t = useTranslations("sales");
  const desk = useDesk();
  const rel = useRelative();
  return (
    <Section id="conversations" eyebrow={t("inbox.eyebrow")} title={t("inbox.title")} actions={<Link href="/inbox" className="text-sm font-medium text-ink-3 hover:text-ink">{t("inbox.openInbox")} <ArrowUpRight className="inline size-3.5 flip-rtl" /></Link>}>
      {items.length === 0 ? (
        <QuietEmpty title={t("inbox.empty")} body={t("inbox.emptyBody")} />
      ) : (
        <Panel className="divide-y divide-line overflow-hidden" data-testid="conversations">
          {items.map((c) => (
            <button key={c.id} onClick={() => c.lead && desk.openLead(c.lead.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-surface-2">
              <Avatar name={c.lead?.name ?? "?"} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium" dir="auto">{c.lead?.name ?? t("inbox.unknown")}</span>
                  <Badge tone="outline" className="shrink-0">{t(`filters.channels.${c.channel}` as "filters.channels.EMAIL")}</Badge>
                </div>
                <p className="truncate text-sm text-ink-3" dir="auto">{c.preview ?? "—"}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[11px] text-ink-4">{rel(c.at)}</span>
                <span className="flex gap-1">
                  {c.unread && <Badge tone="accent">{t("inbox.unread")}</Badge>}
                  {c.needsHuman && <Badge tone="warning">{t("inbox.needsHuman")}</Badge>}
                  {c.draftReady && !c.needsHuman && <Badge tone="info">{t("inbox.draftReady")}</Badge>}
                </span>
              </div>
            </button>
          ))}
        </Panel>
      )}
      <Pager page={page} hasMore={items.length === pageSize} />
    </Section>
  );
}

// ── B2B ──

export type B2BItem = { id: string; title: string; status: string; value: Money | null; industry: string | null; need: string | null; decisionMaker: string | null; nextStep: string | null; nextStepAt: string | null; expectedCloseAt: string | null; source: string | null; owner: string | null; summary: string | null; lead: { id: string; name: string; company: string | null; stage: string } };

export function B2BList({ items }: { items: B2BItem[] }) {
  const t = useTranslations("sales");
  const desk = useDesk();
  const money = useMoney();
  const format = useFormatter();
  const rel = useRelative();
  return (
    <Section id="b2b" eyebrow={t("b2b.eyebrow")} title={t("b2b.listTitle")} actions={desk.canManage ? <Button size="sm" icon={<Building2 className="size-4" />} onClick={() => desk.openB2B()}>{t("b2b.cta")}</Button> : undefined}>
      {items.length === 0 ? (
        <QuietEmpty title={t("b2b.empty")} body={t("b2b.emptyBody")} action={desk.canManage ? <Button size="sm" onClick={() => desk.openB2B()}>{t("b2b.cta")}</Button> : undefined} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" data-testid="b2b-list">
          {items.map((o) => (
            <li key={o.id}>
              <button onClick={() => desk.openLead(o.lead.id)} className="flex h-full w-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 text-start shadow-xs hover:border-line-strong">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold" dir="auto">{o.lead.company ?? o.lead.name}</p>
                    <p className="truncate text-sm text-ink-2" dir="auto">{o.title}</p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="font-semibold tabular">{o.value ? money(o.value) : <span className="text-xs font-normal text-ink-4">{t("pipeline.valueUnknown")}</span>}</p>
                    <Badge tone={o.status === "WON" ? "success" : o.status === "LOST" ? "neutral" : "outline"}>{o.status === "OPEN" ? (desk.stages.find((s) => s.stage === o.lead.stage)?.label ?? o.lead.stage) : t(`oppStatus.${o.status}`)}</Badge>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {([["contact", o.lead.name], ["decisionMaker", o.decisionMaker], ["industry", o.industry], ["owner", o.owner], ["source", o.source], ["expectedClose", o.expectedCloseAt ? format.dateTime(new Date(o.expectedCloseAt), { dateStyle: "medium" }) : null]] as const).map(([k, v]) => (
                    <div key={k} className="min-w-0"><dt className="text-ink-4">{t(`b2b.fields.${k}`)}</dt><dd className="truncate text-ink-2" dir="auto">{v ?? "—"}</dd></div>
                  ))}
                </dl>
                {o.need && <p className="line-clamp-2 text-xs text-ink-3" dir="auto">{o.need}</p>}
                <p className="border-t border-line pt-2 text-xs font-medium text-accent-ink" dir="auto">{o.nextStep ? `${t("pipeline.next")}: ${o.nextStep}${o.nextStepAt ? ` — ${rel(o.nextStepAt)}` : ""}` : t("b2b.noNext")}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ── Quotes ──

export type QuoteItem = { id: string; number: string; title: string; status: string; total: Money; discountCents: number; validUntil: string | null; approved: boolean; sentAt: string | null; sentVia: string | null; createdAt: string; lead: { id: string; name: string; company: string | null } | null };

export function Quotes({ items }: { items: QuoteItem[] }) {
  const t = useTranslations("sales");
  const te = useTranslations("errors");
  const desk = useDesk();
  const money = useMoney();
  const rel = useRelative();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(ok);
        router.refresh();
      } else toast.error(te.has((r.error ?? "unexpected") as "unexpected") ? te((r.error ?? "unexpected") as "unexpected") : te("unexpected"));
    });
  const tone = (s: string) => (s === "ACCEPTED" ? "success" : s === "NEEDS_APPROVAL" ? "warning" : s === "REJECTED" || s === "EXPIRED" ? "neutral" : s === "SENT" || s === "VIEWED" ? "info" : "outline");
  return (
    <Section id="quotes" eyebrow={t("quotes.eyebrow")} title={t("quotes.title")} description={t("quotes.description")}>
      {items.length === 0 ? (
        <QuietEmpty title={t("quotes.empty")} body={t("quotes.emptyBody")} />
      ) : (
        <Panel className="divide-y divide-line overflow-hidden" data-testid="quotes">
          {items.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-quote={q.number}>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm"><span className="font-mono text-xs text-ink-3">{q.number}</span> <span className="truncate font-medium" dir="auto">{q.title}</span></p>
                <button className="truncate text-xs text-ink-3 hover:underline" onClick={() => q.lead && desk.openLead(q.lead.id)} dir="auto">{q.lead ? `${q.lead.name}${q.lead.company ? ` · ${q.lead.company}` : ""}` : "—"}</button>
              </div>
              <div className="text-end">
                <p className="font-semibold tabular">{money(q.total)}</p>
                <p className="text-[11px] text-ink-4">{q.sentAt ? t("quotes.sentWhen", { when: rel(q.sentAt), via: q.sentVia === "manual" ? t("quotes.manual") : (q.sentVia ?? "") }) : q.validUntil ? t("quotes.validUntil", { when: rel(q.validUntil) }) : ""}</p>
              </div>
              <Badge tone={tone(q.status)}>{t(`quotes.status.${q.status}` as "quotes.status.DRAFT")}{q.status === "DRAFT" && q.approved ? ` ✓ ${t("quotes.approved")}` : ""}</Badge>
              {desk.canManage && (
                <div className="flex gap-1.5">
                  {q.status === "NEEDS_APPROVAL" && <Link href="/approvals" className={buttonClass("outline", "xs")}>{t("quotes.review")}</Link>}
                  {q.status === "DRAFT" && (
                    <Menu>
                      <MenuTrigger className={buttonClass("primary", "xs")} disabled={pending}><Send className="size-3.5" /> {t("quotes.send")}</MenuTrigger>
                      <MenuContent>
                        <MenuItem onSelect={() => run(() => sendQuoteAction({ id: q.id }), t("quotes.sent"))}>{t("quotes.sendEmail")}</MenuItem>
                        <MenuItem onSelect={() => run(() => sendQuoteAction({ id: q.id, manual: true }), t("quotes.sent"))}>{t("quotes.markSent")}</MenuItem>
                      </MenuContent>
                    </Menu>
                  )}
                  {(q.status === "SENT" || q.status === "VIEWED") && (
                    <Menu>
                      <MenuTrigger className={buttonClass("outline", "xs")} disabled={pending}>{t("quotes.outcome")}</MenuTrigger>
                      <MenuContent>
                        {(["VIEWED", "ACCEPTED", "REJECTED", "EXPIRED"] as const).filter((s) => s !== q.status).map((s) => <MenuItem key={s} onSelect={() => run(() => quoteOutcomeAction({ id: q.id, status: s }), t(`quotes.status.${s}`))}>{t(`quotes.status.${s}`)}</MenuItem>)}
                      </MenuContent>
                    </Menu>
                  )}
                </div>
              )}
            </div>
          ))}
        </Panel>
      )}
    </Section>
  );
}

// ── Forecast ──

export type ForecastView = Forecast & { currency: string; byStage: { stage: string; label: string; probability: number; count: number; withValue: number; value: Money | null; weighted: Money | null }[] };

export function ForecastPanel({ f }: { f: ForecastView }) {
  const t = useTranslations("sales.forecast");
  const money = useMoney();
  const cell = (m: Money | null) => (m ? money(m) : <span className="text-base font-normal text-ink-4">{t("noData")}</span>);
  return (
    <Section id="forecast" eyebrow={t("eyebrow")} title={t("title")} description={t("description")}>
      <Panel className="space-y-5 p-5 sm:p-6" data-testid="forecast">
        <p className="font-semibold">{t("headline")}</p>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-surface-2 px-4 py-3"><dt className="text-xs text-ink-3">{t("total")}</dt><dd className="text-2xl font-semibold tabular">{cell(f.pipeline)}</dd><p className="text-[11px] text-ink-4">{t("coverage", { known: f.openWithValue, total: f.openCount })}</p></div>
          <div className="rounded-2xl bg-surface-2 px-4 py-3"><dt className="text-xs text-ink-3">{t("weighted")}</dt><dd className="text-2xl font-semibold tabular">{cell(f.weighted)}</dd><p className="text-[11px] text-ink-4">{t("weightedNote")}</p></div>
          <div className="rounded-2xl bg-surface-2 px-4 py-3"><dt className="text-xs text-ink-3">{t("won")}</dt><dd className="text-2xl font-semibold tabular">{cell(f.won)}</dd><p className="text-[11px] text-ink-4">{t("coverage", { known: f.wonWithValue, total: f.wonCount })}</p></div>
        </dl>
        {f.byStage.some((s) => s.count > 0) && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-xs text-ink-3"><tr><th className="py-2 text-start font-medium">{t("stage")}</th><th className="py-2 text-end font-medium">{t("probability")}</th><th className="py-2 text-end font-medium">{t("deals")}</th><th className="py-2 text-end font-medium">{t("value")}</th><th className="py-2 text-end font-medium">{t("weightedShort")}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {f.byStage.map((s) => (
                  <tr key={s.stage}>
                    <td className="py-2">{s.label}</td>
                    <td className="py-2 text-end tabular text-ink-3">{s.probability}%</td>
                    <td className="py-2 text-end tabular">{s.count}{s.count > s.withValue ? <span className="text-[11px] text-ink-4"> ({t("withValue", { count: s.withValue })})</span> : null}</td>
                    <td className="py-2 text-end tabular">{money(s.value)}</td>
                    <td className="py-2 text-end tabular">{money(s.weighted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {f.otherCurrencies.length > 0 && <p className="text-xs text-warning">{t("otherCurrencies", { list: f.otherCurrencies.join(", "), currency: f.currency })}</p>}
        <p className="text-xs text-ink-4">{t("disclaimer")}</p>
      </Panel>
    </Section>
  );
}

// ── AI insights (rules over real data) ──

export function Insights({ items }: { items: Insight[] }) {
  const t = useTranslations("sales.insights");
  const href = useHref();
  const money = useMoney();
  return (
    <Section id="insights" eyebrow={t("eyebrow")} title={t("title")}>
      {items.length === 0 ? (
        <QuietEmpty title={t("empty")} body={t("emptyBody")} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="insights">
          {items.map((i) => {
            const params = i.key === "high_value_slower" ? { ...i.params, threshold: money({ cents: Number(i.params.threshold) * 100, currency: String(i.params.currency) }) } : i.params;
            return (
              <li key={i.key} className="flex gap-3 rounded-2xl border border-line bg-surface p-4">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" />
                <div className="min-w-0 space-y-1">
                  <p className="font-medium" dir="auto">{t(`${i.key}.finding`, params)}</p>
                  <p className="text-xs text-ink-3">{t(`${i.key}.why`, params)}</p>
                  <Link href={href({ view: i.action === "customers" ? "customers" : i.action, tab: i.action === "followups" ? "overdue" : null })} className="inline-flex items-center gap-1 text-xs font-semibold text-accent-ink hover:underline">
                    {t(`${i.key}.action`)} <ArrowUpRight className="size-3 flip-rtl" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ── Activity feed & opportunity log ──

export type ActivityItem = { id: string; type: string; title: string; body: string | null; at: string; actor: string | null; lead: { id: string; name: string; company: string | null }; opportunity: string | null; from: string | null; to: string | null; valueChange: { from: number | null; to: number | null; currency: string } | null };

export function ActivityFeed({ items, page, hasMore, compact }: { items: ActivityItem[]; page: number; hasMore: boolean; compact?: boolean }) {
  const t = useTranslations("sales");
  const desk = useDesk();
  const rel = useRelative();
  const stage = (s: string | null) => (s ? (desk.stages.find((x) => x.stage === s)?.label ?? s) : "");
  return (
    <Section id="activity" eyebrow={t("activity.eyebrow")} title={t("activity.title")}>
      {items.length === 0 ? (
        <QuietEmpty title={t("activity.empty")} body={t("activity.emptyBody")} />
      ) : (
        <Panel className="p-5">
          <ol className="relative space-y-4 border-s border-line ps-5" data-testid="activity">
            {items.map((e) => (
              <li key={e.id} className="relative">
                <span className={cn("absolute -start-[26px] top-1 size-2.5 rounded-full ring-4 ring-surface", e.actor === "AGENT" ? "bg-accent" : e.type === "STATUS_CHANGE" ? "bg-[var(--nova-blue)]" : "bg-line-strong")} />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{t.has(`events.${e.type}`) ? t(`events.${e.type}` as "events.CREATED") : e.title}</span>
                  {e.type === "STATUS_CHANGE" && e.from && <span className="text-sm text-ink-3">{stage(e.from)} ← {stage(e.to)}</span>}
                  <button className="text-sm text-ink-2 hover:underline" onClick={() => desk.openLead(e.lead.id)} dir="auto">{e.lead.name}</button>
                </div>
                <p className="text-xs text-ink-4">{rel(e.at)}{e.actor ? ` · ${e.actor === "AGENT" ? t("activity.byAgent") : e.actor === "SYSTEM" ? t("activity.bySystem") : e.actor}` : ""}</p>
                {!compact && e.body && <p className="mt-1 line-clamp-2 text-xs text-ink-3" dir="auto">{e.body}</p>}
              </li>
            ))}
          </ol>
        </Panel>
      )}
      {!compact && <Pager page={page} hasMore={hasMore} />}
    </Section>
  );
}

export function OpportunityLog({ items, page, hasMore }: { items: ActivityItem[]; page: number; hasMore: boolean }) {
  const t = useTranslations("sales");
  const desk = useDesk();
  const format = useFormatter();
  const money = useMoney();
  const stage = (s: string | null) => (s ? (desk.stages.find((x) => x.stage === s)?.label ?? s) : "—");
  return (
    <Section id="opportunity-log" eyebrow={t("log.eyebrow")} title={t("log.title")}>
      {items.length === 0 ? (
        <QuietEmpty title={t("log.empty")} />
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" data-testid="opportunity-log">
            <thead className="border-b border-line text-xs text-ink-3">
              <tr>{(["date", "customer", "opportunity", "action", "owner", "fromStage", "toStage", "value"] as const).map((c) => <th key={c} className="px-3 py-2.5 text-start font-medium">{t(`log.cols.${c}`)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-3">{format.dateTime(new Date(e.at), { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="px-3 py-2"><button className="hover:underline" onClick={() => desk.openLead(e.lead.id)} dir="auto">{e.lead.name}</button></td>
                  <td className="max-w-[180px] truncate px-3 py-2 text-ink-3" dir="auto">{e.opportunity ?? "—"}</td>
                  <td className="px-3 py-2">{t.has(`events.${e.type}`) ? t(`events.${e.type}` as "events.CREATED") : e.title}</td>
                  <td className="px-3 py-2 text-ink-3">{e.actor === "AGENT" ? t("activity.byAgent") : e.actor === "SYSTEM" ? t("activity.bySystem") : (e.actor ?? "—")}</td>
                  <td className="px-3 py-2 text-ink-3">{stage(e.from)}</td>
                  <td className="px-3 py-2">{stage(e.to)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular text-ink-3">{e.valueChange ? `${money(e.valueChange.from != null ? { cents: e.valueChange.from, currency: e.valueChange.currency } : null)} → ${money(e.valueChange.to != null ? { cents: e.valueChange.to, currency: e.valueChange.currency } : null)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <Pager page={page} hasMore={hasMore} />
    </Section>
  );
}

// ── Customers log ──

export type CustomerRow = { id: string; name: string; company: string | null; email: string | null; phone: string | null; stage: string; temperature: string; source: string | null; channel: string; value: Money | null; owner: string | null; lastContactAt: string | null; createdAt: string };

export function Customers({ items, total, page, pageSize }: { items: CustomerRow[]; total: number; page: number; pageSize: number }) {
  const t = useTranslations("sales");
  const desk = useDesk();
  const money = useMoney();
  const rel = useRelative();
  return (
    <Section id="customers" eyebrow={t("customers.eyebrow")} title={t("customers.title")} description={t("customers.count", { count: total })} actions={desk.canManage ? <><Button size="sm" variant="secondary" icon={<Upload className="size-4" />} onClick={desk.openImport}>{t("actions.import")}</Button><Button size="sm" icon={<UserPlus className="size-4" />} onClick={desk.openAddCustomer}>{t("actions.addCustomer")}</Button></> : undefined}>
      {items.length === 0 ? (
        <QuietEmpty title={t("customers.empty")} action={desk.canManage ? <Button size="sm" onClick={desk.openAddCustomer}>{t("actions.addCustomer")}</Button> : undefined} />
      ) : (
        <>
          {/* Mobile: stacked rows */}
          <ul className="space-y-2 md:hidden">
            {items.map((l) => (
              <li key={l.id}>
                <button onClick={() => desk.openLead(l.id)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-start">
                  <div className="min-w-0"><p className="truncate font-medium" dir="auto">{l.name}</p><p className="truncate text-xs text-ink-3" dir="auto">{l.company ?? l.email ?? "—"}</p></div>
                  <div className="shrink-0 text-end"><TempPill t={l.temperature} /><p className="mt-1 text-xs tabular">{money(l.value)}</p></div>
                </button>
              </li>
            ))}
          </ul>
          <Panel className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm" data-testid="customers-table">
              <thead className="border-b border-line text-xs text-ink-3"><tr>{(["name", "stage", "temperature", "value", "source", "owner", "lastContact"] as const).map((c) => <th key={c} className="px-4 py-2.5 text-start font-medium">{t(`customers.cols.${c}`)}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {items.map((l) => (
                  <tr key={l.id} className="cursor-pointer hover:bg-surface-2" onClick={() => desk.openLead(l.id)}>
                    <td className="px-4 py-2.5"><p className="font-medium" dir="auto">{l.name}</p><p className="text-xs text-ink-3" dir="auto">{l.company ?? l.email ?? ""}</p></td>
                    <td className="px-4 py-2.5">{desk.stages.find((s) => s.stage === l.stage)?.label ?? l.stage}</td>
                    <td className="px-4 py-2.5"><TempPill t={l.temperature} /></td>
                    <td className="px-4 py-2.5 tabular">{money(l.value)}</td>
                    <td className="px-4 py-2.5 text-ink-3" dir="auto">{l.source ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-3">{l.owner ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-3">{rel(l.lastContactAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
      <Pager page={page} hasMore={page * pageSize < total} />
    </Section>
  );
}

// ── Due follow-ups batch ──

export function DueBatch({ count }: { count: number }) {
  const t = useTranslations("sales.due");
  const te = useTranslations("errors");
  const desk = useDesk();
  const [pending, start] = useTransition();
  return (
    <Section id="due" eyebrow={t("eyebrow")} title={t("title")}>
      {count === 0 ? (
        <QuietEmpty title={t("empty")} />
      ) : (
        <Panel className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center" data-testid="due-batch">
          <Wand2 className="size-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t("suggest", { count })}</p>
            <p className="text-sm text-ink-3">{t("flow")}</p>
          </div>
          {desk.canManage && (
            <Button
              loading={pending}
              disabled={!desk.aiReady}
              icon={<Sparkles className="size-4" />}
              onClick={() => start(async () => {
                const r = await prepareFollowUpsAction({});
                if (r.ok) desk.openRun(r.data.runId);
                else toast.error(te.has(r.error as "unexpected") ? te(r.error as "unexpected") : te("unexpected"));
              })}
            >
              {desk.aiReady ? t("prepare") : t("aiOff")}
            </Button>
          )}
        </Panel>
      )}
    </Section>
  );
}

