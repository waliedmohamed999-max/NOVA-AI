import type { CSSProperties } from "react";
import { getTranslations } from "next-intl/server";
import { BarChart3, CalendarDays, CircleCheck, FileText, Megaphone, MessageCircle, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { NovaOrb } from "@/features/home/nova-orb";

/**
 * Scene geometry (px, before scaling). The orbits are ellipses around the sphere's centre; the lower half of
 * an orbit is "in front" of the sphere and the upper half behind it (see .hero-orbit-* in globals.css).
 */
type Scene = { w: number; h: number; cx: number; cy: number; orb: number; outer: [number, number]; inner: [number, number]; far: [number, number]; seconds: number };

// sm and up: labelled hubs on a wide orbit, with floating activity cards.
const FULL: Scene = { w: 640, h: 470, cx: 320, cy: 218, orb: 212, outer: [262, 98], inner: [188, 64], far: [306, 124], seconds: 48 };
// Phones: a bigger sphere, icon-only hubs on a tight orbit; the activity line sits below the scene.
const COMPACT: Scene = { w: 340, h: 268, cx: 170, cy: 122, orb: 172, outer: [148, 54], inner: [116, 38], far: [166, 72], seconds: 36 };

const ellipse = (s: Scene, [rx, ry]: [number, number]) => `M ${s.cx + rx} ${s.cy} A ${rx} ${ry} 0 1 1 ${s.cx - rx} ${s.cy} A ${rx} ${ry} 0 1 1 ${s.cx + rx} ${s.cy}`;

type Hub = { key: string; icon: LucideIcon; color: string };
const HUBS: Hub[] = [
  { key: "content", icon: FileText, color: "var(--orbit-blue)" },
  { key: "campaigns", icon: Megaphone, color: "var(--orbit-purple)" },
  { key: "leads", icon: Users, color: "var(--orbit-orange)" },
  { key: "approvals", icon: CircleCheck, color: "var(--orbit-green)" },
  { key: "calendar", icon: CalendarDays, color: "var(--orbit-cyan)" },
  { key: "analytics", icon: BarChart3, color: "var(--orbit-blue)" },
];

const tint = (color: string) => `color-mix(in oklab, ${color} 13%, white)`;

/**
 * Landing hero centrepiece: the NOVA sphere with the product's hubs travelling around it on an orbit (passing
 * in front of and behind the sphere), light pulses on the rings and "the team is working" activity.
 * Two compositions: a compact one for phones and the full one from `sm` up. Pure CSS motion (offset-path);
 * static and evenly spread under prefers-reduced-motion. Decorative.
 */
export async function HeroOrbit({ className }: { className?: string }) {
  const t = await getTranslations("app.home.orbit");
  const tl = await getTranslations("landing.v2.hero");
  const labels = Object.fromEntries(HUBS.map((h) => [h.key, t(h.key as "content")]));
  return (
    <div className={className} aria-hidden>
      {/* phones */}
      <div className="sm:hidden">
        <OrbitScene scene={COMPACT} variant="compact" labels={labels} />
        <div className="relative z-10 mx-auto -mt-1 flex h-10 w-fit max-w-full items-center gap-2 rounded-full border border-line bg-surface/90 pe-4 ps-3 shadow-[0_10px_28px_-16px_rgba(20,50,110,.45)] backdrop-blur">
          <span className="relative flex size-2 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--orbit-green)] opacity-60" />
            <span className="relative size-2 rounded-full bg-[var(--orbit-green)]" />
          </span>
          {/* the two activity lines take turns in the same spot */}
          <span className="grid text-[13px] font-semibold text-ink">
            <span className="hero-orbit-swap col-start-1 row-start-1 whitespace-nowrap text-center">{tl("live1")}</span>
            <span className="hero-orbit-swap hero-orbit-swap-alt col-start-1 row-start-1 whitespace-nowrap text-center">{tl("live2")}</span>
          </span>
        </div>
      </div>

      {/* sm and up */}
      <div className="hidden sm:block">
        <OrbitScene scene={FULL} variant="full" labels={labels}>
          <LiveCard className="left-[2px] top-[18px]" icon={CircleCheck} color="var(--orbit-green)" text={tl("live1")} delay="0s" />
          <LiveCard className="right-[2px] top-[372px]" icon={MessageCircle} color="var(--orbit-purple)" text={tl("live2")} delay="-2.6s" />
        </OrbitScene>
      </div>
    </div>
  );
}

function OrbitScene({ scene: s, variant, labels, children }: { scene: Scene; variant: "full" | "compact"; labels: Record<string, string>; children?: React.ReactNode }) {
  const compact = variant === "compact";
  const ring = `hero-ring-${variant}`;
  const pulses = [
    { path: s.inner, seconds: 11, delay: 0, color: "#7cc4ff" },
    { path: s.inner, seconds: 11, delay: -5.5, color: "#b9a8ff" },
    { path: s.outer, seconds: 19, delay: -4, color: "#7cc4ff" },
  ];
  return (
    <div className="hero-orbit-frame relative mx-auto" data-variant={variant} style={{ "--w": `${s.w}px`, "--h": `${s.h}px` } as CSSProperties}>
      <div className="hero-orbit-scene absolute left-0 top-0" dir="ltr" style={{ width: s.w, height: s.h }}>
        {/* atmosphere */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_52%_46%_at_50%_46%,rgba(79,156,255,.20),transparent_70%)]" />
        <div className="hero-orbit-dots pointer-events-none absolute inset-0" />

        {/* orbit rings */}
        <svg viewBox={`0 0 ${s.w} ${s.h}`} className="pointer-events-none absolute inset-0 size-full" fill="none">
          <defs>
            <linearGradient id={ring} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#6aa8ff" stopOpacity=".15" />
              <stop offset=".5" stopColor="#6aa8ff" stopOpacity=".7" />
              <stop offset="1" stopColor="#8b7bff" stopOpacity=".15" />
            </linearGradient>
          </defs>
          <path d={ellipse(s, s.outer)} stroke={`url(#${ring})`} strokeWidth="1.2" />
          <path d={ellipse(s, s.inner)} stroke={`url(#${ring})`} strokeWidth="1" strokeDasharray="2 7" opacity=".9" />
          <path d={ellipse(s, s.far)} stroke="#6aa8ff" strokeOpacity=".14" strokeWidth="1" />
        </svg>

        {/* sphere */}
        <div className="absolute z-20" style={{ left: s.cx - s.orb * 0.75, top: s.cy - s.orb / 2 }}>
          <NovaOrb size={s.orb} subtitle="AI OPERATING SYSTEM" />
        </div>

        {/* light pulses on the rings */}
        {pulses.map((p, i) => (
          <span
            key={i}
            className={cn("hero-orbit-rider hero-orbit-pulse absolute left-0 top-0 rounded-full", compact ? "size-[5px]" : "size-[7px]")}
            style={
              {
                offsetPath: `path("${ellipse(s, p.path)}")`,
                "--orbit-seconds": `${p.seconds}s`,
                "--orbit-delay": `${p.delay}s`,
                "--orbit-pos": `${(i * 37) % 100}%`,
                background: p.color,
                boxShadow: `0 0 12px 3px ${p.color}`,
              } as CSSProperties
            }
          />
        ))}

        {/* product hubs travelling on the outer orbit */}
        {HUBS.map((h, i) => {
          const pos = (i / HUBS.length) * 100;
          const Icon = h.icon;
          const style = {
            offsetPath: `path("${ellipse(s, s.outer)}")`,
            "--orbit-seconds": `${s.seconds}s`,
            "--orbit-delay": `${-(pos / 100) * s.seconds}s`,
            "--orbit-pos": `${pos}%`,
          } as CSSProperties;
          if (compact)
            return (
              <span
                key={h.key}
                className="hero-orbit-rider absolute left-0 top-0 flex size-10 items-center justify-center rounded-full border border-white/80 bg-surface shadow-[0_8px_20px_-10px_rgba(30,70,140,.45)] ring-1 ring-[var(--nova-line)]"
                style={style}
              >
                <span className="flex size-8 items-center justify-center rounded-full" style={{ color: h.color, background: tint(h.color) }}>
                  <Icon className="size-[17px]" strokeWidth={2.1} />
                </span>
              </span>
            );
          return (
            <span
              key={h.key}
              className="hero-orbit-rider hero-orbit-label absolute left-0 top-0 inline-flex h-[3em] items-center gap-[.7em] whitespace-nowrap rounded-full border border-white/80 bg-surface/95 pe-[1.1em] ps-[.4em] font-semibold text-ink shadow-[0_10px_26px_-12px_rgba(30,70,140,.4)] ring-1 ring-[var(--nova-line)]"
              style={style}
            >
              <span className="flex size-[2.2em] items-center justify-center rounded-full" style={{ color: h.color, background: tint(h.color) }}>
                <Icon className="size-[1.15em]" strokeWidth={2.1} />
              </span>
              {labels[h.key]}
            </span>
          );
        })}

        {children}
      </div>
    </div>
  );
}

function LiveCard({ className, icon: Icon, color, text, delay }: { className: string; icon: LucideIcon; color: string; text: string; delay: string }) {
  return (
    <div
      className={cn("hero-orbit-card hero-orbit-label absolute z-40 flex items-center gap-[.7em] rounded-[1em] border border-line bg-surface/90 py-[.55em] pe-[1em] ps-[.55em] shadow-[0_14px_34px_-16px_rgba(20,50,110,.45)] backdrop-blur", className)}
      style={{ animationDelay: delay }}
    >
      <span className="flex size-[2.3em] shrink-0 items-center justify-center rounded-[.7em]" style={{ color, background: tint(color) }}>
        <Icon className="size-[1.2em]" strokeWidth={2.1} />
      </span>
      <span className="whitespace-nowrap text-[.92em] font-semibold text-ink" dir="auto">
        {text}
      </span>
      <span className="relative ms-0.5 flex size-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-[var(--orbit-green)] opacity-60" />
        <span className="relative size-2 rounded-full bg-[var(--orbit-green)]" />
      </span>
    </div>
  );
}
