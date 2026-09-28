"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, History, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/spinner";
import { CommandResult } from "@/features/command/command-result";
import { useCommandCenter } from "@/features/command/use-command-center";

export type CommandHistoryItem = { id: string; text: string };

/**
 * The hero's command input — NOVA's Command Center. Enter runs the command through the server pipeline
 * (intent → permission → action → approval → result); the result card appears right below.
 * Ctrl/⌘K focuses it, ↑ recalls previous commands, Esc clears.
 */
export function GlobalCommandInput({ suggestions = [], history: initialHistory = [] }: { suggestions?: string[]; history?: CommandHistoryItem[] }) {
  const t = useTranslations("app.home");
  const tc = useTranslations("common.cmd");
  const cc = useCommandCenter();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<string[]>(() => initialHistory.map((h) => h.text));
  const [cursor, setCursor] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Ctrl/⌘K on Home focuses this input (captured before the global ⌘K dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopImmediatePropagation();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const run = async (text: string) => {
    const v = text.trim();
    if (v.length < 2 || cc.pending) return;
    setOpen(false);
    setCursor(-1);
    setHistory((h) => [v, ...h.filter((x) => x !== v)].slice(0, 8));
    setValue("");
    await cc.submit(v);
  };

  const showPanel = open && !cc.pending && !value && (suggestions.length > 0 || history.length > 0);

  return (
    <div ref={boxRef} className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(value);
        }}
        aria-busy={cc.pending}
        data-command-active={open || cc.pending ? "true" : undefined}
        className={cn(
          "flex h-[64px] w-full items-center gap-3 rounded-[20px] border border-[var(--nova-line)] bg-surface ps-3 pe-2 shadow-[0_10px_30px_-14px_rgba(30,70,140,.28)] transition focus-within:border-nova-blue-line focus-within:shadow-[0_0_0_4px_var(--nova-blue-soft)]",
          cc.pending && "border-nova-blue-line",
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-nova-blue-soft text-nova-blue" aria-hidden>
          {cc.pending ? <Spinner className="size-5" /> : <Sparkles className="size-5" />}
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setCursor(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              if (open) setOpen(false);
              else if (value) setValue("");
              else cc.reset();
              if (!value && !open) inputRef.current?.blur();
            } else if (e.key === "ArrowUp" && history.length && (!value || cursor >= 0)) {
              e.preventDefault();
              const next = Math.min(cursor + 1, history.length - 1);
              setCursor(next);
              setValue(history[next]);
            } else if (e.key === "ArrowDown" && cursor >= 0) {
              e.preventDefault();
              const next = cursor - 1;
              setCursor(next);
              setValue(next >= 0 ? history[next] : "");
            }
          }}
          readOnly={cc.pending}
          maxLength={2000}
          placeholder={t("commandPlaceholder")}
          aria-label={t("commandLabel")}
          aria-expanded={showPanel}
          aria-controls="home-command-panel"
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-4 focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-4 lg:inline" dir="ltr">
          {tc("shortcut")}
        </kbd>
        <button
          type="submit"
          disabled={cc.pending}
          className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-nova-navy text-white shadow-md transition hover:brightness-110 disabled:opacity-60"
          aria-label={t("commandSend")}
        >
          {cc.pending ? <Spinner className="size-5" /> : <ArrowUp className="size-5" strokeWidth={2.4} />}
        </button>
      </form>

      {showPanel && (
        <div id="home-command-panel" className="mt-2 grid gap-4 rounded-[18px] border border-[var(--nova-line)] bg-surface p-3 text-start shadow-sm sm:grid-cols-2">
          {suggestions.length > 0 && (
            <section>
              <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-4">{tc("suggestions")}</h3>
              <ul>
                {suggestions.map((s) => (
                  <li key={s}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void run(s)} className="w-full rounded-xl px-2 py-2 text-start text-sm text-ink-2 transition hover:bg-sunken hover:text-ink">
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {history.length > 0 && (
            <section>
              <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-4">{tc("history")}</h3>
              <ul>
                {history.slice(0, 6).map((h) => (
                  <li key={h}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void run(h)}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-start text-sm text-ink-3 transition hover:bg-sunken hover:text-ink"
                      aria-label={`${tc("rerun")}: ${h}`}
                    >
                      <History className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate" dir="auto">{h}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {cc.phase !== "idle" && (
        <div className="mt-3">
          <CommandResult
            phase={cc.phase}
            result={cc.result}
            error={cc.error}
            onReply={(a) => void cc.reply(a)}
            onCommand={(text) => void run(text)}
            onEdit={() => {
              setValue(cc.lastText ?? "");
              cc.reset();
              inputRef.current?.focus();
            }}
            onDismiss={cc.reset}
          />
        </div>
      )}
    </div>
  );
}
