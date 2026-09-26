import { brand } from "@/config/brand";
import { cn } from "@/lib/cn";

/** The NOVA mark: a four-point spark inside a soft rounded square. */
export function LogoMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <path
        d="M16 6.5c.7 4.6 3 6.9 7.6 7.6-.1.1 0 0 0 0-4.6.7-6.9 3-7.6 7.6-.7-4.6-3-6.9-7.6-7.6 4.6-.7 6.9-3 7.6-7.6Z"
        fill="var(--accent)"
        transform="translate(0 1.9)"
      />
      <circle cx="23.5" cy="8.5" r="1.6" fill="var(--ink-inverse)" opacity="0.85" />
    </svg>
  );
}

export function Logo({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-bold tracking-[0.14em] text-ink" dir="ltr">
          {brand.name}
        </span>
        {subtitle && <span className="mt-1 text-[11px] font-medium text-ink-3">{subtitle}</span>}
      </span>
    </span>
  );
}
