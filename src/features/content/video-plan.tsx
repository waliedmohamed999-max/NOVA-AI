"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Clapperboard, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import type { VideoPlan } from "@/server/studio/video";
import { generateVideoPlanAction, renderReelCoverAction } from "./studio-actions";

/** Reel / short-video plan: scenes, shot list, voice-over and on-screen text, plus a cover. No video is generated. */
export function VideoPlanPanel({ contentId, plan, coverUrl, aiReady, canEdit }: { contentId: string; plan: VideoPlan | null; coverUrl: string | null; aiReady: boolean; canEdit: boolean }) {
  const t = useTranslations("content.video");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [duration, setDuration] = useState(plan?.durationSec ?? 30);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(ok);
        router.refresh();
      } else toast.error(te.has((r.error ?? "unexpected") as "unexpected") ? te((r.error ?? "unexpected") as "unexpected") : te("unexpected"));
    });

  return (
    <Card className="space-y-5 p-6" data-testid="video-plan">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold"><Clapperboard className="size-4 text-accent" /> {t("title")}</h2>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-ink-3">
              {t("duration")}
              <input type="number" min={7} max={90} value={duration} onChange={(e) => setDuration(Math.min(90, Math.max(7, Number(e.target.value) || 30)))} className="h-9 w-16 rounded-lg border border-line bg-surface px-2 text-center" />
            </label>
            <Button size="sm" disabled={!aiReady} loading={pending} icon={<Sparkles className="size-4" />} onClick={() => run(() => generateVideoPlanAction({ id: contentId, durationSec: duration }), t("generated"))}>{plan ? t("regenerate") : t("generate")}</Button>
            {plan && <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => renderReelCoverAction({ id: contentId }), t("coverDone"))}>{t("cover")}</Button>}
          </div>
        )}
      </div>
      {!aiReady && <p className="text-xs text-ink-3">{te("content_ai_not_configured")}</p>}
      <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink-3">{t("noVideoNote")}</p>
      {!plan ? (
        <p className="text-sm text-ink-3">{t("empty")}</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-ink-3">{t("concept")}</dt><dd dir="auto">{plan.concept}</dd></div>
              <div><dt className="text-xs text-ink-3">{t("hook")}</dt><dd className="font-medium" dir="auto">{plan.hook}</dd></div>
              <div><dt className="text-xs text-ink-3">{t("length")}</dt><dd className="tabular">{plan.durationSec}s · {plan.scenes.length} {t("scenes")}</dd></div>
              <div><dt className="text-xs text-ink-3">{t("music")}</dt><dd dir="auto">{plan.music}</dd></div>
            </dl>
            <ol className="space-y-2">
              {plan.scenes.map((s) => (
                <li key={s.order} className="rounded-xl border border-line p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between text-xs text-ink-3"><span className="font-semibold">{t("scene", { n: s.order })}</span><span className="tabular">{s.durationSec}s</span></div>
                  <p dir="auto"><span className="text-ink-3">{t("shot")}:</span> {s.shot}</p>
                  {s.voiceOver && <p dir="auto"><span className="text-ink-3">{t("voiceOver")}:</span> {s.voiceOver}</p>}
                  {s.onScreenText && <p dir="auto"><span className="text-ink-3">{t("onScreen")}:</span> <span className="font-medium">{s.onScreenText}</span></p>}
                  {s.assetNeeded && <p className="text-xs text-warning" dir="auto">📎 {s.assetNeeded}</p>}
                </li>
              ))}
            </ol>
            {plan.shotList.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-ink-3">{t("shotList")}</p>
                <ul className="list-disc space-y-0.5 ps-5 text-sm" dir="auto">{plan.shotList.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
            )}
            <div>
              <p className="mb-1 text-xs font-semibold text-ink-3">{t("caption")}</p>
              <p className="whitespace-pre-line text-sm" dir="auto">{plan.caption}</p>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-ink-3">{t("coverTitle")}</p>
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed private cover
              <img src={coverUrl} alt={plan.coverText} className="aspect-[9/16] w-full rounded-xl object-cover ring-1 ring-line" />
            ) : (
              <div className="flex aspect-[9/16] items-center justify-center rounded-xl bg-sunken p-3 text-center text-xs text-ink-4" dir="auto">{plan.coverText}</div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
