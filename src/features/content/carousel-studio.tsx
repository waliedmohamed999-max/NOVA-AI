"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { History, Images, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { editSlideAction, generateCarouselAction, regenerateSlideAction, renderCarouselAction, restoreSlideAction } from "./studio-actions";

export type SlideView = { id: string; position: number; headline: string; body: string; visualDirection: string | null; version: number; previewUrl: string | null; history: { version: number; headline: string; body: string; source: string; at: string }[] };

/** Carousel: generate 3–10 slides, edit or regenerate ONE slide, restore any slide version, render previews. */
export function CarouselStudio({ contentId, slides, aiReady, canEdit }: { contentId: string; slides: SlideView[]; aiReady: boolean; canEdit: boolean }) {
  const t = useTranslations("content.carousel");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [count, setCount] = useState(slides.length || 6);
  const [topic, setTopic] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { headline: string; body: string }>>({});
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (ok) toast(ok);
        router.refresh();
      } else toast.error(te.has((r.error ?? "unexpected") as "unexpected") ? te((r.error ?? "unexpected") as "unexpected") : te("unexpected"));
    });

  return (
    <Card className="space-y-5 p-6" data-testid="carousel-studio">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold"><Images className="size-4 text-accent" /> {t("title")}</h2>
        {slides.length > 0 && canEdit && (
          <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => renderCarouselAction({ id: contentId }), t("rendered"))}>{t("render")}</Button>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3 sm:flex-row sm:items-center">
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("topicPlaceholder")} aria-label={t("topicPlaceholder")} dir="auto" className="flex-1" />
          <label className="flex items-center gap-2 text-sm text-ink-3">
            {t("slides")}
            <input type="number" min={3} max={10} value={count} onChange={(e) => setCount(Math.min(10, Math.max(3, Number(e.target.value) || 3)))} className="h-9 w-16 rounded-lg border border-line bg-surface px-2 text-center" />
          </label>
          <Button size="sm" disabled={!aiReady} loading={pending} icon={<Sparkles className="size-4" />} onClick={() => run(() => generateCarouselAction({ id: contentId, topic: topic || undefined, slides: count }), t("generated"))}>
            {slides.length ? t("regenerateAll") : t("generate")}
          </Button>
        </div>
      )}
      {!aiReady && <p className="text-xs text-ink-3">{te("content_ai_not_configured")}</p>}
      {slides.length === 0 && <p className="text-sm text-ink-3">{t("empty")}</p>}

      <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {slides.map((s) => {
          const d = draft[s.id] ?? { headline: s.headline, body: s.body };
          const dirty = d.headline !== s.headline || d.body !== s.body;
          return (
            <li key={s.id} className="flex flex-col gap-2 rounded-2xl border border-line p-3" data-slide={s.position}>
              <div className="flex items-center justify-between text-xs text-ink-3">
                <span className="font-semibold">{t("slideN", { n: s.position, total: slides.length })}</span>
                <Badge tone="outline">v{s.version}</Badge>
              </div>
              {s.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed private preview
                <img src={s.previewUrl} alt={s.headline} className="aspect-[4/5] w-full rounded-xl object-cover ring-1 ring-line" />
              ) : (
                <div className="flex aspect-[4/5] items-center justify-center rounded-xl bg-sunken text-xs text-ink-4">{t("noPreview")}</div>
              )}
              <Input value={d.headline} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, [s.id]: { ...d, headline: e.target.value } })} dir="auto" aria-label={t("headline")} />
              <Textarea value={d.body} disabled={!canEdit} rows={3} onChange={(e) => setDraft({ ...draft, [s.id]: { ...d, body: e.target.value } })} dir="auto" aria-label={t("body")} />
              {s.visualDirection && <p className="text-[11px] text-ink-4" dir="auto">🎨 {s.visualDirection}</p>}
              {canEdit && (
                <div className="flex flex-wrap gap-1.5">
                  {dirty && <Button size="xs" onClick={() => run(async () => { const r = await editSlideAction({ slideId: s.id, slide: { headline: d.headline, body: d.body, visualDirection: s.visualDirection ?? "" } }); if (r.ok) setDraft((x) => { const n = { ...x }; delete n[s.id]; return n; }); return r; }, t("saved"))}>{t("save")}</Button>}
                  <Button size="xs" variant="outline" disabled={!aiReady} loading={pending} icon={<RefreshCw className="size-3" />} onClick={() => run(() => regenerateSlideAction({ slideId: s.id }), t("slideRegenerated", { n: s.position }))}>{t("regenerateSlide")}</Button>
                  {s.history.length > 1 && <Button size="xs" variant="ghost" icon={<History className="size-3" />} onClick={() => setOpen(open === s.id ? null : s.id)}>{t("history")}</Button>}
                </div>
              )}
              {open === s.id && (
                <ul className="space-y-1.5 border-t border-line pt-2 text-xs">
                  {[...s.history].reverse().map((h) => (
                    <li key={h.version} className="flex items-start justify-between gap-2">
                      <span className="min-w-0" dir="auto"><span className="font-semibold">v{h.version}</span> · {t(`source.${h.source}` as "source.ai")} — {h.headline}</span>
                      {h.version !== s.version && <button className="shrink-0 font-medium text-accent-ink hover:underline" onClick={() => run(() => restoreSlideAction({ slideId: s.id, version: h.version }), t("restored"))}>{t("restore")}</button>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {slides.length > 0 && <p className="text-xs text-ink-4">{t("approvalNote")}</p>}
    </Card>
  );
}
