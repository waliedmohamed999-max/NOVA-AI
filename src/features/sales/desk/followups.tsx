"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Check, Clock, ExternalLink, Mail, MessageCircle, Pause, Phone, Play, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import type { FollowUpTab } from "@/server/sales/desk";
import type { Signal } from "@/server/sales/intelligence";
import { followUpAction, prepareFollowUpsAction } from "../desk-actions";
import { QuietEmpty, useDesk } from "./shared";

export type FollowUpItem = {
  id: string;
  title: string;
  body: string | null;
  type: string;
  dueAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  channel: string;
  byAgent: boolean;
  owner: string | null;
  lead: { id: string; name: string; company: string | null };
  signals: Signal[];
};

const TABS: FollowUpTab[] = ["today", "overdue", "week", "paused", "done"];

export function FollowUpCenter({ tab, counts, items, page, pageSize }: { tab: FollowUpTab; counts: Record<FollowUpTab, number>; items: FollowUpItem[]; page: number; pageSize: number }) {
  const sp = useSearchParams();
  const hrefFor = (k: FollowUpTab, p?: number) => {
    const q = new URLSearchParams(sp.toString());
    q.set("view", "followups");
    q.set("tab", k);
    if (p && p > 1) q.set("page", String(p));
    else q.delete("page");
    return `/sales?${q}`;
  };
  const t = useTranslations("sales.followups");
  return (
    <div className="space-y-4" data-testid="followup-center">
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist">
        {TABS.map((k) => (
          <Link key={k} href={hrefFor(k)} role="tab" aria-selected={tab === k} className={cn("flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm", tab === k ? "border-ink bg-ink text-ink-inverse" : "border-line bg-surface text-ink-3 hover:text-ink", k === "overdue" && counts.overdue > 0 && tab !== k && "border-warning/40 text-warning")}>
            {t(`tabs.${k}`)} <span className="tabular text-xs opacity-75">{counts[k]}</span>
          </Link>
        ))}
      </div>
      <FollowUpList items={items} />
      {(page > 1 || items.length === pageSize) && (
        <div className="flex justify-between text-sm">
          {page > 1 ? <Link className="font-medium text-ink-3 hover:text-ink" href={hrefFor(tab, page - 1)}>{t("prev")}</Link> : <span />}
          {items.length === pageSize && <Link className="font-medium text-ink-3 hover:text-ink" href={hrefFor(tab, page + 1)}>{t("next")}</Link>}
        </div>
      )}
    </div>
  );
}

export function FollowUpList({ items, compact }: { items: FollowUpItem[]; compact?: boolean }) {
  const t = useTranslations("sales");
  const te = useTranslations("errors");
  const desk = useDesk();
  const router = useRouter();
  const format = useFormatter();
  const [pending, start] = useTransition();
  const op = (id: string, o: "done" | "snooze_tomorrow" | "snooze_3d" | "snooze_week" | "pause" | "resume") =>
    start(async () => {
      const r = await followUpAction({ id, op: o });
      if (r.ok) {
        toast(t(`followups.did.${o}`));
        router.refresh();
      } else toast.error(te.has(r.error as "unexpected") ? te(r.error as "unexpected") : te("unexpected"));
    });
  const prepare = (leadId: string) =>
    start(async () => {
      const r = await prepareFollowUpsAction({ leadIds: [leadId] });
      if (r.ok) desk.openRun(r.data.runId);
      else toast.error(te.has(r.error as "unexpected") ? te(r.error as "unexpected") : te("unexpected"));
    });
  if (!items.length) return <QuietEmpty title={t("followups.empty")} />;
  const icon = (c: string) => (c === "EMAIL" ? Mail : c === "PHONE" ? Phone : MessageCircle);
  return (
    <ol className="relative space-y-2.5 before:absolute before:inset-y-2 before:start-[19px] before:w-px before:bg-line sm:before:hidden">
      {items.map((f) => {
        const overdue = !f.completedAt && !f.pausedAt && f.dueAt && new Date(f.dueAt) < new Date();
        const I = icon(f.channel);
        const why = f.signals[0];
        return (
          <li key={f.id} className={cn("relative flex gap-3 rounded-2xl border bg-surface p-3.5 sm:p-4", overdue ? "border-warning/40" : "border-line")} data-followup={f.id}>
            <span className={cn("z-10 mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full", overdue ? "bg-warning-soft text-warning" : "bg-sunken text-ink-3")}><I className="size-4" /></span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <button className="truncate font-semibold hover:underline" onClick={() => desk.openLead(f.lead.id)} dir="auto">{f.lead.name}</button>
                {f.lead.company && <span className="truncate text-sm text-ink-3" dir="auto">{f.lead.company}</span>}
              </div>
              <p className="text-sm text-ink-2" dir="auto">{f.byAgent && <Sparkles className="me-1 inline size-3 text-accent" />}{f.title}</p>
              {why && !f.completedAt && <p className="text-xs text-ink-3"><span className="font-medium text-ink-2">{t("followups.why")}</span> {t(`signals.${why.kind}`, { days: why.days })}</p>}
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-4">
                <span className={cn(overdue && "font-semibold text-warning")}>{f.completedAt ? t("followups.doneAt", { when: format.relativeTime(new Date(f.completedAt)) }) : f.pausedAt ? t("followups.paused") : f.dueAt ? format.dateTime(new Date(f.dueAt), { dateStyle: "medium", timeStyle: "short" }) : "—"}</span>
                <span>· {t(`filters.channels.${f.channel}` as "filters.channels.EMAIL")}</span>
                {f.owner && <span>· {f.owner}</span>}
              </p>
            </div>
            {desk.canManage && !f.completedAt && (
              <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                <Button size="xs" variant="outline" icon={<Check className="size-3.5" />} loading={pending} onClick={() => op(f.id, "done")} aria-label={t("followups.markDone")}>{compact ? null : t("followups.done")}</Button>
                <Menu>
                  <MenuTrigger className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-3 hover:text-ink" aria-label={t("followups.more")}>{t("followups.more")}</MenuTrigger>
                  <MenuContent>
                    <MenuItem icon={<Clock />} onSelect={() => op(f.id, "snooze_tomorrow")}>{t("followups.snoozeTomorrow")}</MenuItem>
                    <MenuItem icon={<Clock />} onSelect={() => op(f.id, "snooze_3d")}>{t("followups.snooze3d")}</MenuItem>
                    <MenuItem icon={<Clock />} onSelect={() => op(f.id, "snooze_week")}>{t("followups.snoozeWeek")}</MenuItem>
                    {f.pausedAt ? <MenuItem icon={<Play />} onSelect={() => op(f.id, "resume")}>{t("followups.resume")}</MenuItem> : <MenuItem icon={<Pause />} onSelect={() => op(f.id, "pause")}>{t("followups.pause")}</MenuItem>}
                    <MenuItem icon={<ExternalLink />} onSelect={() => desk.openLead(f.lead.id)}>{t("followups.openCustomer")}</MenuItem>
                    <MenuItem icon={<Sparkles />} disabled={!desk.aiReady} onSelect={() => prepare(f.lead.id)}>{desk.aiReady ? t("followups.prepareMessage") : t("followups.aiOff")}</MenuItem>
                  </MenuContent>
                </Menu>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
