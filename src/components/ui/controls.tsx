"use client";

import * as Tabs from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50",
        checked ? "bg-ink" : "bg-line-strong",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[var(--ease-spring)]",
          checked ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5",
        )}
      />
    </button>
  );
}

/** Pill segmented control. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[9px] border border-line bg-surface p-0.5 scrollbar-none", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] font-medium transition-colors duration-150",
            size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-3.5 text-[13px]",
            value === o.value ? "bg-black/[0.06] font-semibold text-ink dark:bg-white/[0.1]" : "text-ink-3 hover:bg-black/[0.03] hover:text-ink",
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={cn("tabular rounded-[5px] px-1.5 text-[11px]", value === o.value ? "bg-accent text-white" : "bg-black/[0.05] text-ink-3")}>{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export const TabsRoot = Tabs.Root;
export const TabsContent = Tabs.Content;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof Tabs.List>) {
  return <Tabs.List className={cn("flex gap-1 overflow-x-auto border-b border-line scrollbar-none", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof Tabs.Trigger>) {
  return (
    <Tabs.Trigger
      className={cn(
        "relative -mb-px inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 text-sm font-medium text-ink-3 transition-colors hover:text-ink data-[state=active]:border-accent data-[state=active]:font-semibold data-[state=active]:text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label: string; className?: string }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      className={cn("size-4 cursor-pointer rounded border-line-strong accent-[var(--ink)]", className)}
    />
  );
}
