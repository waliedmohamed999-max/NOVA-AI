"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, CheckCircle2, Circle, Loader2, Layers, RefreshCw, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Checkbox, Segmented } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import type { Suggestion } from "@/server/studio/content";
import type { QualityCheck } from "@/server/studio/context";
import { adaptAction, applyVersionAction, assetsAction, generateImageAction, improveAction, qualityAction, selectAssetAction } from "./studio-actions";

export type StudioCaps = { text: boolean; image: boolean; usage: { used: number; limit: number }; defaults: { mode: "brand_template" | "ai_creative"; quality: "fast" | "quality" } };
type Current = { hook: string | null; caption: string; cta: string | null; hashtags: string[] };
type Field = keyof Current;
const FIELDS: Field[] = ["hook", "caption", "cta", "hashtags"];
const PLATFORMS = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "TIKTOK"] as const;

function useErr() {
  const te = useTranslations("errors");
  return (code?: string) => toast.error(te.has((code ?? "unexpected") as "unexpected") ? te((code ?? "unexpected") as "unexpected") : te("unexpected"));
}

export function QualityList({ checks }: { checks: QualityCheck }) {
  const t = useTranslations("content.studio.quality");
  return (
    <ul className="space-y-1.5">
      {checks.map((c) => (
        <li key={c.dimension} className="flex items-start gap-2 text-sm">
          {c.status === "good" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />}
          <span>
            <span className="font-medium">{t(`dims.${c.dimension}`)}</span> <span className={c.status === "good" ? "text-success" : "text-warning"}>· {t(c.status)}</span>
            {c.reason && c.status !== "good" && <span className="block text-xs text-ink-3" dir="auto">{c.reason}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Text tools: improve, edit with AI, other platforms, quality check. Nothing is overwritten without a choice. */
export function AiTextPanel({ itemId, platform, current, caps, initialQuality, autoOpen }: { itemId: string; platform: string; current: Current; caps: StudioCaps; initialQuality: QualityCheck | null; autoOpen?: "improve" | "edit" | null }) {
  const t = useTranslations("content.studio");
  const tc = useTranslations("common");
  const err = useErr();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [instruction, setInstruction] = useState("");
  const [editing, setEditing] = useState(autoOpen === "edit");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [lastInstruction, setLastInstruction] = useState<string | undefined>();
  const [quality, setQuality] = useState<QualityCheck | null>(initialQuality);
  const [targets, setTargets] = useState<string[]>([]);

  const improve = useCallback(
    (ins?: string) =>
      start(async () => {
        setLastInstruction(ins);
        const r = await improveAction({ id: itemId, instruction: ins });
        if (r.ok) setSuggestion(r.data);
        else err(r.error);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemId],
  );

  useEffect(() => {
    if (autoOpen === "improve" && caps.text) improve();
  }, [autoOpen, caps.text, improve]);

  if (!caps.text)
    return (
      <Card className="space-y-2 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-accent" /> {t("title")}</h2>
        <p className="text-sm text-ink-3">{t("notConfiguredText")}</p>
      </Card>
    );

  return (
    <Card className="space-y-4 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-accent" /> {t("title")}</h2>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={pending && !editing} icon={<Wand2 className="size-3.5" />} onClick={() => improve()}>{t("improve")}</Button>
        <Button size="sm" variant="secondary" onClick={() => setEditing((v) => !v)}>{t("aiEdit")}</Button>
        <Button size="sm" variant="ghost" loading={pending && quality === null} icon={<ShieldCheck className="size-3.5" />} onClick={() => start(async () => {
          const r = await qualityAction({ id: itemId });
          if (r.ok) setQuality(r.data.checks);
          else err(r.error);
        })}>{t("quality.run")}</Button>
      </div>
      {editing && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (instruction.trim().length >= 3) improve(instruction.trim()); }}>
          <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t("aiEditPlaceholder")} aria-label={t("aiEdit")} dir="auto" />
          <Button type="submit" variant="secondary" loading={pending} disabled={instruction.trim().length < 3}>{tc("actions.send")}</Button>
        </form>
      )}
      {quality && (
        <div className="space-y-2 rounded-2xl bg-surface-2 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">{t("quality.title")}</p>
          <QualityList checks={quality} />
        </div>
      )}
      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-sm font-medium">{t("adapt.title")}</p>
        <p className="text-xs text-ink-3">{t("adapt.hint")}</p>
        <div className="flex flex-wrap gap-3">
          {PLATFORMS.filter((p) => p !== platform).map((p) => (
            <Checkbox key={p} label={tc(`platforms.${p}` as "platforms.INSTAGRAM")} checked={targets.includes(p)} onChange={(v) => setTargets(v ? [...targets, p] : targets.filter((x) => x !== p))} />
          ))}
        </div>
        <Button size="sm" variant="secondary" disabled={!targets.length} loading={pending} icon={<Layers className="size-3.5" />} onClick={() => start(async () => {
          const r = await adaptAction({ id: itemId, platforms: targets as (typeof PLATFORMS)[number][] });
          if (r.ok) {
            toast(t("adapt.done", { count: r.data.ids.length }));
            setTargets([]);
            router.refresh();
          } else err(r.error);
        })}>{t("adapt.run")}</Button>
      </div>

      {suggestion && (
        <CompareDialog
          itemId={itemId}
          current={current}
          suggestion={suggestion}
          busy={pending}
          onRetry={() => improve(lastInstruction)}
          onClose={() => setSuggestion(null)}
          onSaved={() => {
            setSuggestion(null);
            setQuality(null);
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}

function CompareDialog({ itemId, current, suggestion, busy, onRetry, onClose, onSaved }: { itemId: string; current: Current; suggestion: Suggestion; busy: boolean; onRetry: () => void; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("content.studio");
  const err = useErr();
  const [mode, setMode] = useState<"view" | "merge" | "edit">("view");
  const [take, setTake] = useState<Record<Field, boolean>>({ hook: true, caption: true, cta: true, hashtags: true });
  const suggested: Current = { hook: suggestion.hook, caption: suggestion.caption, cta: suggestion.cta || null, hashtags: suggestion.hashtags };
  const [draft, setDraft] = useState(suggested);
  const [pending, start] = useTransition();
  const show = (f: Field, v: Current) => (f === "hashtags" ? v.hashtags.join(" ") : (v[f] as string | null) ?? "—");

  const save = (fields: Current, source: "ai_improve" | "ai_merge" | "ai_edit") =>
    start(async () => {
      const r = await applyVersionAction({
        id: itemId,
        fields,
        source,
        reasons: suggestion.reasons,
        platformNotes: suggestion.platform_notes || null,
        visualDirection: suggestion.visual_direction || null,
        quality: suggestion.quality,
        promptVersion: suggestion.promptVersion,
      });
      if (r.ok) {
        toast(t("compare.saved", { version: r.data.version }));
        onSaved();
      } else err(r.error);
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={t("compare.title")} size="xl">
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            {(["current", "suggested"] as const).map((side) => (
              <section key={side} className={cn("space-y-3 rounded-2xl border p-4", side === "suggested" ? "border-accent/40 bg-accent-soft/20" : "border-line")}>
                <h3 className="text-sm font-semibold">{t(`compare.${side}`)}</h3>
                {FIELDS.map((f) => (
                  <div key={f}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">{t(`fields.${f}`)}</p>
                      {mode === "merge" && side === "suggested" && <Checkbox label={t(`fields.${f}`)} checked={take[f]} onChange={(v) => setTake({ ...take, [f]: v })} />}
                    </div>
                    {mode === "edit" && side === "suggested" ? (
                      f === "caption" ? (
                        <Textarea rows={7} value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} dir="auto" aria-label={t(`fields.${f}`)} />
                      ) : (
                        <Input
                          value={f === "hashtags" ? draft.hashtags.join(" ") : ((draft[f] as string | null) ?? "")}
                          onChange={(e) => setDraft({ ...draft, [f]: f === "hashtags" ? e.target.value.split(/\s+/).filter(Boolean) : e.target.value })}
                          dir={f === "hashtags" ? "ltr" : "auto"}
                          aria-label={t(`fields.${f}`)}
                        />
                      )
                    ) : (
                      <p className="whitespace-pre-line text-sm" dir="auto">{show(f, side === "current" ? current : suggested)}</p>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="space-y-2 rounded-2xl bg-surface-2 p-4">
              <h3 className="text-sm font-semibold">{t("compare.why")}</h3>
              <ul className="list-disc space-y-1 ps-5 text-sm" dir="auto">
                {suggestion.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
              {suggestion.platform_notes && <p className="text-xs text-ink-3" dir="auto"><span className="font-semibold">{t("compare.platformNotes")}:</span> {suggestion.platform_notes}</p>}
              {suggestion.video_concept && <p className="text-xs text-ink-3" dir="auto"><span className="font-semibold">{t("compare.videoConcept")}:</span> {suggestion.video_concept}</p>}
              {suggestion.on_screen_text.length > 0 && <p className="text-xs text-ink-3" dir="auto"><span className="font-semibold">{t("compare.onScreen")}:</span> {suggestion.on_screen_text.join(" · ")}</p>}
              {suggestion.duplicates.length > 0 && <p className="text-xs text-warning">{t("compare.duplicate")}</p>}
            </section>
            <section className="space-y-2 rounded-2xl bg-surface-2 p-4">
              <h3 className="text-sm font-semibold">{t("quality.title")}</h3>
              <QualityList checks={suggestion.quality} />
            </section>
          </div>

          {mode === "merge" && <p className="text-sm text-ink-3">{t("compare.mergeHint")}</p>}
          <div className="flex flex-wrap gap-2">
            {mode === "view" && (
              <>
                <Button loading={pending} icon={<Check className="size-4" />} onClick={() => save(suggested, "ai_improve")}>{t("compare.use")}</Button>
                <Button variant="secondary" onClick={() => setMode("merge")}>{t("compare.merge")}</Button>
                <Button variant="secondary" onClick={() => setMode("edit")}>{t("compare.edit")}</Button>
              </>
            )}
            {mode === "merge" && (
              <Button loading={pending} onClick={() => save(Object.fromEntries(FIELDS.map((f) => [f, take[f] ? suggested[f] : current[f]])) as Current, "ai_merge")}>{t("compare.saveMerge")}</Button>
            )}
            {mode === "edit" && <Button loading={pending} disabled={!draft.caption.trim()} onClick={() => save(draft, "ai_edit")}>{t("compare.saveEdit")}</Button>}
            <Button variant="ghost" loading={busy} icon={<RefreshCw className="size-4" />} onClick={onRetry}>{t("compare.retry")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Asset = { id: string; status: string; mode: string | null; quality: string | null; preset: string | null; variant: string | null; instruction: string | null; isSelected: boolean; errorCode: string | null; ai: boolean; url: string | null; createdAt: string };
const PRESETS = ["square", "portrait", "story", "landscape", "facebook_landscape"] as const;
const VARIANTS = ["another", "different_style", "simpler", "more_professional", "no_text"] as const;

function StatusSteps({ status }: { status: string }) {
  const t = useTranslations("content.studio.design.steps");
  const order = ["QUEUED", "GENERATING", "UPLOADING", "COMPLETED"];
  const at = order.indexOf(status);
  const steps = [
    { key: "idea", done: at >= 1, current: at === 0 },
    { key: "direction", done: at >= 1, current: false },
    { key: "image", done: at >= 2, current: at === 1 },
    { key: "preview", done: at >= 3, current: at === 2 },
  ] as const;
  return (
    <ol className="space-y-1 text-sm" aria-live="polite">
      {steps.map((s) => (
        <li key={s.key} className={cn("flex items-center gap-2", s.done ? "text-success" : s.current ? "text-ink" : "text-ink-4")}>
          {s.done ? <Check className="size-4" /> : s.current ? <Loader2 className="size-4 animate-spin" /> : <Circle className="size-3.5" />}
          {t(s.key)}
        </li>
      ))}
    </ol>
  );
}

/** Design tools: generate / variants / edit — every result is a separate asset; nothing is deleted. */
export function DesignPanel({ itemId, platform, format, caps, initial }: { itemId: string; platform: string; format: string; caps: StudioCaps; initial: Asset[] }) {
  const t = useTranslations("content.studio");
  const err = useErr();
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>(initial);
  const [mode, setMode] = useState(caps.defaults.mode);
  const [quality, setQuality] = useState(caps.defaults.quality);
  const defaultPreset = format === "STORY" || format === "REEL" || format === "SHORT_VIDEO" ? "story" : platform === "LINKEDIN" ? "landscape" : "square";
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>(defaultPreset);
  const [editFor, setEditFor] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [pending, start] = useTransition();
  const active = assets.some((a) => ["QUEUED", "GENERATING", "UPLOADING"].includes(a.status));

  const load = useCallback(async () => {
    const r = await assetsAction({ id: itemId });
    if (r.ok) setAssets(r.data.assets);
  }, [itemId]);

  useEffect(() => {
    if (!active) return;
    let done = false;
    const id = setInterval(async () => {
      const r = await assetsAction({ id: itemId });
      if (!r.ok || done) return;
      setAssets(r.data.assets);
      if (!r.data.assets.some((a) => ["QUEUED", "GENERATING", "UPLOADING"].includes(a.status))) {
        done = true;
        router.refresh();
      }
    }, 2500);
    return () => {
      done = true;
      clearInterval(id);
    };
  }, [active, itemId, router]);

  const run = (opts: Parameters<typeof generateImageAction>[0]) =>
    start(async () => {
      const r = await generateImageAction(opts);
      if (r.ok) {
        toast(t("design.queued"));
        setEditFor(null);
        setInstruction("");
        await load();
      } else err(r.error);
    });

  if (!caps.image)
    return (
      <Card className="space-y-2 p-5">
        <h2 className="text-sm font-semibold">{t("designSection")}</h2>
        <p className="text-sm text-ink-3">{t("notConfiguredImage")}</p>
      </Card>
    );

  const inFlight = assets.find((a) => ["QUEUED", "GENERATING", "UPLOADING"].includes(a.status));
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("designSection")}</h2>
        <span className="text-xs tabular text-ink-3">{t("usage", { used: caps.usage.used, limit: caps.usage.limit })}</span>
      </div>
      <div className="space-y-3">
        <Segmented label={t("design.mode")} value={mode} onChange={setMode} size="sm" options={(["brand_template", "ai_creative"] as const).map((m) => ({ value: m, label: t(`design.modes.${m}`) }))} />
        <p className="text-xs text-ink-3">{t(`design.modeHint.${mode}`)}</p>
        <Segmented label={t("design.speed")} value={quality} onChange={setQuality} size="sm" options={(["fast", "quality"] as const).map((q) => ({ value: q, label: t(`design.speeds.${q}`) }))} />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-3">{t("design.size")}</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value as (typeof PRESETS)[number])} className="h-9 rounded-xl border border-line bg-surface px-2 text-sm">
            {PRESETS.map((p) => <option key={p} value={p}>{t(`design.presets.${p}`)}</option>)}
          </select>
        </label>
        <Button loading={pending} disabled={Boolean(inFlight)} icon={<Sparkles className="size-4 text-accent" />} onClick={() => run({ id: itemId, mode, quality, preset })}>{t("createDesign")}</Button>
      </div>

      {inFlight && (
        <div className="rounded-2xl bg-surface-2 p-4">
          <StatusSteps status={inFlight.status} />
        </div>
      )}

      {assets.length === 0 ? (
        <p className="text-sm text-ink-3">{t("design.empty")}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">{t("design.history")}</p>
          <ul className="grid grid-cols-2 gap-3">
            {assets.map((a) => (
              <li key={a.id} className={cn("space-y-2 rounded-2xl border p-2", a.isSelected ? "border-ink ring-1 ring-ink" : "border-line")}>
                <div className="relative aspect-square overflow-hidden rounded-xl bg-sunken">
                  {a.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed, private file URL
                    <img src={a.url} alt="" className="size-full object-cover" />
                  ) : a.status === "FAILED" ? (
                    <p className="p-3 text-xs text-danger">{t("design.failed")}</p>
                  ) : (
                    <div className="flex size-full items-center justify-center"><Loader2 className="size-5 animate-spin text-ink-3" /></div>
                  )}
                  <div className="absolute start-2 top-2 flex gap-1">
                    {a.ai && <Badge tone="accent">{t("design.ai")}</Badge>}
                    {a.isSelected && <Badge tone="success">{t("design.selected")}</Badge>}
                  </div>
                </div>
                <p className="truncate text-xs text-ink-3">{[a.mode && t(`design.modes.${a.mode === "edit" ? "ai_creative" : a.mode}` as "design.modes.ai_creative"), a.variant && t(`design.variant.${a.variant}` as "design.variant.another"), a.instruction].filter(Boolean).join(" · ")}</p>
                {a.status === "COMPLETED" && (
                  <div className="flex flex-wrap gap-1">
                    {!a.isSelected && <Button size="xs" variant="secondary" onClick={() => start(async () => { const r = await selectAssetAction({ id: itemId, assetId: a.id }); if (r.ok) { await load(); router.refresh(); } else err(r.error); })}>{t("design.use")}</Button>}
                    <Menu>
                      <MenuTrigger className="inline-flex h-7 items-center rounded-full border border-line px-2.5 text-xs font-medium hover:bg-sunken">{t("design.variants")}</MenuTrigger>
                      <MenuContent>
                        {VARIANTS.map((v) => (
                          <MenuItem key={v} onSelect={() => run({ id: itemId, variant: v, parentAssetId: a.id, quality, preset: (a.preset as (typeof PRESETS)[number]) ?? preset, mode: a.mode === "ai_creative" ? "ai_creative" : "brand_template" })}>{t(`design.variant.${v}`)}</MenuItem>
                        ))}
                        <MenuItem onSelect={() => setEditFor(a.id)}>{t("design.editTitle")}</MenuItem>
                      </MenuContent>
                    </Menu>
                  </div>
                )}
                {editFor === a.id && (
                  <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (instruction.trim().length >= 3) run({ id: itemId, parentAssetId: a.id, instruction: instruction.trim() }); }}>
                    <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t("design.editPlaceholder")} aria-label={t("design.editTitle")} dir="auto" />
                    <Button type="submit" size="xs" loading={pending} disabled={instruction.trim().length < 3}>{t("design.editRun")}</Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
