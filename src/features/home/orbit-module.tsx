import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type OrbitColor = "blue" | "cyan" | "green" | "orange" | "purple";

const COLOR: Record<OrbitColor, { icon: string; bg: string }> = {
  blue: { icon: "text-[var(--orbit-blue)]", bg: "bg-[color-mix(in_oklab,var(--orbit-blue)_12%,white)]" },
  cyan: { icon: "text-[var(--orbit-cyan)]", bg: "bg-[color-mix(in_oklab,var(--orbit-cyan)_12%,white)]" },
  green: { icon: "text-[var(--orbit-green)]", bg: "bg-[color-mix(in_oklab,var(--orbit-green)_12%,white)]" },
  orange: { icon: "text-[var(--orbit-orange)]", bg: "bg-[color-mix(in_oklab,var(--orbit-orange)_14%,white)]" },
  purple: { icon: "text-[var(--orbit-purple)]", bg: "bg-[color-mix(in_oklab,var(--orbit-purple)_12%,white)]" },
};

/** A white pill module orbiting the NOVA sphere; links to the real section. */
export function OrbitModule({ href, label, icon: Icon, color, className, count }: { href: string; label: string; icon: LucideIcon; color: OrbitColor; className?: string; count?: number }) {
  const c = COLOR[color];
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex h-[54px] items-center gap-3 rounded-full border border-white/80 bg-surface/95 pe-6 ps-2 shadow-[0_8px_24px_-10px_rgba(30,70,140,.28)] ring-1 ring-[var(--nova-line)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-12px_rgba(30,70,140,.35)]",
        className,
      )}
    >
      <span className={cn("flex size-10 items-center justify-center rounded-full", c.bg)}>
        <Icon className={cn("size-[20px]", c.icon)} strokeWidth={2} aria-hidden />
      </span>
      <span className="whitespace-nowrap text-[16px] font-semibold text-ink">{label}</span>
      {count ? <span className="tabular rounded-full bg-nova-blue-soft px-2 text-xs font-semibold text-nova-blue">{count}</span> : null}
    </Link>
  );
}

const DOT: Record<OrbitColor, string> = {
  blue: "bg-[var(--orbit-blue)]",
  cyan: "bg-[var(--orbit-cyan)]",
  green: "bg-[var(--orbit-green)]",
  orange: "bg-[var(--orbit-orange)]",
  purple: "bg-[var(--orbit-purple)]",
};

export function OrbitDot({ color, style }: { color: OrbitColor; style: React.CSSProperties }) {
  return (
    <span className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-white" style={style} aria-hidden>
      <span className={cn("block size-full rounded-full", DOT[color])} />
    </span>
  );
}
