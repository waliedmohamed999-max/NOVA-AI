"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarDays, Check, CheckCheck, PenSquare, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Segmented, Checkbox } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/misc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { PostPreview, PlatformDot, type PreviewPost } from "@/components/content/post-preview";
import { RunView } from "@/features/agents/run-view";
import { approveItems, planWeek, rejectItem } from "./actions";

export type StudioItem = PreviewPost & {
  id: string;
  title: string;
  status: string;
  pillar: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  campaign: string | null;
  authorAgent: string | null;
  rationale: string | null;
};

type View = "ideas" | "drafts" | "approval" | "scheduled" | "published";

export function ContentStudio({
  view,
  items,
  counts,
  brandName,
  canApprove,
  canCreate,
  autoStart,
}: {
  view: View;
  items: StudioItem[];
  counts: Record<View, number>;
  brandName: string;
  canApprove: boolean;
  canCreate: boolean;
  autoStart?: boolean;
}) {
  const t = useTranslations("content");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const createWeek = () =>
    start(async () => {
      const res = await planWeek({ count: 7 });
      if (res.ok) setRunId(res.data.runId);
      else toast.error(te(res.error as "unexpected"));
    });

  useEffect(() => {
    if (autoStart && canCreate) createWeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const approve = (ids: string[]) =>
    start(async () => {
      const res = await approveItems({ ids });
      if (res.ok) {
        toast(t("approved", { count: res.data.approved }));
        setSelected([]);
        router.refresh();
      } else toast.error(te(res.error as "unexpected"));
    });

  const reject = (id: string) =>
    start(async () => {
      const res = await rejectItem({ id });
      if (res.ok) router.refresh();
      else toast.error(te(res.error as "unexpected"));
    });

  const when = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : t("unscheduled"));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t("title")}
          value={view}
          onChange={(v) => router.push(`/content?view=${v}`)}
          options={(["ideas", "drafts", "approval", "scheduled", "published"] as const).map((v) => ({ value: v, label: t(`views.${v}`), count: counts[v] }))}
        />
        {canCreate && (
          <Button variant="primary" icon={<Sparkles className="size-4 text-accent" />} loading={pending && !runId} onClick={createWeek}>
            {t("createWeek")}
          </Button>
        )}
      </div>

      {view === "approval" && items.length > 0 && canApprove && (
        <div className="sticky top-[72px] z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-sm backdrop-blur">
          <Checkbox label={t("selectAll")} checked={selected.length === items.length} onChange={(v) => setSelected(v ? items.map((i) => i.id) : [])} />
          <span className="text-sm text-ink-3">{selected.length ? t("selected", { count: selected.length }) : t("selectHint")}</span>
          <div className="ms-auto flex gap-2">
            <Button size="sm" variant="secondary" disabled={!selected.length} loading={pending} onClick={() => approve(selected)} icon={<Check className="size-4" />}>
              {t("approveSelected")}
            </Button>
            <Button size="sm" loading={pending} onClick={() => approve(items.map((i) => i.id))} icon={<CheckCheck className="size-4" />}>
              {t("approveAll")}
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-line-strong bg-surface-2">
          <EmptyState
            icon={<PenSquare />}
            title={t(`empty.${view}.title`)}
            description={t(`empty.${view}.body`)}
            action={
              canCreate && (view === "drafts" || view === "approval" || view === "ideas") ? (
                <Button onClick={createWeek} loading={pending} icon={<Sparkles className="size-4 text-accent" />}>
                  {t("createFirstWeek")}
                </Button>
              ) : view === "scheduled" ? (
                <Link href="/content?view=approval" className="text-sm font-semibold text-accent-ink hover:underline">{t("goApprovals")}</Link>
              ) : null
            }
          />
        </div>
      ) : view === "approval" ? (
        <ul className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((i) => (
            <li key={i.id} className={cn("flex flex-col overflow-hidden rounded-[26px] border bg-surface shadow-xs transition", selected.includes(i.id) ? "border-ink ring-1 ring-ink" : "border-line")}>
              <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                {canApprove && <Checkbox label={i.title} checked={selected.includes(i.id)} onChange={(v) => setSelected(v ? [...selected, i.id] : selected.filter((x) => x !== i.id))} />}
                <PlatformDot platform={i.platform} />
                <span className="truncate text-sm font-medium">{tc(`platforms.${i.platform}` as "platforms.INSTAGRAM")} · {tc(`formats.${i.format}` as "formats.POST")}</span>
                <span className="ms-auto flex shrink-0 items-center gap-1 text-xs text-ink-3"><CalendarDays className="size-3.5" />{when(i.scheduledAt)}</span>
              </div>
              <div className="flex flex-1 justify-center bg-sunken/60 p-5">
                <PostPreview post={i} brandName={brandName} />
              </div>
              {i.rationale && <p className="border-t border-line px-4 py-3 text-xs text-ink-3"><span className="font-semibold text-ink-2">{t("why")}</span> {i.rationale}</p>}
              <div className="flex items-center gap-2 border-t border-line p-3">
                {canApprove && (
                  <Button size="sm" onClick={() => approve([i.id])} loading={pending} icon={<Check className="size-4" />}>
                    {tc("actions.approve")}
                  </Button>
                )}
                <Link href={`/content/${i.id}`} className="inline-flex h-8 items-center rounded-full border border-line px-3.5 text-[13px] font-medium hover:bg-sunken">
                  {tc("actions.edit")}
                </Link>
                {canApprove && (
                  <Button size="sm" variant="ghost" className="ms-auto text-ink-3" onClick={() => reject(i.id)} icon={<X className="size-4" />}>
                    {tc("actions.reject")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[24px] border border-line bg-surface">
          {items.map((i) => (
            <li key={i.id}>
              <Link href={`/content/${i.id}`} className="flex items-center gap-4 px-5 py-4 transition hover:bg-surface-2">
                <PlatformDot platform={i.platform} className="size-2.5" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{i.title}</div>
                  <div className="truncate text-sm text-ink-3">{i.hook ?? i.caption}</div>
                </div>
                {i.campaign && <Badge tone="outline" className="hidden md:inline-flex">{i.campaign}</Badge>}
                <Badge tone={i.status === "FAILED" ? "danger" : i.status === "PUBLISHED" ? "success" : i.status === "SCHEDULED" ? "info" : "neutral"}>{t(`status.${i.status}` as "status.DRAFT")}</Badge>
                <span className="hidden w-44 text-end text-sm text-ink-3 sm:block">{when(i.publishedAt ?? i.scheduledAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={Boolean(runId)} onOpenChange={(o) => { if (!o) { setRunId(null); router.refresh(); } }}>
        <DialogContent title={t("createWeek")} size="lg">
          {runId && <RunView runId={runId} onNavigate={() => setRunId(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
