"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Building2, ChevronDown, Inbox, ListChecks, MoreHorizontal, Plus, Search, Sparkles, Upload, Wand2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import { RunView } from "@/features/agents/run-view";
import type { ChannelRow, DeskFilters, DeskView } from "@/server/sales/desk";
import type { CycleResult } from "@/server/sales/operations";
import { runSalesCycleAction, salesCommandAction } from "../desk-actions";
import { DeskContext, useDesk, type DeskApi, type Member, type StageDef } from "./shared";
import { CustomerDrawer } from "./drawer";
import { AddCustomerDialog, B2BWizard, FollowUpDialog, ImportWizard, QuoteDialog } from "./forms";

export type DeskSummary = {
  hero: { customers: number; openOpportunities: number; overdue: number };
  kpis: { newWeek: number; qualified: number; hot: number; quotesSent: number; won: number; lost: number; overdue: number; openOppCount: number };
  brief: { dueToday: number; hot: number; pendingApprovals: number; stalled: number; show: boolean };
  channels: ChannelRow[];
  gettingStarted: { show: boolean; steps: { lead: boolean; channel: boolean; opportunity: boolean; agent: boolean } };
  currency: string;
};

const TABS: DeskView[] = ["overview", "pipeline", "hot", "followups", "conversations", "b2b", "quotes", "forecast", "activity", "customers"];

/**
 * Shared context + dialogs (customer drawer, add customer, B2B, import, quote, follow-up, agent run).
 * Used by the Sales Desk and by the full customer profile.
 */
export function DeskProvider({ currency, members, stages, canManage, aiReady, children }: { currency: string; members: Member[]; stages: StageDef[]; canManage: boolean; aiReady: boolean; children: ReactNode }) {
  const t = useTranslations("sales");
  const router = useRouter();
  const pathname = usePathname();
  const onDesk = pathname.startsWith("/sales");
  const [lead, setLead] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [b2b, setB2b] = useState<{ open: boolean; leadId?: string }>({ open: false });
  const [importing, setImporting] = useState(false);
  const [quote, setQuote] = useState<{ leadId: string; opportunityId?: string } | null>(null);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const api: DeskApi = useMemo(
    () => ({
      openLead: setLead,
      openAddCustomer: () => setAdding(true),
      openB2B: (leadId?: string) => setB2b({ open: true, leadId }),
      openImport: () => setImporting(true),
      openQuote: (leadId: string, opportunityId?: string) => setQuote({ leadId, opportunityId }),
      openFollowUp: setFollowUp,
      openRun: setRunId,
      canManage,
      aiReady,
      currency,
      members,
      stages,
    }),
    [canManage, aiReady, currency, members, stages],
  );
  const go = (view: string) => {
    setLead(null);
    if (onDesk) router.push(`/sales?view=${view}`);
    router.refresh();
  };
  return (
    <DeskContext.Provider value={api}>
      {children}
      <CustomerDrawer id={lead} onClose={() => setLead(null)} />
      <AddCustomerDialog open={adding} onOpenChange={setAdding} onCreated={(id) => { setAdding(false); router.refresh(); setLead(id); }} />
      <B2BWizard open={b2b.open} leadId={b2b.leadId} onOpenChange={(o) => setB2b({ open: o })} onCreated={() => { const forLead = b2b.leadId; setB2b({ open: false }); if (forLead) router.refresh(); else go("b2b"); }} />
      <ImportWizard open={importing} onOpenChange={setImporting} onDone={() => { setImporting(false); go("customers"); }} />
      <QuoteDialog target={quote} onClose={() => setQuote(null)} onCreated={() => { setQuote(null); go("quotes"); }} />
      <FollowUpDialog leadId={followUp} onClose={() => setFollowUp(null)} onCreated={() => { setFollowUp(null); router.refresh(); }} />
      <Dialog open={Boolean(runId)} onOpenChange={(o) => { if (!o) { setRunId(null); router.refresh(); } }}>
        <DialogContent title={t("command.runTitle")} size="lg">{runId && <RunView runId={runId} onNavigate={() => setRunId(null)} />}</DialogContent>
      </Dialog>
    </DeskContext.Provider>
  );
}

