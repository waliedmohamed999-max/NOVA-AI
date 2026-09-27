"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowLeft, BarChart3, CalendarClock, Check, ExternalLink, Monitor, RefreshCw, Smartphone, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { PostPreview, PlatformDot } from "@/components/content/post-preview";
import { RunView } from "@/features/agents/run-view";
import type { StudioItem } from "./studio";
import { approveItems, commentItem, editItem, regenerateItem, rejectItem, retryItem, scheduleItem } from "./actions";

type Version = { version: number; caption: string; hook: string | null; note: string | null; by: string | null; at: string };
type History = { id: string; action: string; comment: string | null; by: string | null; at: string };

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ContentEditor({
  item,
  brandName,
  campaignId,
  socialPostId,
  permalink,
  publishError,
  versions,
  history,
  can,
}: {
  item: StudioItem;
  brandName: string;
  campaignId: string | null;
  socialPostId: string | null;
  permalink: string | null;
  publishError: string | null;
  versions: Version[];
  history: History[];
  can: { approve: boolean; edit: boolean; publish: boolean };
}) {
  const t = useTranslations("content");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [hook, setHook] = useState(item.hook ?? "");
  const [caption, setCaption] = useState(item.caption);
  const [cta, setCta] = useState(item.cta ?? "");
  const [tags, setTags] = useState(item.hashtags.join(" "));
  const [when, setWhen] = useState(toLocalInput(item.scheduledAt));
  const [comment, setComment] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const locked = item.status === "PUBLISHED" || item.status === "PUBLISHING";
  const dirty = hook !== (item.hook ?? "") || caption !== item.caption || cta !== (item.cta ?? "") || tags !== item.hashtags.join(" ");

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (success) toast(success);
        router.refresh();
      } else toast.error(te((res.error ?? "unexpected") as "unexpected"));
    });

  const preview = { ...item, hook: hook || null, caption, cta: cta || null, hashtags: tags.split(/\s+/).filter(Boolean) };

  return (
    <div className="space-y-6">
      <Link href="/content" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4 flip-rtl" /> {tc("nav.content")}
      </Link>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
            <PlatformDot platform={item.platform} />
            {tc(`platforms.${item.platform}` as "platforms.INSTAGRAM")} · {tc(`formats.${item.format}` as "formats.POST")}
            {item.pillar && <Badge tone="outline">{item.pillar}</Badge>}
            {campaignId && <Link href={`/campaigns/${campaignId}`}><Badge tone="info">{item.campaign}</Badge></Link>}
          </div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{item.title}</h1>
          <div className="flex items-center gap-2">
            <Badge tone={item.status === "FAILED" ? "danger" : item.status === "PUBLISHED" ? "success" : item.status === "PENDING_APPROVAL" ? "accent" : "neutral"}>{t(`status.${item.status}` as "status.DRAFT")}</Badge>
            {item.scheduledAt && <span className="text-sm text-ink-3">{format.dateTime(new Date(item.scheduledAt), { dateStyle: "full", timeStyle: "short" })}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can.approve && ["PENDING_APPROVAL", "DRAFT", "REJECTED"].includes(item.status) && (
            <Button loading={pending} icon={<Check className="size-4" />} onClick={() => act(() => approveItems({ ids: [item.id] }), t("approved", { count: 1 }))}>
              {tc("actions.approve")}
            </Button>
          )}
          {can.edit && !locked && (
            <Button variant="secondary" loading={pending && !!runId} icon={<RefreshCw className="size-4" />} onClick={() => start(async () => {
              const res = await regenerateItem({ id: item.id });
              if (res.ok) setRunId(res.data.runId);
              else toast.error(te(res.error as "unexpected"));
            })}>
              {t("regenerate")}
            </Button>
          )}
          {can.publish && item.status === "FAILED" && (
            <Button variant="accent" loading={pending} onClick={() => act(() => retryItem({ id: item.id }))}>{t("retry")}</Button>
          )}
          {can.approve && !locked && item.status !== "REJECTED" && (
            <Button variant="ghost" icon={<X className="size-4" />} onClick={() => act(() => rejectItem({ id: item.id }))}>{tc("actions.reject")}</Button>
          )}
          {socialPostId && (
            <Link href={`/analytics/posts/${socialPostId}`} className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-5 text-sm font-medium hover:bg-sunken">
              <BarChart3 className="size-4" /> {t("performance")}
            </Link>
          )}
          {permalink && (
            <a href={permalink} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full border border-line px-5 text-sm font-medium hover:bg-sunken">
              <ExternalLink className="size-4" /> {t("viewLive")}
            </a>
          )}
        </div>
      </header>

      {publishError && (
        <div role="alert" className="rounded-2xl border border-danger/20 bg-danger-soft px-5 py-4 text-sm text-danger">
          {t(`publishErrors.${publishError}` as "publishErrors.integration_error")}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="flex flex-col items-center gap-5 bg-sunken/50 p-6">
          <Segmented
            label={t("preview")}
            value={device}
            onChange={setDevice}
            size="sm"
            options={[
              { value: "mobile", label: <span className="inline-flex items-center gap-1.5"><Smartphone className="size-3.5" />{t("mobile")}</span> },
              { value: "desktop", label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-3.5" />{t("desktop")}</span> },
            ]}
          />
          <PostPreview post={preview} brandName={brandName} device={device} />
        </Card>

        <div className="space-y-5">
          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">{t("copy")}</h2>
            <Field label={t("fields.hook")}>{(p) => <Input {...p} value={hook} disabled={locked || !can.edit} onChange={(e) => setHook(e.target.value)} dir="auto" />}</Field>
            <Field label={t("fields.caption")}>{(p) => <Textarea {...p} rows={9} value={caption} disabled={locked || !can.edit} onChange={(e) => setCaption(e.target.value)} dir="auto" />}</Field>
            <Field label={t("fields.cta")}>{(p) => <Input {...p} value={cta} disabled={locked || !can.edit} onChange={(e) => setCta(e.target.value)} dir="auto" />}</Field>
            <Field label={t("fields.hashtags")}>{(p) => <Input {...p} value={tags} disabled={locked || !can.edit} onChange={(e) => setTags(e.target.value)} dir="ltr" />}</Field>
            {can.edit && !locked && (
              <Button disabled={!dirty} loading={pending} onClick={() => act(() => editItem({ id: item.id, hook: hook || null, caption, cta: cta || null, hashtags: tags.split(/\s+/).filter(Boolean) }), t("saved"))}>
                {t("saveVersion")}
              </Button>
            )}
          </Card>

          {can.edit && !locked && (
            <Card className="space-y-3 p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4" /> {t("schedule")}</h2>
              <div className="flex gap-2">
                <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label={t("schedule")} />
                <Button variant="secondary" disabled={!when} loading={pending} onClick={() => act(() => scheduleItem({ id: item.id, at: new Date(when).toISOString() }), t("scheduled"))}>
                  {tc("actions.save")}
                </Button>
              </div>
              <p className="text-xs text-ink-3">{t("scheduleHint")}</p>
            </Card>
          )}

          {item.designBrief && (
            <Card className="space-y-2 p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-agent-design" /> {t("designBrief")}</h2>
              <p className="text-sm text-ink-2">{item.designBrief.concept}</p>
              {item.designBrief.layout && <p className="text-sm text-ink-3">{item.designBrief.layout}</p>}
              <div className="flex gap-1.5 pt-1">{item.designBrief.palette?.map((c) => <span key={c} className="size-6 rounded-md ring-1 ring-line" style={{ background: c }} title={c} />)}</div>
            </Card>
          )}

          {item.rationale && (
            <Card className="p-5">
              <h2 className="mb-1.5 text-sm font-semibold">{t("why")}</h2>
              <p className="text-sm text-ink-2">{item.rationale}</p>
            </Card>
          )}

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">{t("activity")}</h2>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) act(async () => { const r = await commentItem({ id: item.id, comment }); if (r.ok) setComment(""); return r; }); }}>
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("commentPlaceholder")} aria-label={t("commentPlaceholder")} />
              <Button type="submit" variant="secondary" disabled={!comment.trim()}>{tc("actions.send")}</Button>
            </form>
            <ol className="space-y-3">
              {history.map((h) => (
                <li key={h.id} className="text-sm">
                  <span className="font-medium">{h.by ?? tc("agents.CONTENT_STRATEGIST.name")}</span>{" "}
                  <span className="text-ink-3">{t(`history.${h.action}` as "history.APPROVED")}</span>
                  {h.comment && h.action === "COMMENTED" && <p className="mt-0.5 text-ink-2">{h.comment}</p>}
                  <div className="text-xs text-ink-4">{format.relativeTime(new Date(h.at))}</div>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">{t("versions")}</h2>
            <ol className="space-y-2">
              {versions.map((v) => (
                <li key={v.version} className="flex items-baseline justify-between gap-3 text-sm">
                  <span>v{v.version} · <span className="text-ink-3">{v.by ? (tc.has(`agents.${v.by}.name`) ? tc(`agents.${v.by}.name` as "agents.DESIGNER.name") : v.by) : "—"}</span></span>
                  <span className="text-xs text-ink-4">{format.relativeTime(new Date(v.at))}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(runId)} onOpenChange={(o) => { if (!o) { setRunId(null); router.refresh(); } }}>
        <DialogContent title={t("regenerate")} size="lg">
          {runId && <RunView runId={runId} onNavigate={() => { setRunId(null); router.refresh(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
