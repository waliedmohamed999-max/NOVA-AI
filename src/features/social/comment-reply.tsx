"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Reply, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { replyCommentAction } from "./actions";

/** Inline public reply under a comment, posted as the connected account. */
export function CommentReply({ accountId, commentId }: { accountId: string; commentId: string }) {
  const t = useTranslations("settings.social.comments");
  const te = useTranslations("errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  if (!open)
    return (
      <Button variant="ghost" size="sm" icon={<Reply className="size-4 flip-rtl" />} onClick={() => setOpen(true)}>
        {t("reply")}
      </Button>
    );
  const send = () =>
    start(async () => {
      const r = await replyCommentAction({ accountId, commentId, message: text });
      if (r.ok) {
        toast(t("replied"));
        setText("");
        setOpen(false);
        router.refresh();
      } else toast.error(te((r.error ?? "unexpected") as "unexpected"));
    });
  return (
    <div className="mt-2 flex items-end gap-2">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && !pending) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        rows={2}
        maxLength={2000}
        dir="auto"
        placeholder={t("replyPlaceholder")}
        aria-label={t("replyPlaceholder")}
        className="min-h-[44px] min-w-0 flex-1 resize-y rounded-[10px] border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
      />
      <Button size="icon" loading={pending} disabled={!text.trim()} onClick={send} aria-label={t("send")} icon={<Send className="size-4 flip-rtl" />} />
    </div>
  );
}
