"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ImagePlus, Loader2, Megaphone, Plus, Tag, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { CONTENT_STYLES, CTA_STYLES, TONES, VISUAL_STYLES, label, type ContentStyle, type CtaStyle, type Tone, type VisualStyle } from "@/lib/onboarding-setup";
import { uploadLogoAction } from "../actions";
import { useSetup } from "./state";
import { StepFooter } from "./footer";
import { GroupLabel, Pill, QuestionRow, StepCard } from "./ui";

export function BrandStep() {
  const t = useTranslations("onboarding.setup.brand");
  const te = useTranslations("errors");
  const s = useSetup();
  const b = s.answers.brand ?? {};
  const colors = s.answers.colors ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const logoId = useId();
  const [logo, setLogo] = useState<string | null>(s.logoUrl);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [uploading, start] = useTransition();
  const toggle = <T extends string>(list: T[] | undefined, v: T) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);

  const upload = (file: File) =>
    start(async () => {
      setLogoError(null);
      if (file.size > 2 * 1024 * 1024) return setLogoError("file_too_large");
      await s.flush();
      const form = new FormData();
      form.set("file", file);
      const r = await uploadLogoAction(form);
      if (r.ok) setLogo(r.data.url);
      else setLogoError(r.error ?? "unexpected");
    });

  return (
    <StepCard icon={<Tag />} title={t("title")} subtitle={t("subtitle")} footer={<StepFooter step="brand" />}>
      {s.brandPrefilled && <p className="rounded-2xl bg-nova-blue-soft px-4 py-3 text-sm text-nova-blue">{t("prefilled")}</p>}
      <div className="space-y-4 rounded-3xl border border-accent/15 bg-[linear-gradient(135deg,var(--surface)_0%,var(--accent-soft)_140%)] p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Megaphone className="size-5" />
          </span>
          <GroupLabel hint={t("voice.hint")}>{t("voice.q")}</GroupLabel>
        </div>
        <div className="flex flex-wrap gap-2.5" role="group" aria-label={t("voice.q")}>
          {(Object.keys(TONES) as Tone[]).map((k) => (
            <Pill key={k} selected={Boolean(b.tones?.includes(k))} onClick={() => s.update("brand", { tones: toggle(b.tones, k) }, { immediate: true })}>
              {label(TONES[k], s.lang)}
            </Pill>
          ))}
        </div>
      </div>

      <div className="space-y-5 rounded-3xl border border-nova-line p-4 sm:p-6">
        <QuestionRow label={t("colors.q")} done={colors.length > 0}>
          <div className="flex flex-wrap items-center gap-2.5">
            {colors.map((c, i) => (
              <span key={i} className="group relative">
                <label className="relative block size-12 cursor-pointer overflow-hidden rounded-2xl border border-nova-line shadow-xs" style={{ background: c }}>
                  <input type="color" value={c} onChange={(e) => s.update("brand", { colors: colors.map((x, j) => (j === i ? e.target.value : x)) })} className="absolute inset-0 cursor-pointer opacity-0" aria-label={t("colors.color", { n: i + 1 })} />
                </label>
                <button type="button" onClick={() => s.update("brand", { colors: colors.filter((_, j) => j !== i) }, { immediate: true })} className="absolute -end-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-ink-inverse opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100" aria-label={t("colors.remove")}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {colors.length < 4 && (
              <button type="button" onClick={() => s.update("brand", { colors: [...colors, colors.length ? "#0091ff" : "#6647f0"] }, { immediate: true })} className="flex size-12 items-center justify-center rounded-2xl border border-dashed border-line-strong text-ink-3 hover:text-ink" aria-label={t("colors.add")}>
                <Plus className="size-4" />
              </button>
            )}
          </div>
        </QuestionRow>

        <QuestionRow label={t("logo.q")} hint={t("logo.hint")} done={Boolean(logo)} htmlFor={logoId}>
          <div className="flex flex-wrap items-center gap-3">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={t("logo.alt")} className="size-14 rounded-2xl border border-nova-line bg-surface object-contain p-1.5" />
            )}
            <input
              ref={fileRef}
              id={logoId}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex h-11 items-center gap-2 rounded-2xl border border-nova-line bg-surface px-4 text-sm font-semibold text-ink transition hover:border-nova-blue-line disabled:opacity-60">
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              {uploading ? t("logo.uploading") : logo ? t("logo.replace") : t("logo.upload")}
            </button>
            {logoError && (
              <p role="alert" className="w-full text-xs font-medium text-danger">
                {te(logoError as "unexpected")}
              </p>
            )}
          </div>
        </QuestionRow>

        <QuestionRow label={t("visual.q")} done={Boolean(b.visualStyle)}>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("visual.q")}>
            {(Object.keys(VISUAL_STYLES) as VisualStyle[]).map((k) => (
              <Pill key={k} selected={b.visualStyle === k} onClick={() => s.update("brand", { visualStyle: b.visualStyle === k ? null : k }, { immediate: true })}>
                {label(VISUAL_STYLES[k], s.lang)}
              </Pill>
            ))}
          </div>
        </QuestionRow>

        <QuestionRow label={t("contentStyle.q")} done={Boolean(b.contentStyles?.length)}>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("contentStyle.q")}>
            {(Object.keys(CONTENT_STYLES) as ContentStyle[]).map((k) => (
              <Pill key={k} selected={Boolean(b.contentStyles?.includes(k))} onClick={() => s.update("brand", { contentStyles: toggle(b.contentStyles, k) }, { immediate: true })}>
                {label(CONTENT_STYLES[k], s.lang)}
              </Pill>
            ))}
          </div>
        </QuestionRow>

        <QuestionRow label={t("cta.q")} done={Boolean(b.ctaStyle)}>
          <div className={cn("flex flex-wrap gap-2")} role="radiogroup" aria-label={t("cta.q")}>
            {(Object.keys(CTA_STYLES) as CtaStyle[]).map((k) => (
              <Pill key={k} selected={b.ctaStyle === k} onClick={() => s.update("brand", { ctaStyle: b.ctaStyle === k ? null : k }, { immediate: true })}>
                {label(CTA_STYLES[k], s.lang)}
              </Pill>
            ))}
          </div>
        </QuestionRow>
      </div>
    </StepCard>
  );
}
