"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Check, CheckCheck, PenLine, ShieldCheck, X } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { AgentMark } from "@/components/agents/agent-mark";
import type { AgentKey } from "@/generated/prisma/enums";
import { decide } from "./actions";

export type ApprovalCard = {
  id: string;
  category: string;
  title: string;
  summary: string;
  reason: string | null;
  impact: string | null;
  agent: AgentKey | null;
  status: string;
  href: string | null;
  at: string;
};

export function ApprovalCenter({ tab, counts, items, recent }: { tab: string; counts: Record<string, number>; items: ApprovalCard[]; recent: ApprovalCard[] }) {
  const t = useTranslations("app.approvals");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  const run = (ids: string[], decision: "APPROVED" | "REJECTED", key: string) =>
    start(async () => {
      setBusy(key);
      const res = await decide({ ids, decision });
      setBusy(null);
      if (res.ok) {
        const manual = res.data.outcomes.includes("approved_manual_send");
        toast(manual ? t("manualSend") : decision === "APPROVED" ? t("approvedToast", { count: res.data.done }) : t("rejectedToast"));
        router.refresh();
      } else toast.error(te(res.error as "unexpected"));
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t("title")}
          value={tab}
          onChange={(v) => router.push(`/approvals?tab=${v}`)}
          options={Object.keys(counts).map((c) => ({ value: c, label: t(`tabs.${c}` as "tabs.CONTENT"), count: counts[c] }))}
        />
        {items.length > 1 && (
          <Button loading={busy === "all"} icon={<CheckCheck className="size-4" />} onClick={() => run(items.map((i) => i.id), "APPROVED", "all")}>
            {t("approveAll", { count: items.length })}
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2">
          <EmptyState icon={<ShieldCheck />} title={t("empty.title")} description={t("empty.body")} />
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {items.map((a) => (
            <li key={a.id} className="flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-xs">
              <div className="flex items-start gap-3">
                {a.agent ? <AgentMark agent={a.agent} size={38} /> : <span className="size-[38px] rounded-2xl bg-sunken" />}
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink-3">{a.agent ? tc(`agents.${a.agent}.name`) : ""} · {format.relativeTime(new Date(a.at))}</div>
                  <h3 className="mt-0.5 font-semibold leading-snug">{a.title}</h3>
                </div>
                <Badge tone="accent">{t(`tabs.${a.category}` as "tabs.CONTENT")}</Badge>
              </div>
              <dl className="mt-4 flex-1 space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ink-4">{t("what")}</dt>
                  <dd className="mt-0.5 line-clamp-4 whitespace-pre-line text-ink-2" dir="auto">{a.summary}</dd>
                </div>
                {a.reason && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-4">{t("why")}</dt>
                    <dd className="mt-0.5 text-ink-2" dir="auto">{a.reason}</dd>
                  </div>
                )}
                {a.impact && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-ink-4">{t("impact")}</dt>
                    <dd className="mt-0.5 text-ink-2" dir="auto">{a.impact}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-5 flex items-center gap-2 border-t border-line pt-4">
                <Button size="sm" loading={busy === `a-${a.id}`} icon={<Check className="size-4" />} onClick={() => run([a.id], "APPROVED", `a-${a.id}`)}>{tc("actions.approve")}</Button>
                {a.href && <Link href={a.href} className={buttonClass("secondary", "sm")}><PenLine className="size-3.5" />{tc("actions.edit")}</Link>}
                <Button size="sm" variant="ghost" className="ms-auto text-ink-3" loading={busy === `r-${a.id}`} icon={<X className="size-4" />} onClick={() => run([a.id], "REJECTED", `r-${a.id}`)}>{tc("actions.reject")}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">{t("recent")}</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {recent.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <Badge tone={a.status === "APPROVED" ? "success" : "neutral"}>{t(`status.${a.status}` as "status.APPROVED")}</Badge>
                <span className="min-w-0 flex-1 truncate">{a.title}</span>
                <span className="text-xs text-ink-4">{format.relativeTime(new Date(a.at))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
