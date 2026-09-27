import { CalendarDays, Globe, LayoutGrid, Mail, MessageCircle } from "lucide-react";
import { cn } from "@/lib/cn";

/** Simple monochrome channel glyphs on a tinted tile (generic shapes, no logos). */
const TINT: Record<string, string> = {
  INSTAGRAM: "var(--ch-instagram)",
  FACEBOOK: "var(--ch-facebook)",
  LINKEDIN: "var(--ch-linkedin)",
  TIKTOK: "var(--ch-tiktok)",
  YOUTUBE: "#e5484d",
  X: "#17161c",
  WHATSAPP: "#25a366",
  EMAIL: "var(--nova-blue, #3b5bdb)",
  GOOGLE: "#3b73e0",
  MICROSOFT: "#1f6fbf",
  CALENDAR: "var(--ink-2)",
  WEBSITE: "var(--ink-2)",
};

function Glyph({ channel }: { channel: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (channel) {
    case "INSTAGRAM":
      return (
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" {...p} />
          <circle cx="12" cy="12" r="3.8" {...p} />
          <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" />
        </svg>
      );
    case "FACEBOOK":
      return (
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
          <path d="M14.5 8H16V4.5h-2.2C11.2 4.5 10 6 10 8.4V10H8v3.4h2v6.1h3.4v-6.1h2.3l.4-3.4h-2.7V8.9c0-.6.4-.9 1.1-.9Z" fill="currentColor" />
        </svg>
      );
    case "LINKEDIN":
      return (
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
          <rect x="4" y="9.5" width="3.2" height="10" rx="0.6" fill="currentColor" />
          <circle cx="5.6" cy="5.8" r="1.9" fill="currentColor" />
          <path d="M10.2 19.5v-10h3v1.4c.6-1 1.8-1.7 3.2-1.7 2.4 0 3.6 1.5 3.6 4.3v6h-3.2v-5.5c0-1.3-.5-2-1.6-2s-1.8.8-1.8 2.1v5.4Z" fill="currentColor" />
        </svg>
      );
    case "TIKTOK":
      return (
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
          <path d="M14 4v10.2a3.7 3.7 0 1 1-3.2-3.7" {...p} />
          <path d="M14 4c.4 2.4 2 4 4.5 4.3" {...p} />
        </svg>
      );
    case "YOUTUBE":
      return (
        <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
          <rect x="3" y="6" width="18" height="12" rx="4" {...p} />
          <path d="m10.5 9.5 4 2.5-4 2.5Z" fill="currentColor" />
        </svg>
      );
    case "X":
      return (
        <svg viewBox="0 0 24 24" className="size-[16px]" aria-hidden>
          <path d="M5 4.5 19 19.5M19 4.5 5 19.5" {...p} />
        </svg>
      );
    case "WHATSAPP":
      return <MessageCircle className="size-[18px]" aria-hidden />;
    case "EMAIL":
    case "GOOGLE":
      return <Mail className="size-[18px]" aria-hidden />;
    case "MICROSOFT":
      return <LayoutGrid className="size-[18px]" aria-hidden />;
    case "CALENDAR":
      return <CalendarDays className="size-[18px]" aria-hidden />;
    default:
      return <Globe className="size-[18px]" aria-hidden />;
  }
}

export function ChannelIcon({ channel, className }: { channel: string; className?: string }) {
  const tint = TINT[channel] ?? "var(--ink-3)";
  return (
    <span
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", className)}
      style={{ color: tint, background: `color-mix(in oklab, ${tint} 12%, transparent)` }}
    >
      <Glyph channel={channel} />
    </span>
  );
}
