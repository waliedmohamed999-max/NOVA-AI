import { useId } from "react";
import { brand } from "@/config/brand";
import { cn } from "@/lib/cn";

/** The NOVA mark: a four-point spark inside a soft rounded square, lit with the signature gradient. */
export function LogoMark({ className, size = 28 }: { className?: string; size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={`nova-spark-${id}`} x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#40ddff" />
          <stop offset="0.5" stopColor="#7612fa" />
          <stop offset="1" stopColor="#fa12e3" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="#202020" />
      <path
        d="M16 6.5c.7 4.6 3 6.9 7.6 7.6-.1.1 0 0 0 0-4.6.7-6.9 3-7.6 7.6-.7-4.6-3-6.9-7.6-7.6 4.6-.7 6.9-3 7.6-7.6Z"
        fill={`url(#nova-spark-${id})`}
        transform="translate(0 1.9)"
      />
      <circle cx="23.5" cy="8.5" r="1.6" fill="#ffffff" opacity="0.9" />
    </svg>
  );
}

/** Mark + bold, tightly tracked wordmark (reference logo treatment). */
export function Logo({ className, subtitle }: { className?: string; subtitle?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-[21px] font-extrabold tracking-[-0.04em] text-ink" dir="ltr">
          {brand.name}
        </span>
        {subtitle && <span className="mt-1 text-[11px] font-medium text-ink-3">{subtitle}</span>}
      </span>
    </span>
  );
}
