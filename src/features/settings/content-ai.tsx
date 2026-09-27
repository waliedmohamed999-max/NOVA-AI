"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
import { Section, useAct } from "./ui";
import { saveContentAiDefaults } from "./actions";

type Props = {
  canEdit: boolean;
  status: { text: boolean; image: boolean };
  /** Customers see design consumption only — token and cost details are admin-only. */
  usage: { images: number; limit: number };
  initial: { imageQuality: "fast" | "quality"; imageMode: "brand_template" | "ai_creative" };
};

function StatusRow({ ok, label, on, off }: { ok: boolean; label: string; on: string; off: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="size-4 text-success" /> : <CircleDashed className="size-4 text-ink-4" />}
      <span className="font-medium">{label}</span>
      <span className={ok ? "text-success" : "text-ink-3"}>· {ok ? on : off}</span>
    </li>
  );
}

/** Settings → AI Team → Content AI. Status only for customers — no keys, no model names. */
export function ContentAiSettings({ canEdit, status, usage, initial }: Props) {
  const t = useTranslations("settings.contentAi");
  const tc = useTranslations("common");
  const { act, pending } = useAct();
  const [s, setS] = useState(initial);
  return (
    <Section
      title={t("title")}
      description={t("description")}
      footer={canEdit && <Button loading={pending} onClick={() => act(() => saveContentAiDefaults(s), t("saved"))}>{tc("actions.save")}</Button>}
    >
      <div className="space-y-5">
        <ul className="space-y-2">
          <StatusRow ok={status.text} label={t("textAi")} on={t("on")} off={t("off")} />
          <StatusRow ok={status.image} label={t("imageAi")} on={t("on")} off={t("off")} />
        </ul>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("defaultQuality")}</p>
            <Segmented label={t("defaultQuality")} value={s.imageQuality} onChange={(v) => canEdit && setS({ ...s, imageQuality: v })} size="sm" options={[{ value: "fast", label: t("fast") }, { value: "quality", label: t("quality") }]} />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("defaultMode")}</p>
            <Segmented label={t("defaultMode")} value={s.imageMode} onChange={(v) => canEdit && setS({ ...s, imageMode: v })} size="sm" options={[{ value: "brand_template", label: t("brandTemplate") }, { value: "ai_creative", label: t("aiCreative") }]} />
          </div>
        </div>
        <div className="rounded-2xl bg-surface-2 p-4 text-sm">
          <p className="text-ink-3">{t("imagesUsed")}</p>
          <p className="font-semibold tabular">{t("imagesUsedValue", { used: usage.images, limit: usage.limit })}</p>
        </div>
      </div>
    </Section>
  );
}
