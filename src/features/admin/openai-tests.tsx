"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { openAiTestImageAction, openAiTestImageEditAction, openAiTestTextAction } from "./actions";

type CostRow = { task: string; basis: string; runs: number; costUsd: number; inputTokens: number; outputTokens: number };
type Pricing = { textInputPerM: number; imageInputPerM: number; imageOutputPerM: number; version: string };

/** Admin-only: live OpenAI checks and image cost details. Model names and token costs are visible here (and only here). */
export function OpenAiTests({ configured, textModel, imageModels, costs }: { configured: { text: boolean; image: boolean }; textModel: string; imageModels: { fast: string; quality: string }; costs: { pricing: Pricing; rows: CostRow[] } }) {
  const t = useTranslations("settings.admin.openai");
  const te = useTranslations("errors");
  const [text, setText] = useState<string | null>(null);
  const [image, setImage] = useState<{ url: string; model: string; detail: string } | null>(null);
  const [pending, start] = useTransition();
  const fail = (code: string) => toast.error(te.has(code as "unexpected") ? te(code as "unexpected") : code);
  return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface p-5" data-openai-tests>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-ink-3">{t("status")}</dt>
          <dd className="flex gap-1.5">
            <Badge tone={configured.text ? "success" : "neutral"}>{t("text")}: {configured.text ? t("configured") : t("missing")}</Badge>
            <Badge tone={configured.image ? "success" : "neutral"}>{t("image")}: {configured.image ? t("configured") : t("missing")}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">{t("textModel")}</dt>
          <dd className="font-mono text-xs" dir="ltr">{textModel}</dd>
        </div>
        <div>
          <dt className="text-ink-3">{t("imageModels")}</dt>
          <dd className="font-mono text-xs" dir="ltr">fast: {imageModels.fast}<br />quality: {imageModels.quality}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!configured.text} loading={pending} onClick={() => start(async () => {
          const r = await openAiTestTextAction();
          if (r.ok) setText(`${r.data.model} → "${r.data.reply}" (${r.data.inputTokens}/${r.data.outputTokens} tokens)`);
          else fail(r.error);
        })}>{t("testText")}</Button>
        {([["testImage", openAiTestImageAction], ["testImageEdit", openAiTestImageEditAction]] as const).map(([label, action]) => (
          <Button key={label} size="sm" variant="secondary" disabled={!configured.image} loading={pending} onClick={() => start(async () => {
            const r = await action();
            if (r.ok) {
              const c = r.data.cost;
              setImage({ url: r.data.url, model: r.data.model, detail: `${c.basis} · USD ${(Number(c.costMicro) / 1e6).toFixed(4)} · text ${c.usage.textInputTokens} / image-in ${c.usage.imageInputTokens} / out ${c.usage.outputTokens} tokens · ${c.pricingVersion}` });
            } else fail(r.error);
          })}>{t(label)}</Button>
        ))}
      </div>
      <p className="text-xs text-ink-4">{t("note")}</p>
      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-sm font-semibold">{t("costTitle")}</p>
        <p className="font-mono text-xs text-ink-3" dir="ltr">
          {costs.pricing.version}: text-in {"$"}{costs.pricing.textInputPerM} · image-in {"$"}{costs.pricing.imageInputPerM} · image-out {"$"}{costs.pricing.imageOutputPerM} / 1M tokens
        </p>
        {costs.rows.length === 0 ? (
          <p className="text-xs text-ink-4">{t("costEmpty")}</p>
        ) : (
          <table className="w-full text-xs" dir="ltr">
            <thead className="text-ink-3">
              <tr><th className="text-start">task</th><th className="text-start">basis</th><th className="text-end">runs</th><th className="text-end">input tok</th><th className="text-end">output tok</th><th className="text-end">USD</th></tr>
            </thead>
            <tbody className="font-mono">
              {costs.rows.map((r) => (
                <tr key={`${r.task}-${r.basis}`}><td>{r.task}</td><td>{r.basis}</td><td className="text-end">{r.runs}</td><td className="text-end">{r.inputTokens}</td><td className="text-end">{r.outputTokens}</td><td className="text-end">{r.costUsd.toFixed(4)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-ink-4">{t("costNote")}</p>
      </div>
      {text && <p className="rounded-xl bg-surface-2 px-3 py-2 font-mono text-xs" dir="ltr">{text}</p>}
      {image && (
        <figure className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed private test asset */}
          <img src={image.url} alt="" className="size-40 rounded-xl object-cover ring-1 ring-line" />
          <figcaption className="font-mono text-xs text-ink-3" dir="ltr">{image.model}<br />{image.detail}</figcaption>
        </figure>
      )}
    </div>
  );
}
