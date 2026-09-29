"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useSetup } from "./state";

/** White step card with an icon tile, title, subtitle and the live save state. */
export function StepCard({ icon, title, subtitle, children, footer }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="rounded-[20px] border border-nova-line bg-surface shadow-[0_1px_2px_rgb(15_23_42/0.04),0_18px_50px_-24px_rgb(15_23_42/0.18)]">
      <header className="flex items-start justify-between gap-4 px-5 pt-6 sm:px-8 sm:pt-7">
        <div className="flex items-start gap-3.5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-nova-blue-soft text-nova-blue ring-1 ring-nova-blue-line [&_svg]:size-[22px]">{icon}</span>
          <div className="space-y-1">
            <h2 className="text-xl font-bold tracking-tight text-ink sm:text-[22px]">{title}</h2>
            <p className="text-sm text-ink-3">{subtitle}</p>
          </div>
        </div>
        <SaveBadge />
      </header>
      <div className="space-y-6 px-5 py-6 sm:px-8">{children}</div>
      {footer && <footer className="border-t border-nova-line px-5 py-5 sm:px-8">{footer}</footer>}
    </section>
  );
}

export function SaveBadge() {
  const t = useTranslations("onboarding.setup.save");
  const s = useSetup();
  if (s.saveState === "idle") return null;
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs font-medium" aria-live="polite" data-testid="save-state">
      {s.saveState === "saving" && (
        <span className="inline-flex items-center gap-1.5 text-ink-3">
          <Loader2 className="size-3.5 animate-spin" /> {t("saving")}
        </span>
      )}
      {s.saveState === "saved" && (
        <span className="inline-flex items-center gap-1.5 text-success">
          <CheckCircle2 className="size-3.5" /> {t("saved")}
        </span>
      )}
      {s.saveState === "error" && (
        <span className="inline-flex items-center gap-1.5 text-danger" role="alert">
          <AlertCircle className="size-3.5" /> {t("error")}
          <button type="button" onClick={() => void s.retry()} className="rounded-full px-2 py-0.5 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-nova-blue">
            {t("retry")}
          </button>
        </span>
      )}
    </div>
  );
}

/** A question row: question + hint, the control, and a check once it is answered (stacks on mobile). */
export function QuestionRow({ label, hint, done, required, children, htmlFor }: { label: string; hint?: string; done?: boolean; required?: boolean; children: ReactNode; htmlFor?: string }) {
  const t = useTranslations("onboarding.setup");
  return (
    <div className="grid gap-3 border-b border-nova-line/70 pb-5 last:border-0 last:pb-0 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_1.75rem] md:items-center md:gap-5">
      <div className="space-y-0.5">
        <label htmlFor={htmlFor} className="block text-[15px] font-semibold text-ink">
          {label}
          {required && <span className="sr-only"> ({t("required")})</span>}
        </label>
        {hint && <p className="text-xs text-ink-3">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
      <span className={cn("hidden size-7 items-center justify-center rounded-full transition md:flex", done ? "bg-success text-white" : "bg-sunken text-transparent")} aria-hidden>
        <Check className="size-4" strokeWidth={3} />
      </span>
    </div>
  );
}

export const inputClass =
  "h-12 w-full rounded-2xl border border-nova-line bg-surface px-4 text-[15px] text-ink shadow-[0_1px_2px_rgb(15_23_42/0.04)] outline-none transition placeholder:text-ink-4 focus:border-nova-blue focus:ring-4 focus:ring-nova-blue/10 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger";

/** Big selectable card (single or multi choice). */
export function ChoiceCard({ selected, onClick, icon, title, desc, role = "radio", disabled }: { selected: boolean; onClick: () => void; icon: ReactNode; title: string; desc?: string; role?: "radio" | "checkbox"; disabled?: boolean }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group relative flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-2xl border bg-surface px-3 py-4 text-center transition duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nova-blue disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-nova-blue bg-nova-blue-soft/60 shadow-[0_0_0_3px_var(--nova-blue-soft)]" : "border-nova-line hover:-translate-y-0.5 hover:border-nova-blue-line hover:shadow-sm",
      )}
    >
      {selected && (
        <span className="absolute -top-2 start-3 flex size-6 items-center justify-center rounded-full bg-nova-blue text-white shadow-sm">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      )}
      <span className={cn("[&_svg]:size-7", selected ? "text-nova-blue" : "text-ink-3 group-hover:text-ink-2")}>{icon}</span>
      <span className={cn("text-[15px] font-semibold", selected ? "text-nova-blue" : "text-ink")}>{title}</span>
      {desc && <span className="text-xs leading-snug text-ink-3">{desc}</span>}
    </button>
  );
}

/** Soft pill with an ember check (brand voice, goals, styles). */
export function Pill({ selected, onClick, children, disabled }: { selected: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-full border ps-4 pe-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nova-blue disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-accent/30 bg-accent-soft text-ink" : "border-nova-line bg-surface text-ink-2 hover:border-line-strong",
      )}
    >
      <span>{children}</span>
      <span className={cn("flex size-6 items-center justify-center rounded-full transition", selected ? "bg-accent text-white" : "bg-sunken text-transparent")} aria-hidden>
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    </button>
  );
}

/** Chips + an input: Enter (or the add button) adds, × removes. */
export function TagInput({ values, onChange, placeholder, max = 12, addLabel, removeLabel, disabled, id }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; max?: number; addLabel: string; removeLabel: (v: string) => string; disabled?: boolean; id?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().slice(0, 120);
    if (!v || values.some((x) => x.toLowerCase() === v.toLowerCase()) || values.length >= max) return setDraft("");
    onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="space-y-2.5">
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {values.map((v) => (
            <li key={v} className="inline-flex h-9 items-center gap-1 rounded-full bg-nova-blue-soft ps-3.5 pe-1 text-sm font-medium text-ink ring-1 ring-nova-blue-line">
              {v}
              <button type="button" disabled={disabled} onClick={() => onChange(values.filter((x) => x !== v))} className="rounded-full p-1 text-ink-3 hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-nova-blue" aria-label={removeLabel(v)}>
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          disabled={disabled || values.length >= max}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className={cn(inputClass, "h-11")}
          maxLength={120}
        />
        <button type="button" onClick={add} disabled={disabled || !draft.trim()} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border border-nova-line bg-surface px-4 text-sm font-semibold text-ink transition hover:border-nova-blue-line disabled:opacity-40">
          <Plus className="size-4" /> {addLabel}
        </button>
      </div>
    </div>
  );
}

export function StatusChip({ children, tone = "success" }: { children: ReactNode; tone?: "success" | "info" | "accent" }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 animate-fade-up",
        tone === "success" && "bg-success-soft text-success ring-success/20",
        tone === "info" && "bg-nova-blue-soft text-nova-blue ring-nova-blue-line",
        tone === "accent" && "bg-accent-soft text-accent-ink ring-accent/20",
      )}
    >
      <CheckCircle2 className="size-3.5" /> {children}
    </span>
  );
}

export function GroupLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="space-y-0.5" id={id}>
      <p className="text-[15px] font-semibold text-ink">{children}</p>
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  );
}
