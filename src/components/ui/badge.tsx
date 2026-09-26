import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "outline";

const tones: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2",
  accent: "bg-accent-soft text-accent-ink",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  outline: "border border-line text-ink-2",
};

export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium", tones[tone], className)}
      {...props}
    />
  );
}

export function StatusDot({ tone = "neutral", pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  const color: Record<Tone, string> = {
    neutral: "bg-ink-4",
    accent: "bg-accent",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
    outline: "bg-line-strong",
  };
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {pulse && <span className={cn("absolute inset-0 rounded-full opacity-60 animate-ping", color[tone])} />}
      <span className={cn("relative inline-flex size-2 rounded-full", color[tone])} />
    </span>
  );
}
