"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { saveBrandKit } from "./actions";

type Kit = {
  tone: string;
  voiceTraits: string[];
  primaryColors: string[];
  secondaryColors: string[];
  headingFont: string;
  bodyFont: string;
  imageStyle: string;
  layoutRules: string[];
  forbiddenStyles: string[];
  doSay: string[];
  dontSay: string[];
};

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function BrandKitEditor({ kit, templates, canManage, logoUrl }: { kit: Kit; templates: { id: string; name: string; format: string; spec: { width: number; height: number } }[]; canManage: boolean; logoUrl: string | null }) {
  const t = useTranslations("settings.brand");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [k, setK] = useState({ ...kit, layoutRules: kit.layoutRules.join("\n"), forbiddenStyles: kit.forbiddenStyles.join("\n"), doSay: kit.doSay.join("\n"), dontSay: kit.dontSay.join("\n"), voiceTraits: kit.voiceTraits.join(", ") });
  const [logo, setLogo] = useState<{ id: string; url: string } | null>(null);

  const save = () =>
    start(async () => {
      const r = await saveBrandKit({
        tone: k.tone,
        voiceTraits: k.voiceTraits.split(",").map((x) => x.trim()).filter(Boolean),
        primaryColors: k.primaryColors,
        secondaryColors: k.secondaryColors,
        headingFont: k.headingFont,
        bodyFont: k.bodyFont,
        imageStyle: k.imageStyle,
        layoutRules: lines(k.layoutRules),
        forbiddenStyles: lines(k.forbiddenStyles),
        doSay: lines(k.doSay),
        dontSay: lines(k.dontSay),
        ...(logo ? { logoFileId: logo.id } : {}),
      });
      if (r.ok) {
        toast(t("saved"));
        router.refresh();
      } else toast.error(te(r.error as "unexpected"));
    });

  async function uploadLogo(file: File) {
    const body = new FormData();
    body.append("file", file);
    body.append("purpose", "logo");
    const res = await fetch("/api/uploads", { method: "POST", body });
    const json = await res.json();
    if (!res.ok) return toast.error(te(json.error ?? "unexpected"));
    setLogo({ id: json.id, url: json.url });
  }


  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <Card className="space-y-5 p-6">
          <h2 className="text-sm font-semibold">{t("identity")}</h2>
          <div className="flex items-center gap-4">
            <div className="flex size-20 items-center justify-center overflow-hidden rounded-2xl bg-sunken ring-1 ring-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {(logo?.url ?? logoUrl) ? <img src={logo?.url ?? logoUrl!} alt="" className="size-full object-contain" /> : <span className="text-xs text-ink-4">{t("logo")}</span>}
            </div>
            {canManage && (
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">
                <Upload className="size-4" /> {t("uploadLogo")}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])} />
              </label>
            )}
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2"><p className="text-[13px] font-medium text-ink-2">{t("primaryColors")}</p><ColorList colors={k.primaryColors} label={t("primaryColors")} canManage={canManage} onChange={(v) => setK({ ...k, primaryColors: v })} /></div>
            <div className="space-y-2"><p className="text-[13px] font-medium text-ink-2">{t("secondaryColors")}</p><ColorList colors={k.secondaryColors} label={t("secondaryColors")} canManage={canManage} onChange={(v) => setK({ ...k, secondaryColors: v })} /></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("headingFont")}>{(f) => <Input {...f} value={k.headingFont} disabled={!canManage} onChange={(e) => setK({ ...k, headingFont: e.target.value })} />}</Field>
            <Field label={t("bodyFont")}>{(f) => <Input {...f} value={k.bodyFont} disabled={!canManage} onChange={(e) => setK({ ...k, bodyFont: e.target.value })} />}</Field>
          </div>
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="text-sm font-semibold">{t("voice")}</h2>
          <Field label={t("tone")}>{(f) => <Input {...f} value={k.tone} disabled={!canManage} onChange={(e) => setK({ ...k, tone: e.target.value })} dir="auto" />}</Field>
          <Field label={t("traits")} hint={t("commaHint")}>{(f) => <Input {...f} value={k.voiceTraits} disabled={!canManage} onChange={(e) => setK({ ...k, voiceTraits: e.target.value })} dir="auto" />}</Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("doSay")} hint={t("lineHint")}>{(f) => <Textarea {...f} rows={4} value={k.doSay} disabled={!canManage} onChange={(e) => setK({ ...k, doSay: e.target.value })} dir="auto" />}</Field>
            <Field label={t("dontSay")} hint={t("lineHint")}>{(f) => <Textarea {...f} rows={4} value={k.dontSay} disabled={!canManage} onChange={(e) => setK({ ...k, dontSay: e.target.value })} dir="auto" />}</Field>
          </div>
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="text-sm font-semibold">{t("visuals")}</h2>
          <Field label={t("imageStyle")}>{(f) => <Textarea {...f} rows={2} value={k.imageStyle} disabled={!canManage} onChange={(e) => setK({ ...k, imageStyle: e.target.value })} dir="auto" />}</Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("layoutRules")} hint={t("lineHint")}>{(f) => <Textarea {...f} rows={4} value={k.layoutRules} disabled={!canManage} onChange={(e) => setK({ ...k, layoutRules: e.target.value })} dir="auto" />}</Field>
            <Field label={t("forbidden")} hint={t("lineHint")}>{(f) => <Textarea {...f} rows={4} value={k.forbiddenStyles} disabled={!canManage} onChange={(e) => setK({ ...k, forbiddenStyles: e.target.value })} dir="auto" />}</Field>
          </div>
        </Card>
        {canManage && <Button size="lg" loading={pending} onClick={save}>{t("save")}</Button>}
      </div>

      <aside className="space-y-4">
        <Card className="p-6">
          <h2 className="mb-1 text-sm font-semibold">{t("templates")}</h2>
          <p className="mb-4 text-xs text-ink-3">{t("templatesHint")}</p>
          <ul className="grid grid-cols-2 gap-3">
            {templates.map((tpl) => (
              <li key={tpl.id} className="space-y-1.5">
                <div className="mx-auto w-full overflow-hidden rounded-xl ring-1 ring-line" style={{ aspectRatio: `${tpl.spec.width}/${tpl.spec.height}`, maxHeight: 140, background: `linear-gradient(145deg, ${k.primaryColors[0] ?? "#17161c"}, ${k.secondaryColors[0] ?? k.primaryColors[1] ?? "#f7f5f1"})` }} />
                <div className="text-xs font-medium">{tpl.name}</div>
                <div className="text-[11px] tabular text-ink-4" dir="ltr">{tpl.spec.width}×{tpl.spec.height}</div>
              </li>
            ))}
          </ul>
        </Card>
        <p className="text-xs text-ink-4">{t("designNote")}</p>
      </aside>
    </div>
  );
}

