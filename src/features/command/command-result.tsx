"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Ban, Brain, CircleAlert, CircleCheck, Info, Lock, ShieldAlert, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { CommandResponse, CommandStatus, Msg } from "@/server/command/types";
import type { Phase } from "./use-command-center";

const TONE: Record<CommandStatus, { icon: typeof CircleCheck; cls: string }> = {
  completed: { icon: CircleCheck, cls: "text-success" },
  partial: { icon: CircleAlert, cls: "text-warning" },
  queued: { icon: Sparkles, cls: "text-accent" },
  processing: { icon: Sparkles, cls: "text-accent" },
  understood: { icon: Sparkles, cls: "text-accent" },
  failed: { icon: CircleAlert, cls: "text-danger" },
  denied: { icon: Lock, cls: "text-danger" },
  needs_choice: { icon: Info, cls: "text-accent" },
  needs_confirmation: { icon: ShieldAlert, cls: "text-warning" },
  needs_approval: { icon: ShieldAlert, cls: "text-warning" },
  needs_input: { icon: Info, cls: "text-accent" },
  ai_unavailable: { icon: Ban, cls: "text-ink-3" },
  cancelled: { icon: X, cls: "text-ink-3" },
};

/**
 * The result under the command input: live phase → status, message, data, choices/confirmation and
 * follow-up actions. Technical ids never appear here (they live in the activity log).
 */
