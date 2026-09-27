"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Sparkles } from "lucide-react";
import { openCommand } from "@/features/command/store";

/** The hero's large AI input. Submits to the existing agent command system (command bar + runs). */
export function GlobalCommandInput() {
  const t = useTranslations("app.home");
  const [value, setValue] = useState("");
  const submit = () => {
    const text = value.trim();
    openCommand(text, { autoSubmit: text.length >= 2 });
    setValue("");
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex h-[64px] w-full items-center gap-3 rounded-[20px] border border-[var(--nova-line)] bg-surface ps-3 pe-2 shadow-[0_10px_30px_-14px_rgba(30,70,140,.28)] transition focus-within:border-nova-blue-line focus-within:shadow-[0_0_0_4px_var(--nova-blue-soft)]"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-nova-blue-soft text-nova-blue" aria-hidden>
        <Sparkles className="size-5" />
      </span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("commandPlaceholder")}
        aria-label={t("commandLabel")}
        className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-4 focus:outline-none"
      />
      <button type="submit" className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-nova-navy text-white shadow-md transition hover:brightness-110" aria-label={t("commandSend")}>
        <ArrowUp className="size-5" strokeWidth={2.4} />
      </button>
    </form>
  );
}