type DeskProps = { summary: DeskSummary; view: DeskView; filters: DeskFilters; pipelineValue: ReactNode; members: Member[]; stages: StageDef[]; sources: string[]; canManage: boolean; aiReady: boolean; children: ReactNode };

export function SalesDesk(props: DeskProps) {
  return (
    <DeskProvider currency={props.summary.currency} members={props.members} stages={props.stages} canManage={props.canManage} aiReady={props.aiReady}>
      <DeskBody {...props} />
    </DeskProvider>
  );
}

function DeskBody({ summary, view, filters, pipelineValue, members, stages, sources, canManage, aiReady, children }: DeskProps) {
  const t = useTranslations("sales");
  const te = useTranslations("errors");
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const desk = useDesk();
  const [cycle, setCycle] = useState<CycleResult | null>(null);
  const [pending, start] = useTransition();
  const err = (code: string) => (te.has(code as "unexpected") ? te(code as "unexpected") : te("unexpected"));

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    return s ? `${pathname}?${s}` : pathname;
  };

  const runCycle = () =>
    start(async () => {
      const r = await runSalesCycleAction({});
      if (r.ok) setCycle(r.data);
      else toast.error(err(r.error));
    });

  const { hero, kpis } = summary;
  const overdueTone = hero.overdue > 0;

  return (
    <>
      <div className="space-y-7" data-testid="sales-desk">
        {/* ── Hero ── */}
        <header className="relative overflow-hidden rounded-[28px] border border-line bg-surface px-5 py-6 shadow-xs sm:px-8 sm:py-8">
          <div className="pointer-events-none absolute -top-24 end-[-6rem] size-72 rounded-full bg-[radial-gradient(circle,var(--nova-blue,#3b5bdb)_0%,transparent_65%)] opacity-[0.07]" aria-hidden />
          <div className="relative flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-4">NOVA / SALES DESK</p>
              <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] sm:text-[34px]">{t("hero.headline")}</h1>
              <p className="text-[15px] text-ink-3">{t("hero.supporting")}</p>
              <p className="text-xs text-ink-4">{t("title")} — {t("subtitle")}</p>
            </div>
            <dl className="grid grid-cols-3 gap-2 sm:gap-3 lg:min-w-[420px]">
              <div className="rounded-2xl bg-surface-2 px-4 py-3">
                <dt className="text-xs text-ink-3">{t("hero.customers")}</dt>
                <dd className="text-2xl font-semibold tabular">{hero.customers}</dd>
              </div>
              <div className="rounded-2xl bg-surface-2 px-4 py-3">
                <dt className="text-xs text-ink-3">{t("hero.openOpportunities")}</dt>
                <dd className="text-2xl font-semibold tabular">{hero.openOpportunities}</dd>
              </div>
              <Link href={href({ view: "followups", tab: "overdue" })} className={cn("rounded-2xl px-4 py-3 transition", overdueTone ? "bg-warning-soft ring-1 ring-warning/30 hover:ring-warning/60" : "bg-surface-2 hover:bg-sunken")} data-testid="hero-overdue">
                <dt className={cn("flex items-center gap-1 text-xs", overdueTone ? "font-semibold text-warning" : "text-ink-3")}>
                  {overdueTone && <AlertTriangle className="size-3.5" />}
                  {t("hero.overdue")}
                </dt>
                <dd className={cn("text-2xl font-semibold tabular", overdueTone && "text-warning")}>{hero.overdue}</dd>
              </Link>
            </dl>
          </div>

          {/* ── Primary action bar ── */}
          <div className="relative mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-5">
            {canManage && (
              <>
                <Button icon={<Plus className="size-4" />} onClick={desk.openAddCustomer} data-testid="add-customer">{t("actions.addCustomer")}</Button>
                <Button variant="secondary" icon={<Building2 className="size-4" />} onClick={() => desk.openB2B()} data-testid="add-b2b">{t("actions.addB2B")}</Button>
              </>
            )}
            <Link href={href({ view: "followups", tab: hero.overdue ? "overdue" : "today" })} className={buttonClass("ghost", "md")}><ListChecks className="size-4" /> {t("actions.followUps")}</Link>
            <Link href={href({ view: "conversations" })} className={cn(buttonClass("ghost", "md"), "hidden sm:inline-flex")}><Inbox className="size-4" /> {t("actions.conversations")}</Link>
            {canManage && (
              <Button variant="ghost" loading={pending} icon={<Wand2 className="size-4 text-accent" />} onClick={runCycle} data-testid="run-cycle">{t("actions.runCycle")}</Button>
            )}
            <Menu>
              <MenuTrigger className={cn(buttonClass("ghost", "md"), "ms-auto")} aria-label={t("actions.more")}>
                <MoreHorizontal className="size-4" />
              </MenuTrigger>
              <MenuContent>
                {canManage && <MenuItem icon={<Upload />} onSelect={desk.openImport}>{t("actions.import")}</MenuItem>}
                <MenuItem icon={<Inbox />} onSelect={() => router.push(href({ view: "conversations" }))}>{t("actions.conversations")}</MenuItem>
                <MenuItem icon={<ListChecks />} onSelect={() => router.push(href({ view: "followups" }))}>{t("actions.followUps")}</MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </header>

        {/* ── System status strip ── */}
        <StatusStrip rows={summary.channels} />

        {/* ── Sales AI command bar ── */}
        <CommandBar
          aiReady={aiReady}
          onResult={(r) => {
            if (r.kind === "navigate") {
              router.push(r.href);
              if (r.cycle && canManage) runCycle();
            } else desk.openRun(r.runId);
          }}
        />

        {!summary.gettingStarted.show && (
          <>
            {/* ── KPI strip ── */}
            <dl className="grid grid-cols-2 overflow-hidden rounded-[22px] border border-line bg-surface sm:grid-cols-4 xl:grid-cols-8" data-testid="kpis">
              {(
                [
                  ["newWeek", kpis.newWeek, "newWeekHint", href({ view: "customers", period: "7d" })],
                  ["qualified", kpis.qualified, "qualifiedHint", href({ view: "pipeline" })],
                  ["hot", kpis.hot, "hotHint", href({ view: "hot" })],
                  ["quotesSent", kpis.quotesSent, "quotesSentHint", href({ view: "quotes" })],
                  ["pipelineValue", pipelineValue, "pipelineValueHint", href({ view: "forecast" })],
                  ["won", kpis.won, null, href({ view: "customers", stage: "WON" })],
                  ["lost", kpis.lost, null, href({ view: "customers", stage: "LOST" })],
                  ["overdue", kpis.overdue, "overdueHint", href({ view: "followups", tab: "overdue" })],
                ] as const
              ).map(([k, v, hint, link]) => (
                <Link key={k} href={link} className="group border-b border-e border-line px-4 py-3.5 transition hover:bg-surface-2" data-kpi={k}>
                  <dt className="text-xs text-ink-3">{t(`kpi.${k}`)}</dt>
                  <dd className={cn("mt-0.5 text-xl font-semibold tabular", k === "overdue" && kpis.overdue > 0 && "text-warning", k === "hot" && kpis.hot > 0 && "text-accent-ink")}>{v}</dd>
                  {hint && <p className="truncate text-[11px] text-ink-4">{t(`kpi.${hint}`)}</p>}
                </Link>
              ))}
            </dl>

            {/* ── Workspace tabs (sticky) + filters ── */}
            <div className="sticky top-[68px] z-20 -mx-4 space-y-2 border-b border-line bg-canvas/90 px-4 py-2 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-7 lg:px-7">
              <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]" aria-label={t("tabsLabel")}>
                {TABS.map((v) => (
                  <Link
                    key={v}
                    href={href({ view: v === "overview" ? null : v, tab: null, page: null })}
                    aria-current={view === v ? "page" : undefined}
                    className={cn("shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition", view === v ? "bg-ink text-ink-inverse" : "text-ink-3 hover:bg-sunken hover:text-ink")}
                  >
                    {t(`tabs.${v}`)}
                  </Link>
                ))}
              </nav>
              <FilterBar filters={filters} members={members} stages={stages} sources={sources} href={href} />
            </div>
          </>
        )}

        {children}
      </div>

      <Dialog open={Boolean(cycle)} onOpenChange={(o) => { if (!o) { setCycle(null); router.refresh(); } }}>
        <DialogContent title={t("cycle.title")} description={t("cycle.description")} size="lg">
          {cycle && <CycleView result={cycle} onOpenLead={(id) => { setCycle(null); desk.openLead(id); }} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusStrip({ rows }: { rows: ChannelRow[] }) {
  const t = useTranslations("sales.status");
  const dot = (s: ChannelRow["state"]) => (s === "connected" || s === "ready" ? "bg-success" : s === "running" ? "animate-pulse bg-accent" : s === "reconnect" ? "bg-warning" : "border border-ink-4 bg-transparent");
  return (
    <ul className="flex flex-wrap items-center gap-2" data-testid="status-strip" aria-label={t("label")}>
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pe-1.5 ps-3 text-xs" data-channel={r.key}>
          <span className={cn("size-2 rounded-full", dot(r.state))} aria-hidden />
          <span className="font-medium">{t(`names.${r.key}` as "names.crm")}</span>
          <span className="text-ink-3">{t(`states.${r.state}`)}{r.detail && r.state === "connected" ? ` · ${r.detail === "platform" ? t("platformEmail") : r.detail}` : ""}</span>
          {r.connectHref && (r.state === "not_connected" || r.state === "not_configured" || r.state === "reconnect") ? (
            <Link href={r.connectHref} className="rounded-full bg-sunken px-2 py-0.5 font-semibold text-ink-2 hover:bg-line">{r.state === "reconnect" ? t("reconnect") : t("connect")}</Link>
          ) : (
            <span className="w-1" />
          )}
        </li>
      ))}
    </ul>
  );
}

