import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, interactive, ...props }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-line bg-surface",
        interactive && "transition-[box-shadow,border-color,transform] duration-150 hover:border-line-strong hover:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function SectionHeader({
  title,
  description,
  action,
  className,
  as: As = "h2",
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0 space-y-1">
        <As className="text-[15px] font-semibold tracking-tight text-ink">{title}</As>
        {description && <p className="text-sm text-ink-3">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        {eyebrow && <div className="text-xs font-medium uppercase tracking-[0.14em] text-ink-3">{eyebrow}</div>}
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[32px]">{title}</h1>
        {description && <p className="max-w-2xl text-[15px] text-ink-3 text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
