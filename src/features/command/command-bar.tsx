"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as D from "@radix-ui/react-dialog";
import { ArrowUp, FileText, ImageIcon, Mic, MicOff, Paperclip, Sparkles, X, History } from "lucide-react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/spinner";
import { closeCommand, openCommand, useCommandState } from "./store";
import { commandContextAction } from "./center-actions";
import { useCommandCenter } from "./use-command-center";
import { CommandResult } from "./command-result";

type Attachment = { id: string; name: string; mimeType: string; uploading?: boolean };

export function useCommandBar() {
  return { open: (text = "") => openCommand(text) };
}

// Minimal typing for the Web Speech API (voice-ready architecture).
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

const EXAMPLES = ["one", "two", "three", "four", "five", "six"] as const;

export function CommandBar({ controller }: { controller: ReturnType<typeof useCommandBar> }) {
  void controller;
  const t = useTranslations("common.command");
  const te = useTranslations("errors");
  const locale = useLocale();
  const state = useCommandState();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<{ id: string; text: string }[]>([]);
  const [listening, setListening] = useState(false);
  // Same pipeline as the Home command center: typed, spoken and attached commands all go through it.
  const cc = useCommandCenter({ onNavigate: closeCommand });
  const pending = cc.pending;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  // Global shortcut: ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openCommand();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = useCallback(
    (value: string) => {
      const v = value.trim();
      if (v.length < 2 || files.some((f) => f.uploading)) return;
      setError(null);
      const ids = files.map((f) => f.id);
      setFiles([]);
      setText("");
      void cc.submit(v, ids);
    },
    [files, cc],
  );

  // Reset / prefill when opened
  useEffect(() => {
    if (!state.open) return;
    let cancelled = false;
    // Deferred so the reset doesn't cascade synchronously inside the effect.
    queueMicrotask(() => {
      if (cancelled) return;
      cc.reset();
      setError(null);
      setText(state.text);
      if (state.autoSubmit && state.text) submit(state.text);
      else setTimeout(() => inputRef.current?.focus(), 50);
    });
    void commandContextAction({}).then((r) => !cancelled && r.ok && setRecent(r.data.history.slice(0, 4)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.nonce]);

  async function upload(list: FileList | null) {
    if (!list) return;
    for (const file of Array.from(list).slice(0, 5 - files.length)) {
      const temp: Attachment = { id: `tmp-${file.name}-${file.size}`, name: file.name, mimeType: file.type, uploading: true };
      setFiles((f) => [...f, temp]);
      const body = new FormData();
      body.append("file", file);
      body.append("purpose", "command");
      const res = await fetch("/api/uploads", { method: "POST", body });
      const json = await res.json().catch(() => ({ error: "unexpected" }));
      if (!res.ok) {
        setFiles((f) => f.filter((x) => x.id !== temp.id));
        setError(json.error ?? "unexpected");
      } else setFiles((f) => f.map((x) => (x.id === temp.id ? { id: json.id, name: json.name, mimeType: json.mimeType } : x)));
    }
  }

  function toggleVoice() {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) {
      setError("voice");
      return;
    }
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = locale === "ar" ? "ar-SA" : "en-US";
    r.interimResults = true;
    r.continuous = false;
    const base = text ? `${text} ` : "";
    r.onresult = (e) => setText(base + Array.from(e.results).map((x) => x[0].transcript).join(""));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognition.current = r;
    setListening(true);
    r.start();
  }

  return (
    <D.Root open={state.open} onOpenChange={(o) => (o ? openCommand() : closeCommand())}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm data-[state=open]:animate-[fade-up_.2s_ease-out]" />
        <D.Content
          className="fixed inset-x-0 bottom-0 top-auto z-50 flex max-h-[94dvh] flex-col rounded-t-[20px] border border-line bg-canvas shadow-lg focus:outline-none sm:inset-x-auto sm:start-1/2 sm:top-[8vh] sm:bottom-auto sm:w-[min(760px,92vw)] sm:rounded-2xl ltr:sm:-translate-x-1/2 rtl:sm:translate-x-1/2 data-[state=open]:animate-[fade-up_.3s_var(--ease-out-soft)]"
          aria-describedby={undefined}
        >
          <D.Title className="sr-only">{t("dialogTitle")}</D.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(text);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void upload(e.dataTransfer.files);
            }}
            className="m-3 rounded-2xl border border-line bg-surface shadow-sm transition focus-within:border-accent/60 focus-within:shadow-[var(--ring)]"
          >
            <div className="flex items-start gap-3 px-4 pt-4">
              <Sparkles className="mt-1 size-5 shrink-0 text-accent" aria-hidden />
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit(text);
                  }
                }}
                rows={2}
                maxLength={2000}
                placeholder={t("placeholder")}
                aria-label={t("dialogTitle")}
                className="min-h-14 w-full resize-none bg-transparent text-[17px] leading-relaxed text-ink placeholder:text-ink-4 focus:outline-none"
              />
            </div>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pt-2">
                {files.map((f) => (
                  <span key={f.id} className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface-2 ps-2.5 pe-1 text-xs text-ink-2">
                    {f.uploading ? <Spinner className="size-3.5" /> : f.mimeType.startsWith("image/") ? <ImageIcon className="size-3.5" /> : <FileText className="size-3.5" />}
                    <span className="max-w-40 truncate">{f.name}</span>
                    <button type="button" className="rounded-full p-1 hover:bg-sunken" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label={`Remove ${f.name}`}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-2">
              <input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.csv,.json,.pdf" onChange={(e) => void upload(e.target.files)} />
              <button type="button" onClick={() => fileRef.current?.click()} className="rounded-full p-2 text-ink-3 transition hover:bg-sunken hover:text-ink" aria-label={t("attach")}>
                <Paperclip className="size-[18px]" />
              </button>
              <button
                type="button"
                onClick={toggleVoice}
                className={cn("rounded-full p-2 transition hover:bg-sunken", listening ? "text-accent" : "text-ink-3 hover:text-ink")}
                aria-label={listening ? t("listening") : t("voice")}
                aria-pressed={listening}
              >
                {listening ? <MicOff className="size-[18px]" /> : <Mic className="size-[18px]" />}
              </button>
              {listening && <span className="text-xs font-medium text-accent">{t("listening")}</span>}
              <button
                type="submit"
                disabled={pending || text.trim().length < 2}
                className="ms-auto flex size-10 items-center justify-center rounded-full bg-ink text-ink-inverse transition hover:bg-ink/85 disabled:opacity-30"
                aria-label={t("send")}
              >
                {pending ? <Spinner className="size-4" /> : <ArrowUp className="size-[18px]" />}
              </button>
            </div>
          </form>

          {error && (
            <p role="alert" className="mx-5 mb-2 rounded-xl bg-danger-soft px-4 py-2.5 text-sm text-danger">
              {error === "voice" ? t("voiceUnavailable") : te(error as "unexpected")}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            {cc.phase !== "idle" ? (
              <div className="pt-1">
                <CommandResult
                  phase={cc.phase}
                  result={cc.result}
                  error={cc.error}
                  onReply={(a) => void cc.reply(a)}
                  onCommand={(v) => submit(v)}
                  onEdit={() => {
                    setText(cc.lastText ?? "");
                    cc.reset();
                    inputRef.current?.focus();
                  }}
                  onDismiss={cc.reset}
                  onLinkClick={closeCommand}
                />
              </div>
            ) : (
              <div className="grid gap-6 pt-2 sm:grid-cols-[1.4fr_1fr]">
                <section>
                  <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-4">{t("suggestions")}</h3>
                  <ul className="space-y-1">
                    {EXAMPLES.map((k) => (
                      <li key={k}>
                        <button
                          type="button"
                          onClick={() => {
                            setText(t(`examples.${k}`));
                            submit(t(`examples.${k}`));
                          }}
                          className="w-full rounded-xl px-3 py-2.5 text-start text-[14px] text-ink-2 transition hover:bg-surface hover:text-ink hover:shadow-xs"
                        >
                          {t(`examples.${k}`)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
                {recent.length > 0 && (
                  <section>
                    <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-4">{t("recent")}</h3>
                    <ul className="space-y-1">
                      {recent.map((r) => (
                        <li key={r.id}>
                          <button type="button" onClick={() => submit(r.text)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-[13px] text-ink-3 transition hover:bg-surface hover:text-ink">
                            <History className="size-3.5 shrink-0" />
                            <span className="truncate" dir="auto">{r.text}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