type CommandResult = { kind: "navigate"; href: string; cycle?: boolean } | { kind: "run"; runId: string };

function CommandBar({ aiReady, onResult }: { aiReady: boolean; onResult: (r: CommandResult) => void }) {
  const t = useTranslations("sales.command");
  const te = useTranslations("errors");
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const submit = (q: string) =>
    start(async () => {
      const r = await salesCommandAction({ text: q });
      if (r.ok) {
        setText("");
        onResult(r.data as CommandResult);
      } else toast.error(te.has(r.error as "unexpected") ? te(r.error as "unexpected") : te("unexpected"));
    });
  const examples = ["today", "prepare", "stalled", "summarize", "closest"] as const;
  return (
    <div className="space-y-2">
      <form className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2 shadow-xs focus-within:ring-2 focus-within:ring-accent/30" onSubmit={(e) => { e.preventDefault(); if (text.trim().length > 1) submit(text.trim()); }}>
        <Sparkles className="size-4 shrink-0 text-accent" />
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("placeholder")} aria-label={t("placeholder")} className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-4" dir="auto" data-testid="sales-command" />
        <Button type="submit" size="sm" loading={pending} disabled={text.trim().length < 2}>{t("ask")}</Button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {examples.map((e) => (
          <button key={e} type="button" disabled={pending} onClick={() => submit(t(`examples.${e}`))} className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink-3 transition hover:border-line-strong hover:text-ink">
            {t(`examples.${e}`)}
          </button>
        ))}
        {!aiReady && <span className="px-1 py-1 text-xs text-ink-4">{t("aiOff")}</span>}
      </div>
    </div>
  );
}

