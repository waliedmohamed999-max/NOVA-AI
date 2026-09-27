"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowLeft, Bot, Flame, Mail, Phone, RefreshCw, Send, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { RunView } from "@/features/agents/run-view";
import { FollowUpList } from "./followups";
import { MeetingsCard, type MeetingView } from "./meetings";
import { STAGES } from "./board";
import { followUpLead, moveLead, noteLead, requalifyLead, sendLeadMessage } from "./actions";

type Lead = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
  temperature: "HOT" | "WARM" | "COLD";
  score: number;
  valueCents: number | null;
  currency: string;
  source: string | null;
  channel: string;
  intent: string | null;
  summary: string | null;
  objections: string[];
  interests: string[];
  tags: string[];
  nextAction: string | null;
  nextActionAt: string | null;
  campaign: { id: string; name: string } | null;
  createdAt: string;
};
type Event = { id: string; type: string; title: string; body: string | null; actorType: string; at: string };
type Message = { id: string; direction: string; body: string; status: string; aiDrafted: boolean; at: string; channel: string };

export function LeadDetail({ lead, events, messages, activities, stageLabels, canManage, sendable, calendar, meetings }: {
  lead: Lead;
  events: Event[];
  messages: Message[];
  activities: Parameters<typeof FollowUpList>[0]["items"];
  stageLabels: Record<string, string>;
  canManage: boolean;
  sendable: boolean;
  calendar: { provider: "GOOGLE" | "MICROSOFT"; email: string | null } | null;
  meetings: MeetingView[];
}) {
  const t = useTranslations("leads");
  const te = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const draft = [...messages].reverse().find((m) => m.direction === "OUTBOUND" && (m.status === "DRAFT" || m.status === "PENDING_APPROVAL"));
  const [reply, setReply] = useState(draft?.body ?? "");
  const [fu, setFu] = useState({ title: "", when: "" });

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (ok) toast(ok);
        router.refresh();
      } else toast.error(te((r.error ?? "unexpected") as "unexpected"));
    });

  const money = lead.valueCents != null ? format.number(lead.valueCents / 100, { style: "currency", currency: lead.currency, maximumFractionDigits: 0 }) : "—";

  return (
    <div className="space-y-6">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink"><ArrowLeft className="size-4 flip-rtl" /> {t("title")}</Link>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={lead.temperature === "HOT" ? "accent" : lead.temperature === "WARM" ? "warning" : "neutral"}>{lead.temperature === "HOT" && <Flame className="size-3" />}{t(`temps.${lead.temperature}`)}</Badge>
            <span className="text-sm tabular text-ink-3">{t("scoreLabel", { score: lead.score })}</span>
            {lead.campaign && <Link href={`/campaigns/${lead.campaign.id}`}><Badge tone="info">{lead.campaign.name}</Badge></Link>}
          </div>
          <h1 className="text-[30px] font-semibold tracking-[-0.02em]">{lead.name}</h1>
          <p className="text-ink-3">{[lead.company, lead.source].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <Select aria-label={t("columns.stage")} value={lead.stage} onChange={(e) => act(() => moveLead({ id: lead.id, stage: e.target.value }), t("stageUpdated"))} className="h-10 w-48">
              {STAGES.map((s) => <option key={s} value={s}>{stageLabels[s]}</option>)}
            </Select>
          )}
          {canManage && (
            <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => start(async () => { const r = await requalifyLead({ id: lead.id }); if (r.ok) setRunId(r.data.runId); else toast.error(te(r.error as "unexpected")); })}>
              {t("requalify")}
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {(lead.summary || lead.nextAction) && (
            <Card className="relative overflow-hidden p-6">
              <div className="absolute inset-0 ai-aura opacity-50" aria-hidden />
              <div className="relative space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-ink-3"><Sparkles className="size-4 text-accent" /> {t("aiSummary")}</h2>
                {lead.summary && <p className="text-[16px] leading-relaxed">{lead.summary}</p>}
                {lead.nextAction && (
                  <p className="text-sm"><span className="font-semibold">{t("recommended")}</span> {lead.nextAction}{lead.nextActionAt && <span className="text-ink-3"> · {format.relativeTime(new Date(lead.nextActionAt))}</span>}</p>
                )}
                {lead.objections.length > 0 && <p className="text-sm text-ink-2"><span className="font-semibold">{t("objections")}</span> {lead.objections.join(" · ")}</p>}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold">{t("conversation")}</h2>
            <ol className="space-y-3">
              {messages.filter((m) => m.status !== "DRAFT" && m.status !== "PENDING_APPROVAL").map((m) => (
                <li key={m.id} className={cn("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[80%] rounded-2xl px-4 py-2.5 text-sm", m.direction === "OUTBOUND" ? "rounded-ee-md bg-ink text-ink-inverse" : "rounded-es-md bg-sunken")} dir="auto">
                    <p className="whitespace-pre-line">{m.body}</p>
                    <p className="mt-1 text-[11px] opacity-60">{format.relativeTime(new Date(m.at))}</p>
                  </div>
                </li>
              ))}
              {messages.length === 0 && <p className="text-sm text-ink-3">{t("noMessages")}</p>}
            </ol>
            {draft && canManage && (
              <div className="mt-5 space-y-3 rounded-2xl border border-accent/30 bg-accent-soft/40 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-accent-ink">
                  <Bot className="size-3.5" /> {draft.status === "PENDING_APPROVAL" ? t("draftApproval") : t("draftReady")}
                </div>
                <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={6} dir="auto" aria-label={t("reply")} />
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={!sendable || !reply.trim()} loading={pending} icon={<Send className="size-4" />} onClick={() => act(() => sendLeadMessage({ messageId: draft.id, body: reply }), t("sent"))}>{t("send")}</Button>
                  <button className="text-sm font-medium text-ink-3 hover:text-ink" onClick={() => { void navigator.clipboard.writeText(reply); toast(t("copied")); }}>{t("copy")}</button>
                  {!sendable && <span className="text-xs text-ink-3">{t("notSendable")}</span>}
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold">{t("timeline")}</h2>
            <ol className="relative space-y-5 border-s border-line ps-6">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className={cn("absolute -start-[31px] top-0.5 flex size-4 items-center justify-center rounded-full ring-4 ring-surface", e.actorType === "AGENT" ? "bg-accent" : e.actorType === "USER" ? "bg-ink" : "bg-line-strong")} />
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{t.has(`events.${e.type}`) ? t(`events.${e.type}` as "events.CREATED") : e.title}</span>
                    {e.type === "STATUS_CHANGE" && <span className="text-sm text-ink-3">{e.title.split(" → ").map((s) => stageLabels[s] ?? s).join(" → ")}</span>}
                    <span className="text-xs text-ink-4">{format.dateTime(new Date(e.at), { dateStyle: "medium", timeStyle: "short" })}</span>
                  </div>
                  {e.body && <p className="mt-1 line-clamp-4 whitespace-pre-line text-sm text-ink-2" dir="auto">{e.body}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="space-y-3 p-5 text-sm">
            <Row icon={User} label={t("fields.value")} value={money} />
            {lead.email && <Row icon={Mail} label={t("fields.email")} value={<a href={`mailto:${lead.email}`} className="hover:underline" dir="ltr">{lead.email}</a>} />}
            {lead.phone && <Row icon={Phone} label={t("fields.phone")} value={<a href={`tel:${lead.phone}`} dir="ltr">{lead.phone}</a>} />}
            {lead.interests.length > 0 && <div className="flex flex-wrap gap-1.5 pt-1">{lead.interests.map((i) => <Badge key={i} tone="outline">{i}</Badge>)}</div>}
          </Card>

          <MeetingsCard leadId={lead.id} calendar={calendar} meetings={meetings} canManage={canManage} hasEmail={Boolean(lead.email)} />

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t("sales.followUps")}</h2>
            <FollowUpList items={activities} />
            {canManage && (
              <form className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3" onSubmit={(e) => { e.preventDefault(); act(async () => { const r = await followUpLead({ id: lead.id, title: fu.title, dueAt: new Date(fu.when).toISOString() }); if (r.ok) setFu({ title: "", when: "" }); return r; }); }}>
                <Input value={fu.title} onChange={(e) => setFu({ ...fu, title: e.target.value })} placeholder={t("followUpPlaceholder")} aria-label={t("followUpPlaceholder")} required />
                <div className="flex gap-2">
                  <Input type="datetime-local" value={fu.when} onChange={(e) => setFu({ ...fu, when: e.target.value })} required aria-label={t("when")} />
                  <Button type="submit" variant="secondary">{t("addFollowUp")}</Button>
                </div>
              </form>
            )}
          </section>

          {canManage && (
            <Card className="space-y-3 p-5">
              <h2 className="text-sm font-semibold">{t("notes")}</h2>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={t("notePlaceholder")} aria-label={t("notes")} />
              <Button size="sm" variant="secondary" disabled={!note.trim()} onClick={() => act(async () => { const r = await noteLead({ id: lead.id, body: note }); if (r.ok) setNote(""); return r; })}>{t("addNote")}</Button>
            </Card>
          )}
        </aside>
      </div>

      <Dialog open={Boolean(runId)} onOpenChange={(o) => { if (!o) { setRunId(null); router.refresh(); } }}>
        <DialogContent title={t("requalify")} size="lg">{runId && <RunView runId={runId} onNavigate={() => setRunId(null)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof User; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="size-4 text-ink-4" />
      <span className="w-24 shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 truncate font-medium">{value}</span>
    </div>
  );
}
