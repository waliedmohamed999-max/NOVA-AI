"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, ExternalLink, ListPlus, MoreVertical, StickyNote } from "lucide-react";
import { cn } from "@/lib/cn";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import type { PipelineCard } from "@/server/sales/desk";
import type { Money } from "@/server/sales/intelligence";
import { moveStageAction } from "../desk-actions";
import { ChannelIcons, TempPill, useDesk, useMoney, useRelative } from "./shared";

export type PipelineColumn = { stage: string; label: string; probability: number; count: number; closedWindow: boolean; value: Money | null; valuePartial: boolean; cards: PipelineCard[] };

export function PipelineBoard({ columns: initial }: { columns: PipelineColumn[] }) {
  const t = useTranslations("sales.pipeline");
  const te = useTranslations("errors");
  const desk = useDesk();
  const router = useRouter();
  const money = useMoney();
  const [columns, setColumns] = useState(initial);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [mobileStage, setMobileStage] = useState(initial.find((c) => c.count > 0 && !c.closedWindow)?.stage ?? initial[0]?.stage);
  const [, start] = useTransition();
  useEffect(() => queueMicrotask(() => setColumns(initial)), [initial]);

  /** Optimistic move with rollback when the server refuses. */
  const move = (id: string, to: string) => {
    const from = columns.find((c) => c.cards.some((x) => x.id === id));
    if (!from || from.stage === to) return;
    const card = from.cards.find((x) => x.id === id)!;
    const snapshot = columns;
    setColumns((cols) =>
      cols.map((c) =>
        c.stage === from.stage ? { ...c, count: c.count - 1, cards: c.cards.filter((x) => x.id !== id) } : c.stage === to ? { ...c, count: c.count + 1, cards: [{ ...card, stage: to }, ...c.cards] } : c,
      ),
    );
    start(async () => {
      const r = await moveStageAction({ id, stage: to });
      if (!r.ok) {
        setColumns(snapshot);
        toast.error(te.has(r.error as "unexpected") ? te(r.error as "unexpected") : te("unexpected"));
      } else {
        toast(t("moved", { name: card.name, stage: columns.find((c) => c.stage === to)?.label ?? to }));
        router.refresh();
      }
    });
  };

  // A render function (not a nested component) so re-renders during a drag don't remount the cards.
  const column = (col: PipelineColumn, mobile?: boolean) => (
    <section
      key={col.stage}
      aria-label={col.label}
      data-stage={col.stage}
      onDragOver={(e) => {
        if (!desk.canManage) return;
        e.preventDefault();
        setOver(col.stage);
      }}
      onDragLeave={() => setOver((o) => (o === col.stage ? null : o))}
      onDrop={(e) => {
        e.preventDefault();
        setOver(null);
        const id = e.dataTransfer.getData("text/lead") || drag;
        setDrag(null);
        if (id) move(id, col.stage);
      }}
      className={cn("flex flex-col rounded-2xl border bg-surface-2 transition", mobile ? "w-full" : "w-[272px] shrink-0 snap-start", over === col.stage ? "border-ink bg-sunken" : "border-line")}
    >
      <header className="flex items-start justify-between gap-2 px-3.5 pb-2 pt-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">{col.label}</span>
            <span className="rounded-full bg-surface px-1.5 text-[11px] tabular text-ink-3">{col.count}</span>
          </h3>
          <p className="text-[11px] text-ink-4">
            {col.value ? money(col.value) : t("noValue")}
            {col.value && col.valuePartial ? ` · ${t("partial")}` : ""}
            {col.closedWindow ? ` · ${t("last30")}` : ` · ${col.probability}%`}
          </p>
        </div>
      </header>
      <ol className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
        {col.cards.map((c) => <Card key={c.id} card={c} onDragStart={() => setDrag(c.id)} onMove={(to) => move(c.id, to)} columns={columns} />)}
        {col.count > col.cards.length && <li className="px-2 py-1 text-center text-[11px] text-ink-4">{t("more", { count: col.count - col.cards.length })}</li>}
        {col.count === 0 && <li className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-[11px] text-ink-4">{desk.canManage ? t("dropHere") : t("emptyStage")}</li>}
      </ol>
    </section>
  );

  return (
    <div data-testid="pipeline">
      {/* Mobile: stage selector + vertical list (no 8 columns side by side) */}
      <div className="space-y-3 md:hidden">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="tablist" aria-label={t("stages")}>
          {columns.map((c) => (
            <button key={c.stage} role="tab" aria-selected={mobileStage === c.stage} onClick={() => setMobileStage(c.stage)} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium", mobileStage === c.stage ? "border-ink bg-ink text-ink-inverse" : "border-line bg-surface text-ink-3")}>
              {c.label} <span className="tabular opacity-70">{c.count}</span>
            </button>
          ))}
        </div>
        {columns.filter((c) => c.stage === mobileStage).map((c) => column(c, true))}
      </div>
      {/* Desktop: horizontal columns with snap, drag & drop */}
      <div className="hidden snap-x gap-3 overflow-x-auto pb-3 md:flex">
        {columns.map((c) => column(c))}
      </div>
    </div>
  );
}

function Card({ card: c, onDragStart, onMove, columns }: { card: PipelineCard; onDragStart: () => void; onMove: (to: string) => void; columns: PipelineColumn[] }) {
  const t = useTranslations("sales.pipeline");
  const desk = useDesk();
  const money = useMoney();
  const rel = useRelative();
  const dueToday = c.nextActionAt && new Date(c.nextActionAt).toDateString() === new Date().toDateString();
  const late = c.nextActionAt && new Date(c.nextActionAt) < new Date() && !dueToday;
  return (
    <li
      draggable={desk.canManage}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/lead", c.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      className={cn("group relative rounded-2xl border border-line bg-surface p-3 shadow-xs transition hover:border-line-strong hover:shadow-sm", desk.canManage && "cursor-grab active:cursor-grabbing")}
      data-card={c.id}
    >
      <button className="absolute inset-0 rounded-2xl" aria-label={t("open", { name: c.name })} onClick={() => desk.openLead(c.id)} />
      <div className="pointer-events-none relative space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" dir="auto">{c.company || c.name}</p>
            {c.company && <p className="truncate text-xs text-ink-3" dir="auto">{c.name}</p>}
          </div>
          <TempPill t={c.temperature} className="shrink-0" />
        </div>
        {c.title && <p className="line-clamp-2 text-xs text-ink-2" dir="auto">{c.title}</p>}
        <p className="text-sm font-semibold tabular">{c.value ? money(c.value) : <span className="text-xs font-normal text-ink-4">{t("valueUnknown")}</span>}</p>
        <div className="space-y-0.5 text-[11px] text-ink-3">
          <p>{t("lastContact")}: {rel(c.lastContactAt)}</p>
          {c.nextAction && <p className={cn("truncate", late ? "font-semibold text-warning" : dueToday ? "font-semibold text-accent-ink" : "")} dir="auto">{t("next")}: {c.nextAction}{c.nextActionAt ? ` — ${dueToday ? t("today") : rel(c.nextActionAt)}` : ""}</p>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <ChannelIcons channels={c.channels} />
          {c.source && <span className="truncate text-[10px] text-ink-4" dir="auto">{c.source}</span>}
        </div>
      </div>
      {desk.canManage && (
        <Menu>
          <MenuTrigger className="absolute end-1.5 top-1.5 z-10 rounded-full p-1 text-ink-4 opacity-100 hover:bg-sunken hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100" aria-label={t("actions", { name: c.name })}>
            <MoreVertical className="size-4" />
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<ExternalLink />} onSelect={() => desk.openLead(c.id)}>{t("menu.open")}</MenuItem>
            <MenuItem icon={<ListPlus />} onSelect={() => desk.openFollowUp(c.id)}>{t("menu.followUp")}</MenuItem>
            <MenuItem icon={<StickyNote />} onSelect={() => desk.openQuote(c.id)}>{t("menu.quote")}</MenuItem>
            <div className="my-1 border-t border-line" />
            <p className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold text-ink-4"><ArrowLeftRight className="size-3" /> {t("menu.move")}</p>
            {columns.filter((x) => x.stage !== c.stage).map((x) => <MenuItem key={x.stage} onSelect={() => onMove(x.stage)}>{x.label}</MenuItem>)}
          </MenuContent>
        </Menu>
      )}
    </li>
  );
}
