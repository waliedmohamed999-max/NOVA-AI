"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { PostPreview, PlatformDot, type PreviewPost } from "@/components/content/post-preview";
import { RunView } from "@/features/agents/run-view";
import { planWeek, scheduleItem } from "@/features/content/actions";

export type CalItem = PreviewPost & { id: string; title: string; status: string; at: string };
type Mode = "month" | "week" | "agenda";

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
function startOfWeek(d: Date, weekStartsOn: number) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() - weekStartsOn + 7) % 7));
  return x;
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const CHANNEL_BG: Record<string, string> = {
  INSTAGRAM: "border-s-[3px] border-s-[var(--ch-instagram)]",
  FACEBOOK: "border-s-[3px] border-s-[var(--ch-facebook)]",
  LINKEDIN: "border-s-[3px] border-s-[var(--ch-linkedin)]",
  TIKTOK: "border-s-[3px] border-s-[var(--ch-tiktok)]",
};

export function CalendarBoard({ items, anchor, brandName, canEdit }: { items: CalItem[]; anchor: string; brandName: string; canEdit: boolean }) {
  const t = useTranslations("content.calendar");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const ts = useTranslations("content.status");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("month");
  const [cursor, setCursor] = useState(() => new Date(anchor));
  const [open, setOpen] = useState<CalItem | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [local, setLocal] = useState(items);
  const [pending, start] = useTransition();
  const weekStartsOn = locale === "ar" ? 6 : 1;

  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const i of local) {
      const k = dayKey(new Date(i.at));
      m.set(k, [...(m.get(k) ?? []), i].sort((a, b) => a.at.localeCompare(b.at)));
    }
    return m;
  }, [local]);

  const days = useMemo(() => {
    if (mode === "week") {
      const s = startOfWeek(cursor, weekStartsOn);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const s = startOfWeek(first, weekStartsOn);
    return Array.from({ length: 42 }, (_, i) => addDays(s, i));
  }, [cursor, mode, weekStartsOn]);

  const move = (delta: number) => setCursor((c) => (mode === "week" ? addDays(c, 7 * delta) : new Date(c.getFullYear(), c.getMonth() + delta, 1)));

  const drop = (day: Date) => {
    const id = dragging;
    setDragging(null);
    if (!id) return;
    const item = local.find((i) => i.id === id);
    if (!item || item.status === "PUBLISHED") return;
    const prev = new Date(item.at);
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), prev.getHours(), prev.getMinutes());
    setLocal((l) => l.map((i) => (i.id === id ? { ...i, at: next.toISOString() } : i)));
    start(async () => {
      const res = await scheduleItem({ id, at: next.toISOString() });
      if (!res.ok) {
        toast.error(te(res.error as "unexpected"));
        setLocal(items);
      } else toast(t("moved"));
    });
  };

  const fillWeek = () =>
    start(async () => {
      const s = startOfWeek(mode === "week" ? cursor : new Date(), weekStartsOn);
      const target = s < new Date() ? addDays(s, 7) : s;
      const res = await planWeek({ count: 7, startDate: new Date(Date.UTC(target.getFullYear(), target.getMonth(), target.getDate())).toISOString() });
      if (res.ok) setRunId(res.data.runId);
      else toast.error(te(res.error as "unexpected"));
    });

  const renderAgenda = (className?: string) => (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-surface", className)}>
            {[...byDay.entries()]
              .filter(([, list]) => new Date(list[0].at) >= addDays(new Date(), -1))
              .sort((a, b) => a[1][0].at.localeCompare(b[1][0].at))
              .slice(0, 30)
              .map(([k, list]) => (
                <section key={k} className="border-b border-line last:border-0">
                  <h3 className="bg-surface-2 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-ink-3">{format.dateTime(new Date(list[0].at), { weekday: "long", month: "long", day: "numeric" })}</h3>
                  <ul>
                    {list.map((i) => (
                      <li key={i.id}>
                        <button onClick={() => setOpen(i)} className="flex w-full items-center gap-4 px-5 py-3 text-start hover:bg-surface-2">
                          <span className="w-16 shrink-0 text-sm tabular text-ink-3">{format.dateTime(new Date(i.at), { hour: "numeric", minute: "2-digit" })}</span>
                          <PlatformDot platform={i.platform} />
                          <span className="min-w-0 flex-1 truncate font-medium">{i.title}</span>
                          <Badge tone={i.status === "PENDING_APPROVAL" ? "accent" : i.status === "PUBLISHED" ? "success" : "neutral"}>{ts(i.status as "DRAFT")}</Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            {byDay.size === 0 && <p className="px-5 py-12 text-center text-sm text-ink-3">{t("empty")}</p>}
          </div>
  );

  const today = dayKey(new Date());
  const title = mode === "week" ? `${format.dateTime(days[0], { month: "short", day: "numeric" })} – ${format.dateTime(days[6], { month: "short", day: "numeric", year: "numeric" })}` : format.dateTime(cursor, { month: "long", year: "numeric" });

  const Chip = ({ i }: { i: CalItem }) => (
    <button
      draggable={canEdit && i.status !== "PUBLISHED"}
      onDragStart={() => setDragging(i.id)}
      onDragEnd={() => setDragging(null)}
      onClick={() => setOpen(i)}
      className={cn(
        "flex w-full items-center gap-1.5 truncate rounded-lg bg-surface px-2 py-1 text-start text-[12px] shadow-xs ring-1 ring-line transition hover:ring-line-strong",
        CHANNEL_BG[i.platform],
        i.status === "PENDING_APPROVAL" && "bg-accent-soft/60",
        i.status === "FAILED" && "bg-danger-soft",
        dragging === i.id && "opacity-40",
      )}
      title={i.title}
    >
      <span className="shrink-0 tabular text-ink-3">{format.dateTime(new Date(i.at), { hour: "numeric", minute: "2-digit" })}</span>
      <span className="truncate font-medium">{i.title}</span>
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => move(-1)} aria-label={t("previous")}><ChevronLeft className="size-4 flip-rtl" /></Button>
          <Button variant="ghost" size="icon-sm" onClick={() => move(1)} aria-label={t("next")}><ChevronRight className="size-4 flip-rtl" /></Button>
          <Button variant="secondary" size="sm" onClick={() => setCursor(new Date())}>{tc("time.today")}</Button>
        </div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Segmented label={t("title")} value={mode} onChange={setMode} size="sm" options={[{ value: "month", label: t("month") }, { value: "week", label: t("week") }, { value: "agenda", label: t("agenda") }]} />
          {canEdit && (
            <Button onClick={fillWeek} loading={pending && !runId} icon={<Sparkles className="size-4 text-accent" />}>{t("fillWeek")}</Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-ink-3">
        {["INSTAGRAM", "FACEBOOK", "LINKEDIN", "TIKTOK"].map((p) => (
          <span key={p} className="inline-flex items-center gap-1.5"><PlatformDot platform={p} /> {tc(`platforms.${p}` as "platforms.INSTAGRAM")}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-accent-soft ring-1 ring-accent/40" /> {ts("PENDING_APPROVAL")}</span>
      </div>

      {mode === "agenda" ? (
        renderAgenda()
      ) : (
        <>
        {/* Phones get the agenda list; the month/week grid needs more width. */}
        {renderAgenda("sm:hidden")}
        <div className="hidden overflow-x-auto rounded-2xl border border-line bg-line sm:block">
          <div className={cn("grid min-w-[720px] grid-cols-7 gap-px")}>
            {days.slice(0, 7).map((d) => (
              <div key={`h-${d.toISOString()}`} className="bg-surface-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-3">{format.dateTime(d, { weekday: "short" })}</div>
            ))}
            {days.map((d) => {
              const k = dayKey(d);
              const list = byDay.get(k) ?? [];
              const outside = mode === "month" && d.getMonth() !== cursor.getMonth();
              return (
                <div
                  key={k}
                  onDragOver={(e) => canEdit && e.preventDefault()}
                  onDrop={() => drop(d)}
                  className={cn("flex flex-col gap-1 bg-surface p-2", mode === "week" ? "min-h-[420px]" : "min-h-[112px]", outside && "bg-surface-2/70", dragging && "hover:bg-accent-soft/40")}
                >
                  <span className={cn("mb-0.5 inline-flex size-7 items-center justify-center rounded-full text-xs tabular", k === today ? "bg-ink font-semibold text-ink-inverse" : outside ? "text-ink-4" : "text-ink-2")}>{d.getDate()}</span>
                  {list.slice(0, mode === "week" ? 20 : 3).map((i) => <Chip key={i.id} i={i} />)}
                  {mode === "month" && list.length > 3 && (
                    <button onClick={() => { setCursor(d); setMode("week"); }} className="px-2 text-start text-[11px] font-medium text-ink-3 hover:text-ink">+{list.length - 3}</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        </>
      )}
      <p className="hidden text-xs text-ink-4 sm:block">{t("dragHint")}</p>

      <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <DialogContent title={open.title} description={format.dateTime(new Date(open.at), { dateStyle: "full", timeStyle: "short" })} footer={<Link href={`/content/${open.id}`} className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-medium text-ink-inverse">{t("openPost")}</Link>}>
            <div className="flex justify-center bg-sunken/50 py-4">
              <PostPreview post={open} brandName={brandName} />
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={Boolean(runId)} onOpenChange={(o) => { if (!o) { setRunId(null); router.refresh(); } }}>
        <DialogContent title={t("fillWeek")} size="lg">{runId && <RunView runId={runId} onNavigate={() => setRunId(null)} />}</DialogContent>
      </Dialog>
    </div>
  );
}
