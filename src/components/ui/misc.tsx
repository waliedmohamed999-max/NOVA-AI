import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

export function Avatar({ name, src, size = 32, className }: { name?: string | null; src?: string | null; size?: number; className?: string }) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-sunken font-semibold text-ink-2 ring-1 ring-line", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
      aria-hidden={!name}
      title={name ?? undefined}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center text-center", compact ? "gap-3 px-6 py-10" : "gap-4 px-6 py-16", className)}>
      {icon && (
        <div className="relative">
          <div className="absolute inset-0 -m-3 rounded-full ai-aura blur-md" aria-hidden />
          <div className="relative flex size-14 items-center justify-center rounded-2xl border border-line bg-surface text-accent shadow-sm [&_svg]:size-6">
            {icon}
          </div>
        </div>
      )}
      <div className="max-w-sm space-y-1.5">
        <h3 className="text-lg font-semibold tracking-tight text-ink">{title}</h3>
        {description && <p className="text-sm leading-relaxed text-ink-3 text-pretty">{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Progress({ value, className, tone = "accent", label }: { value: number; className?: string; tone?: "accent" | "ink" | "success" | "warning" | "danger"; label?: string }) {
  const color = { accent: "bg-accent", ink: "bg-ink", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[tone];
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-sunken", className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-surface-2 px-1 font-mono text-[11px] text-ink-3">{children}</kbd>;
}

export function Stat({ label, value, delta, hint }: { label: ReactNode; value: ReactNode; delta?: { value: string; positive: boolean } | null; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[13px] text-ink-3">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular">{value}</span>
        {delta && <span className={cn("text-xs font-semibold tabular", delta.positive ? "text-success" : "text-danger")}>{delta.value}</span>}
      </div>
      {hint && <div className="text-xs text-ink-4">{hint}</div>}
    </div>
  );
}
