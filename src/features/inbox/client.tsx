"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowUp, CheckCheck, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { INBOX_CHANNEL_KEYS } from "./channels";
import { replyAction, setStatusAction } from "./actions";

/** Search box + channel picker; both live in the URL so the list stays server-rendered and shareable. */
export function InboxToolbar({ q, channel }: { q: string; channel: string }) {
  const t = useTranslations("settings.inbox");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(q);
  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k);
    next.delete("cursor");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  useEffect(() => {
    if (value === q) return;
    const id = setTimeout(() => push({ q: value.trim() || null }), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="flex gap-2">
      <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface px-3 focus-within:border-line-strong">
        <Search className="size-4 shrink-0 text-ink-4" aria-hidden />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-4 focus:outline-none" />
      </label>
      <select value={channel} onChange={(e) => push({ ch: e.target.value || null })} aria-label={t("channelFilter")} className="h-10 max-w-[45%] rounded-[10px] border border-line bg-surface px-2 text-sm text-ink-2">
        <option value="">{t("allChannels")}</option>
        {INBOX_CHANNEL_KEYS.map((c) => (
          <option key={c} value={c}>
            {t(`channels.${c}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Keeps the newest message in view when a thread opens or a reply lands. */
export function ScrollToEnd({ dep }: { dep: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [dep]);
  return <div ref={ref} />;
}

/** Reply box: sends through the conversation's own channel, or explains why it can't. */
export function Composer({ conversationId, blocked, via, canManage }: { conversationId: string; blocked: string | null; via: string | null; canManage: boolean }) {
  const t = useTranslations("settings.inbox");
  const te = useTranslations("errors");
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      const r = await replyAction({ conversationId, body: text });
      if (r.ok) {
        setText("");
        router.refresh();
      } else toast.error(te((r.error ?? "unexpected") as "unexpected"));
    });
  if (!canManage) return <p className="px-4 py-3 text-sm text-ink-3">{t("readOnly")}</p>;
  if (blocked) return <p className="rounded-[10px] bg-warning-soft px-4 py-3 text-sm text-warning">{t(`blocked.${blocked}` as "blocked.no_recipient")}</p>;
  return (
    <div>
      <div className="flex items-end gap-2 rounded-[14px] border border-line bg-surface p-2 focus-within:border-line-strong">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && !pending) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={8000}
          placeholder={t("replyPlaceholder")}
          aria-label={t("replyPlaceholder")}
          dir="auto"
          className="max-h-48 min-h-[44px] min-w-0 flex-1 resize-y bg-transparent px-2 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:outline-none"
        />
        <Button size="icon" loading={pending} disabled={!text.trim()} onClick={send} aria-label={t("send")} icon={<ArrowUp className="size-4" strokeWidth={2.4} />} />
      </div>
      {via && <p className="mt-1.5 px-1 text-xs text-ink-4">{t("via", { via })}</p>}
    </div>
  );
}

export function StatusButton({ conversationId, closed }: { conversationId: string; closed: boolean }) {
  const t = useTranslations("settings.inbox");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await setStatusAction({ conversationId, status: closed ? "OPEN" : "CLOSED" });
          if (r.ok) {
            toast(closed ? t("reopened") : t("closedToast"));
            router.refresh();
          } else toast.error(te((r.error ?? "unexpected") as "unexpected"));
        })
      }
      className="shrink-0"
      aria-label={closed ? t("reopen") : t("close")}
      icon={closed ? <RotateCcw className="size-4" /> : <CheckCheck className="size-4" />}
    >
      <span className="hidden sm:inline">{closed ? t("reopen") : t("close")}</span>
    </Button>
  );
}