function ColorList({ colors, label, canManage, onChange }: { colors: string[]; label: string; canManage: boolean; onChange: (v: string[]) => void }) {
  const tc = useTranslations("common");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {colors.map((c, i) => (
        <span key={i} className="group relative">
          <label className="block size-12 cursor-pointer overflow-hidden rounded-xl ring-1 ring-line" style={{ background: c }}>
            <input type="color" className="opacity-0" value={c.length === 7 ? c : "#000000"} disabled={!canManage} onChange={(e) => onChange(colors.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`${label} ${i + 1}`} />
          </label>
          {canManage && (
            <button type="button" className="absolute -end-1.5 -top-1.5 hidden rounded-full bg-ink p-0.5 text-ink-inverse group-hover:block" onClick={() => onChange(colors.filter((_, j) => j !== i))} aria-label={tc("actions.remove")}>
              <X className="size-3" />
            </button>
          )}
          <span className="mt-1 block text-center text-[10px] uppercase text-ink-4" dir="ltr">{c}</span>
        </span>
      ))}
      {canManage && colors.length < 4 && (
        <button type="button" onClick={() => onChange([...colors, "#888888"])} className="flex size-12 items-center justify-center rounded-xl border border-dashed border-line-strong text-ink-3" aria-label={tc("actions.add")}>
          <Plus className="size-4" />
        </button>
      )}
    </div>
  );
}
