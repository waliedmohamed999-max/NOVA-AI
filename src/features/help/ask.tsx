"use client";

import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { openCommand } from "@/features/command/store";

export function HelpAsk() {
  const t = useTranslations("settings.help");
  return (
    <button onClick={() => openCommand()} className="rounded-2xl border border-line bg-surface p-5 text-start transition hover:shadow-md">
      <Sparkles className="size-5 text-accent" />
      <div className="mt-3 font-semibold">{t("ask")}</div>
      <p className="text-sm text-ink-3">{t("askBody")}</p>
    </button>
  );
}
