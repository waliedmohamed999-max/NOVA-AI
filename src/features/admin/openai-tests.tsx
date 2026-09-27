"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { openAiTestImageAction, openAiTestTextAction } from "./actions";

/** Admin-only: live OpenAI checks. Model names are visible here (and only here). */
export function OpenAiTests({ configured, textModel, imageModels }: { configured: { text: boolean; image: boolean }; textModel: string; imageModels: { fast: string; quality: string } }) {
  const t = useTranslations("settings.admin.openai");
  const te = useTranslations("errors");
  const [text, setText] = useState<string | null>(null);
  const [image, setImage] = useState<{ url: string; model: string } | null>(null);
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
        <Button size="sm" variant="secondary" disabled={!configured.image} loading={pending} onClick={() => start(async () => {
          const r = await openAiTestImageAction();
          if (r.ok) setImage({ url: r.data.url, model: r.data.model });
          else fail(r.error);
        })}>{t("testImage")}</Button>
      </div>
      <p className="text-xs text-ink-4">{t("note")}</p>
      {text && <p className="rounded-xl bg-surface-2 px-3 py-2 font-mono text-xs" dir="ltr">{text}</p>}
      {image && (
        <figure className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed private test asset */}
          <img src={image.url} alt="" className="size-40 rounded-xl object-cover ring-1 ring-line" />
          <figcaption className="font-mono text-xs text-ink-3" dir="ltr">{image.model}</figcaption>
        </figure>
      )}
    </div>
  );
}
