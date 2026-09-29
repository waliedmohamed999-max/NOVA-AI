"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarClock, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "@/components/ui/toast";
import type { FollowupCenter } from "@/server/whatsapp/followups";
import { prepareDueFollowupsAction, sendDraftAction } from "./actions";

export function FollowupsView({ data, canSend }: { data: FollowupCenter; canSend: boolean }) {
  const t = useTranslations("whatsapp.followups");
  const te = useTranslations("errors");
  const f = useFormatter();
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const sendable = data.drafts.filter((d) => d.windowOpen);

  const sendMany = (ids: string[]) =>
    start(async () => {
      let ok = 0;
      for (const id of ids) {
        const r = await sendDraftAction({ messageId: id });
        if (r.ok) ok++;
        else toast(te((r.error ?? "unexpected") as "unexpected"), "error");
      }
      if (ok) toast(`${ok} ✓`);
      setPicked([]);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-[20px] border border-line bg-surface p-4 shadow-xs">
        <p className="flex-1 text-sm text-ink-3">{t("noBulk")}</p>
        {canSend && (
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await prepareDueFollowupsAction({});
                if (!r.ok) return void toast(te((r.error ?? "unexpected") as "unexpected"), "error");
                toast(t("prepared", { drafted: r.data.drafted, templateRequired: r.data.templateRequired }));
                router.refresh();
              })
            }
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-ink-inverse"
            data-testid="wa-prepare-due"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4 text-accent" />} {t("prepareDue")}
          </button>
        )}
      </div>

      <section className="space-y-3" data-testid="wa-drafts">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-bold">{t("drafts")}</h2>
          {canSend && picked.length > 0 && (
            <button disabled={pending} onClick={() => sendMany(picked)} className="ms-auto inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#1fa855] px-3 text-sm font-semibold text-white">
              <Send className="size-3.5 flip-rtl" /> {t("approveSelected")} ({picked.length})
            </button>
          )}
        </div>
        {data.drafts.length === 0 ? (
          <p className="text-sm text-ink-3">{t("none")}</p>
        ) : (
          <ul className="space-y-2">
            {data.drafts.map((d) => (
              <li key={d.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-3">
                {canSend && d.windowOpen && <input type="checkbox" className="mt-1 size-4 accent-[#1fa855]" checked={picked.includes(d.id)} onChange={() => setPicked(picked.includes(d.id) ? picked.filter((x) => x !== d.id) : [...picked, d.id])} aria-label={d.lead?.name ?? d.id} />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{d.lead?.name ?? "—"}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2" dir="auto">{d.body}</p>
                  {!d.windowOpen && <p className="mt-1 text-xs text-warning">{t("templateRequired")}</p>}
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  {canSend && d.windowOpen && (
                    <button disabled={pending} onClick={() => sendMany([d.id])} className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#1fa855] px-2.5 text-xs font-semibold text-white">
                      <Send className="size-3 flip-rtl" /> {t("approve")}
                    </button>
                  )}
                  <Link href={`/whatsapp/inbox?c=${d.conversationId}`} className="rounded-lg border border-line px-2.5 py-1.5 text-center text-xs font-semibold">{t("openChat")}</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        {sendable.length > 1 && canSend && picked.length === 0 && (
          <button onClick={() => setPicked(sendable.map((d) => d.id))} className="text-xs font-semibold text-nova-blue hover:underline">
            {t("approveSelected")} · {sendable.length}
          </button>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[20px] border border-line bg-surface p-4 shadow-xs">
          <h2 className="mb-3 text-[15px] font-bold">{t("due")}</h2>
          {data.due.length === 0 ? (
            <p className="text-sm text-ink-3">{t("none")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.due.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{l.name}</span>
                    <span className="block truncate text-xs text-ink-3">{l.nextAction ?? "—"}{l.nextActionAt ? ` · ${f.relativeTime(new Date(l.nextActionAt))}` : ""}</span>
                  </span>
                  {!l.windowOpen && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">{t("templateRequired")}</span>}
                  {l.conversationId && <Link href={`/whatsapp/inbox?c=${l.conversationId}`} className="text-xs font-semibold text-[#178a45] hover:underline">{t("openChat")}</Link>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-[20px] border border-line bg-surface p-4 shadow-xs">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold"><CalendarClock className="size-4 text-nova-blue" /> {t("meetings")}</h2>
          {data.meetings.length === 0 ? (
            <p className="text-sm text-ink-3">{t("none")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.meetings.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{m.lead?.name ?? m.title}</span>
                    <span className="block text-xs text-ink-3">{m.at ? f.dateTime(new Date(m.at), { weekday: "short", hour: "numeric", minute: "2-digit" }) : "—"}</span>
                  </span>
                  {m.lead?.reachable && <Link href={`/leads/${m.lead.id}`} className="text-xs font-semibold text-[#178a45] hover:underline">{t("remind")}</Link>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
