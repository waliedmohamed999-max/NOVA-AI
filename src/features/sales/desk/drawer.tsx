"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarClock, FileText, Handshake, ListPlus, Mail, MessageCircle, MessageSquare, Phone, Sparkles, Trophy, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import type { leadDrawer } from "@/server/sales/desk";
import { leadDrawerAction, moveStageAction } from "../desk-actions";
import { prepareFollowupAction } from "@/features/whatsapp/actions";
import { TempPill, useDesk, useMoney, useRelative } from "./shared";

type DrawerData = NonNullable<Awaited<ReturnType<typeof leadDrawer>>>;

export function CustomerDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTranslations("sales");
  const te = useTranslations("errors");
  const tw = useTranslations("whatsapp");
  const desk = useDesk();
  const router = useRouter();
  const money = useMoney();
  const rel = useRelative();
  const [data, setData] = useState<DrawerData | null>(null);
  const [pending, start] = useTransition();

  const load = (leadId: string) =>
    start(async () => {
      const r = await leadDrawerAction({ id: leadId });
      if (r.ok) setData(r.data);
      else {
        toast.error(te.has(r.error as "unexpected") ? te(r.error as "unexpected") : te("unexpected"));
        onClose();
      }
    });

  useEffect(() => {
    if (!id) return;
    queueMicrotask(() => setData(null));
    load(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const move = (stage: string) =>
    start(async () => {
      if (!data) return;
      const r = await moveStageAction({ id: data.id, stage });
      if (r.ok) {
        toast(t("pipeline.moved", { name: data.name, stage: data.stages.find((s) => s.stage === stage)?.label ?? stage }));
        load(data.id);
        router.refresh();
      } else toast.error(te.has(r.error as "unexpected") ? te(r.error as "unexpected") : te("unexpected"));
    });

  return (
    <Dialog open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={data?.name ?? t("drawer.loading")} description={data ? [data.company, data.source].filter(Boolean).join(" · ") || undefined : undefined}>
        {!data ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-6" data-testid="customer-drawer">
            {/* Overview */}
            <div className="flex flex-wrap items-center gap-2">
              <TempPill t={data.temperature} />
              <Badge tone="outline">{data.stages.find((s) => s.stage === data.stage)?.label ?? data.stage}</Badge>
              <span className="text-sm font-semibold tabular">{money(data.value)}</span>
              {data.owner && <span className="text-xs text-ink-3">· {data.owner}</span>}
            </div>
            {data.reasons.length > 0 && (
              <p className="text-xs text-ink-3"><span className="font-semibold text-ink-2">{t("drawer.why")}</span> {data.reasons.map((r) => t(`reasons.${r}`)).join(" · ")}</p>
            )}

            {/* Next best action */}
            <div className="rounded-2xl border border-accent/25 bg-accent-soft/40 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-accent-ink"><Sparkles className="size-3.5" /> {t("drawer.nextBest")}</p>
              <p className="mt-1 text-sm" dir="auto">
                {data.signals[0] ? t(`signals.${data.signals[0].kind}`, { days: data.signals[0].days }) : data.nextAction ?? t("drawer.noNextAction")}
              </p>
              {data.nextAction && data.signals[0] && <p className="mt-1 text-xs text-ink-3" dir="auto">{t("drawer.planned")}: {data.nextAction}{data.nextActionAt ? ` · ${rel(data.nextActionAt)}` : ""}</p>}
            </div>

            {/* Quick actions */}
            {desk.canManage && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Link href={`/leads/${data.id}#conversation`} className={buttonClass("secondary", "sm")}><MessageSquare className="size-4" /> {t("drawer.sendMessage")}</Link>
                <Button size="sm" variant="secondary" icon={<ListPlus className="size-4" />} onClick={() => desk.openFollowUp(data.id)}>{t("drawer.followUp")}</Button>
                {data.phone && (
                  <Button
                    size="sm"
                    variant="secondary"
                    data-testid="followup-whatsapp"
                    icon={<MessageCircle className="size-4 text-[#1fa855]" />}
                    onClick={() =>
                      start(async () => {
                        // NOVA drafts with the customer's context; the draft waits in the WhatsApp inbox for approval.
                        const r = await prepareFollowupAction({ leadId: data.id });
                        if (!r.ok) return void toast.error(te.has(r.error as "unexpected") ? te(r.error as "unexpected") : te("unexpected"));
                        router.push(`/whatsapp/inbox?c=${r.data.conversationId}`);
                      })
                    }
                  >
                    {tw("drawer.followupWhatsapp")}
                  </Button>
                )}
                <Link href={`/leads/${data.id}#meetings`} className={buttonClass("secondary", "sm")}><CalendarClock className="size-4" /> {t("drawer.bookMeeting")}</Link>
                <Button size="sm" variant="secondary" icon={<Handshake className="size-4" />} onClick={() => desk.openB2B(data.id)}>{t("drawer.createOpportunity")}</Button>
                <Button size="sm" variant="secondary" icon={<FileText className="size-4" />} onClick={() => desk.openQuote(data.id, data.opportunities.find((o) => o.status === "OPEN")?.id)}>{t("drawer.createQuote")}</Button>
                <label className="relative">
                  <span className="sr-only">{t("drawer.moveStage")}</span>
                  <select
                    value={data.stage}
                    disabled={pending}
                    onChange={(e) => move(e.target.value)}
                    className="h-9 w-full appearance-none rounded-full border border-line bg-surface px-3 text-sm font-medium"
                    aria-label={t("drawer.moveStage")}
                    data-testid="drawer-stage"
                  >
                    {data.stages.map((s) => <option key={s.stage} value={s.stage}>{s.label}</option>)}
                  </select>
                </label>
              </div>
            )}
            {desk.canManage && !["WON", "LOST"].includes(data.stage) && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" icon={<Trophy className="size-4 text-success" />} onClick={() => move("WON")}>{t("drawer.markWon")}</Button>
                <Button size="sm" variant="outline" className="flex-1" icon={<XCircle className="size-4 text-ink-3" />} onClick={() => move("LOST")}>{t("drawer.markLost")}</Button>
              </div>
            )}

            {/* Contact */}
            <Block title={t("drawer.contact")}>
              <ul className="space-y-1.5 text-sm">
                {data.email && <li className="flex items-center gap-2"><Mail className="size-4 text-ink-4" /><a href={`mailto:${data.email}`} className="hover:underline" dir="ltr">{data.email}</a></li>}
                {data.phone && <li className="flex items-center gap-2"><Phone className="size-4 text-ink-4" /><a href={`tel:${data.phone}`} dir="ltr">{data.phone}</a></li>}
                {!data.email && !data.phone && <li className="text-ink-3">{t("drawer.noContact")}</li>}
              </ul>
            </Block>

            {data.summary && (
              <Block title={t("drawer.aiSummary")}>
                <p className="text-sm text-ink-2" dir="auto">{data.summary}</p>
              </Block>
            )}

            <Block title={t("drawer.opportunities")}>
              {data.opportunities.length ? (
                <ul className="space-y-1.5 text-sm">
                  {data.opportunities.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2">
                      <span className="min-w-0 truncate" dir="auto">{o.kind === "B2B" && <Badge tone="info" className="me-1.5">B2B</Badge>}{o.title}</span>
                      <span className="shrink-0 tabular text-ink-2">{money(o.value)} · {t(`oppStatus.${o.status}`)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-ink-3">{t("drawer.noOpportunities")}</p>}
            </Block>

            <Block title={t("drawer.tasks")}>
              {data.followUps.length ? (
                <ul className="space-y-1 text-sm">
                  {data.followUps.map((f) => <li key={f.id} className="flex justify-between gap-2"><span className="truncate" dir="auto">{f.title}</span><span className={cn("shrink-0 text-xs", f.dueAt && new Date(f.dueAt) < new Date() ? "font-semibold text-warning" : "text-ink-3")}>{f.paused ? t("followups.paused") : rel(f.dueAt)}</span></li>)}
                </ul>
              ) : <p className="text-sm text-ink-3">{t("drawer.noTasks")}</p>}
            </Block>

            <Block title={t("drawer.conversation")}>
              {data.conversation.length ? (
                <ul className="space-y-2">
                  {data.conversation.map((m) => (
                    <li key={m.id} className={cn("max-w-[90%] rounded-2xl px-3 py-2 text-sm", m.direction === "OUTBOUND" ? "ms-auto bg-ink text-ink-inverse" : "bg-sunken")} dir="auto">
                      <p className="line-clamp-3">{m.body}</p>
                      <p className="mt-0.5 text-[10px] opacity-60">{t(`channels.${m.channel}` as "channels.EMAIL")} · {rel(m.at)}{m.status === "PENDING_APPROVAL" ? ` · ${t("inbox.needsHuman")}` : m.status === "DRAFT" ? ` · ${t("inbox.draft")}` : ""}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-ink-3">{t("drawer.noConversation")}</p>}
            </Block>

            {data.quotes.length > 0 && (
              <Block title={t("drawer.quotes")}>
                <ul className="space-y-1 text-sm">
                  {data.quotes.map((q) => <li key={q.id} className="flex justify-between gap-2"><span className="font-mono text-xs">{q.number}</span><span className="tabular">{money(q.total)} · {t(`quotes.status.${q.status}`)}</span></li>)}
                </ul>
              </Block>
            )}

            <Block title={t("drawer.notes")}>
              {data.notes.length ? <ul className="space-y-1.5 text-sm">{data.notes.map((n) => <li key={n.id} className="line-clamp-3 text-ink-2" dir="auto">{n.body}</li>)}</ul> : <p className="text-sm text-ink-3">{t("drawer.noNotes")}</p>}
            </Block>

            <Block title={t("drawer.timeline")}>
              <ol className="space-y-2 border-s border-line ps-4 text-sm">
                {data.timeline.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -start-[21px] top-1.5 size-2 rounded-full bg-line-strong" />
                    <span className="block" dir="auto">{t.has(`events.${e.type}`) ? t(`events.${e.type}` as "events.CREATED") : e.title}</span>
                    <span className="text-xs text-ink-4">{rel(e.at)}</span>
                  </li>
                ))}
              </ol>
            </Block>

            <Link href={`/leads/${data.id}`} className={cn(buttonClass("primary", "md"), "w-full")} data-testid="open-profile">{t("drawer.openProfile")}</Link>
          </div>
        )}
      </SheetContent>
    </Dialog>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-4">{title}</h3>
      {children}
    </section>
  );
}