function FilterBar({ filters, members, stages, sources, href }: { filters: DeskFilters; members: Member[]; stages: StageDef[]; sources: string[]; href: (p: Record<string, string | null>) => string }) {
  const t = useTranslations("sales.filters");
  const router = useRouter();
  const [q, setQ] = useState(filters.q ?? "");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if ((e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && e.shiftKey)) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const active = [filters.owner, filters.stage, filters.temperature, filters.source, filters.channel, filters.period, filters.q].filter(Boolean).length;
  const select = (key: string, value: string | undefined, options: { value: string; label: string }[], label: string) => (
    <label className="relative shrink-0">
      <span className="sr-only">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => router.push(href({ [key]: e.target.value || null, page: null }))}
        className={cn("h-8 appearance-none rounded-full border bg-surface pe-7 ps-3 text-xs font-medium outline-none transition", value ? "border-ink text-ink" : "border-line text-ink-3 hover:border-line-strong")}
      >
        <option value="">{label}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-3 -translate-y-1/2 text-ink-4" />
    </label>
  );
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
      <form className="relative shrink-0" onSubmit={(e) => { e.preventDefault(); router.push(href({ q: q.trim() || null, page: null })); }}>
        <Search className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-4" />
        <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-8 w-52 rounded-full border border-line bg-surface pe-8 ps-8 text-xs outline-none focus:border-ink sm:w-64" dir="auto" data-testid="desk-search" />
        <kbd className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 rounded border border-line px-1 text-[10px] text-ink-4">/</kbd>
      </form>
      {select("owner", filters.owner, [{ value: "me", label: t("mine") }, { value: "none", label: t("unassigned") }, ...members.map((m) => ({ value: m.id, label: m.name }))], t("owner"))}
      {select("stage", filters.stage, stages.map((s) => ({ value: s.stage, label: s.label })), t("stage"))}
      {select("temp", filters.temperature, (["HOT", "WARM", "COLD"] as const).map((v) => ({ value: v, label: t(`temp.${v}`) })), t("temperature"))}
      {sources.length > 0 && select("source", filters.source, sources.map((s) => ({ value: s, label: s })), t("source"))}
      {select("channel", filters.channel, ["WEBSITE", "EMAIL", "WHATSAPP", "LINKEDIN", "INSTAGRAM_DM", "FACEBOOK_DM", "PHONE", "MANUAL"].map((c) => ({ value: c, label: t(`channels.${c}` as "channels.EMAIL") })), t("channel"))}
      {select("period", filters.period, (["7d", "30d", "90d"] as const).map((p) => ({ value: p, label: t(`periods.${p}`) })), t("period"))}
      {active > 0 && (
        <Link href={href({ owner: null, stage: null, temp: null, source: null, channel: null, period: null, q: null, page: null })} className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-ink-3 hover:text-ink">
          <X className="size-3" /> {t("clear", { count: active })}
        </Link>
      )}
    </div>
  );
}