export function CommandResult({
  phase,
  result,
  error,
  onReply,
  onCommand,
  onEdit,
  onDismiss,
  onLinkClick,
}: {
  phase: Phase;
  result: CommandResponse | null;
  error: string | null;
  onReply: (a: { choice?: number; confirm?: boolean; cancel?: boolean }) => void;
  onCommand: (text: string) => void;
  onEdit: () => void;
  onDismiss: () => void;
  onLinkClick?: () => void;
}) {
  const t = useTranslations("common.cmd");
  const te = useTranslations("errors");
  const tp = useTranslations("common.platforms");

  if (phase === "idle") return null;
  if (phase === "understanding" || phase === "executing") {
    return (
      <div role="status" aria-live="polite" data-command-phase={phase} className="flex items-center gap-3 rounded-[18px] border border-[var(--nova-line)] bg-surface px-4 py-3.5 text-[15px] text-ink-2 shadow-sm">
        <Spinner className="size-4 text-accent" />
        <span>{t(phase)}</span>
      </div>
    );
  }

  const text = (m: Msg) => {
    const values = { ...(m.values ?? {}) };
    if (typeof values.page === "string" && t.has(`pages.${values.page}`)) values.page = t(`pages.${values.page}`);
    if (typeof values.category === "string" && t.has(`stats.approval_${values.category}`)) values.category = t(`stats.approval_${values.category}`);
    if (typeof values.platform === "string" && values.platform && tp.has(values.platform)) values.platform = tp(values.platform);
    if (typeof values.topic === "string" && t.has(`topics.${values.topic}`)) values.topic = t(`topics.${values.topic}`);
    if (typeof values.stage === "string" && t.has(`stages.${values.stage}`)) values.stage = t(`stages.${values.stage}`);
    return t.has(`msg.${m.key}`) ? t(`msg.${m.key}`, values) : m.key;
  };
  const statLabel = (key: string) => {
    if (key.startsWith("platform_")) return tp.has(key.slice(9)) ? tp(key.slice(9)) : key.slice(9);
    if (t.has(`stats.${key}`)) return t(`stats.${key}`);
    return key.replace(/^[a-z]+_/, "");
  };
  const reason = (code?: string | null) => (code ? (te.has(code) ? te(code) : te("unexpected")) : null);

  if (!result) {
    return (
      <div role="alert" data-command-status="failed" className="rounded-[18px] border border-danger/25 bg-danger-soft px-4 py-3.5 text-[15px] text-danger">
        <p className="font-semibold">{t("cantDo")}</p>
        <p className="mt-0.5 text-sm">{reason(error)}</p>
      </div>
    );
  }

  const tone = TONE[result.status] ?? TONE.completed;
  const Icon = tone.icon;
  const queued = result.status === "queued";
  const isError = ["failed", "denied"].includes(result.status);
  const progress = result.progress && result.progress.total ? result.progress : null;

  return (
    <section
      aria-live="polite"
      data-command-status={result.status}
      data-command-intent={result.intent ?? "unknown"}
      className={cn("relative rounded-[18px] border bg-surface px-4 py-3.5 text-start shadow-sm", isError ? "border-danger/25" : "border-[var(--nova-line)]")}
    >
      <button type="button" onClick={onDismiss} className="absolute end-2.5 top-2.5 rounded-full p-1.5 text-ink-4 transition hover:bg-sunken hover:text-ink" aria-label={t("dismiss")}>
        <X className="size-3.5" />
      </button>

      <div className="flex items-start gap-3 pe-7">
        <span className={cn("mt-0.5 shrink-0", tone.cls)}>{queued ? <Spinner className="size-[18px]" /> : <Icon className="size-[18px]" aria-hidden />}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-4">
            {queued && result.message.key === "processing" ? t("status.processing") : t(`status.${result.status}`)}
            {progress && <span className="ms-2 normal-case tracking-normal">· {t("progress", progress)}</span>}
          </p>
          {isError && <p className="mt-0.5 text-[15px] font-semibold text-ink">{t("cantDo")}</p>}
          <p className={cn("mt-0.5 text-[15px] leading-relaxed", isError ? "text-ink-2" : "font-medium text-ink")} dir="auto">
            {text(result.message)}
          </p>
          {reason(result.status === "failed" || result.status === "denied" || result.status === "ai_unavailable" ? result.reason : null) && result.reason !== "ai_not_configured" && (
            <p className="mt-1 text-sm text-ink-3">{reason(result.reason)}</p>
          )}
          {progress && queued && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </div>
          )}
        </div>
      </div>

      {result.mode && result.mode !== "local" && !["failed", "denied", "ai_unavailable", "cancelled"].includes(result.status) && (
        <p data-command-mode={result.mode} className="mt-2 flex items-center gap-1.5 ps-[30px] text-xs text-ink-4">
          {result.mode === "brain" ? <Brain className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
          <span>{t(`modes.${result.mode}`)}</span>
          {!!result.sources && <span>· {t("sourcesUsed", { count: result.sources })}</span>}
        </p>
      )}

      {result.text && <p className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-sunken px-3 py-2.5 text-sm leading-relaxed text-ink-2" dir="auto">{result.text}</p>}

      {!!result.stats?.length && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {result.stats.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1 text-xs text-ink-3">
              <span>{statLabel(s.key)}</span>
              <span className="font-semibold text-ink tabular-nums" dir="ltr">{s.value}</span>
            </li>
          ))}
        </ul>
      )}

      {!!result.preview?.length && (
        <div className="mt-3">
          <p className="text-sm font-semibold text-ink">{t("thisWill")}</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-ink-2">
            {result.preview.map((p, i) => (
              <li key={i}>{text(p)}</li>
            ))}
          </ul>
        </div>
      )}

      {!!result.notes?.length && (
        <ul className="mt-2 space-y-0.5 text-sm text-ink-3">
          {result.notes.map((m, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{text(m)}</span>
            </li>
          ))}
        </ul>
      )}

      {!!result.items?.length && (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
          {result.items.map((it, i) => {
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink" dir="auto">{it.title}</span>
                  {it.subtitle && <span className="block truncate text-xs text-ink-3" dir="auto">{it.subtitle}</span>}
                </span>
                {it.badge && <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[11px] text-ink-3">{t.has(`badges.${it.badge}`) ? t(`badges.${it.badge}`) : tp.has(it.badge) ? tp(it.badge) : it.badge}</span>}
              </>
            );
            return (
              <li key={i}>
                {it.href ? (
                  <Link href={it.href} onClick={onLinkClick} className="flex items-center gap-3 px-3 py-2 transition hover:bg-sunken">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-3 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {result.status === "needs_choice" && !!result.choices?.length && (
        <div className="mt-3" role="group" aria-label={t("choose")}>
          <div className="flex flex-wrap gap-2">
            {result.choices.map((c) => (
              <Button key={c.index} size="sm" variant="secondary" onClick={() => onReply({ choice: c.index })}>
                <span dir="auto">{c.title}</span>
                {c.subtitle && <span className="text-ink-4" dir="auto">· {c.subtitle}</span>}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => onReply({ cancel: true })}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      {(result.status === "needs_confirmation" || !!result.actions?.length) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {result.status === "needs_confirmation" && (
            <>
              <Button size="sm" variant="primary" onClick={() => onReply({ confirm: true })}>
                {t(`actions.${result.confirmLabel ?? "run"}`)}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onReply({ cancel: true })}>
                {t("cancel")}
              </Button>
            </>
          )}
          {result.actions?.map((a) =>
            a.href ? (
              <Link key={a.label} href={a.href} onClick={onLinkClick} className={buttonClass(a.primary && result.status !== "needs_confirmation" ? "primary" : "secondary", "sm")}>
                {t(`actions.${a.label}`)}
              </Link>
            ) : a.command === "__edit" ? (
              <Button key={a.label} size="sm" variant="secondary" onClick={onEdit}>
                {t(`actions.${a.label}`)}
              </Button>
            ) : a.command ? (
              <Button key={a.label} size="sm" variant={a.primary ? "primary" : "secondary"} onClick={() => onCommand(t(`commands.${a.command}`))}>
                {t(`actions.${a.label}`)}
              </Button>
            ) : null,
          )}
        </div>
      )}
    </section>
  );
}
