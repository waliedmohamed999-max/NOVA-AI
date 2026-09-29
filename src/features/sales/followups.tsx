"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarCheck, Check, Sparkles, TimerReset } from "lucide-react";
import { cn } from "@/lib/cn";
import { completeActivity } from "./actions";

type Item = { id: string; title: string; type: string; dueAt: string | null; lead: { id: string; name: string; company: string | null }; byAgent: boolean };

export function FollowUpList({ items }: { items: Item[] }) {
  const t = useTranslations("leads");
  const format = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!items.length) return <p className="rounded-2xl border border-line bg-surface px-5 py-6 text-sm text-ink-3">{t("sales.noFollowUps")}</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface">
      {items.map((f) => {
        const overdue = f.dueAt && new Date(f.dueAt) < new Date();
        const Icon = f.type === "MEETING" ? CalendarCheck : TimerReset;
        return (
          <li key={f.id} className="flex items-center gap-4 px-5 py-3.5">
            <Icon className={cn("size-4 shrink-0", overdue ? "text-warning" : "text-ink-3")} />
            <div className="min-w-0 flex-1">
              <Link href={`/leads/${f.lead.id}`} className="block truncate text-sm font-medium hover:underline">
                {f.lead.name}
                {f.lead.company && <span className="font-normal text-ink-3"> · {f.lead.company}</span>}
              </Link>
              <div className="flex items-center gap-1.5 truncate text-xs text-ink-3">
                {f.byAgent && <Sparkles className="size-3 text-accent" />}
                {f.title}
              </div>
            </div>
            {f.dueAt && <span className={cn("text-xs tabular", overdue ? "font-semibold text-warning" : "text-ink-3")}>{format.relativeTime(new Date(f.dueAt))}</span>}
            <button
              disabled={pending}
              onClick={() => start(async () => { await completeActivity({ id: f.id }); router.refresh(); })}
              className="rounded-full border border-line p-1.5 text-ink-3 transition hover:border-success hover:text-success"
              aria-label={t("markDone")}
            >
              <Check className="size-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