function CycleView({ result, onOpenLead }: { result: CycleResult; onOpenLead: (id: string) => void }) {
  const t = useTranslations("sales");
  return (
    <div className="space-y-5" data-testid="cycle-result">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["analyzed", "followUpsCreated", "hot", "stalled"] as const).map((k) => (
          <div key={k} className="rounded-2xl bg-surface-2 px-4 py-3">
            <dt className="text-xs text-ink-3">{t(`cycle.${k}`)}</dt>
            <dd className="text-xl font-semibold tabular">{result[k]}</dd>
          </div>
        ))}
      </dl>
      {result.recommendations.length === 0 ? (
        <p className="text-sm text-ink-3">{t("cycle.nothing")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {result.recommendations.map((r) => (
            <li key={r.leadId}>
              <button className="flex w-full items-start gap-3 px-4 py-3 text-start hover:bg-surface-2" onClick={() => onOpenLead(r.leadId)}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", r.signal.severity === "high" ? "bg-accent" : "bg-warning")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.name}{r.company && <span className="font-normal text-ink-3"> · {r.company}</span>}</span>
                  <span className="block text-sm text-ink-3">{t(`signals.${r.signal.kind}`, { days: r.signal.days })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-4">{t("cycle.note")}</p>
    </div>
  );
}
