import type { CSSProperties } from "react";
import { getTranslations } from "next-intl/server";
import { BarChart3, CalendarDays, CircleCheck, FileText, Megaphone, MessageCircle, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { NovaOrb } from "@/features/home/nova-orb";

// Scene geometry (px, before scaling). The orbits are ellipses around the orb's centre; the lower half of an
// orbit is "in front" of the sphere and the upper half behind it (see .hero-orbit-* in globals.css).
const W = 640;
const H = 470;
const CX = W / 2;
const CY = 218;
const ORB = 212;

const ellipse = (rx: number, ry: number) => `M ${CX + rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX - rx} ${CY} A ${rx} ${ry} 0 1 1 ${CX + rx} ${CY}`;
const OUTER = { rx: 262, ry: 98 };
const INNER = { rx: 188, ry: 64 };

type Hub = { key: string; icon: LucideIcon; color: string };
const HUBS: Hub[] = [
  { key: "content", icon: FileText, color: "var(--orbit-blue)" },
  { key: "campaigns", icon: Megaphone, color: "var(--orbit-purple)" },
  { key: "leads", icon: Users, color: "var(--orbit-orange)" },
  { key: "approvals", icon: CircleCheck, color: "var(--orbit-green)" },
  { key: "calendar", icon: CalendarDays, color: "var(--orbit-cyan)" },
  { key: "analytics", icon: BarChart3, color: "var(--orbit-blue)" },
];
const HUB_SECONDS = 48;

/**
 * Landing hero centrepiece: the NOVA sphere with the product's hubs travelling around it on an orbit (passing
 * in front of and behind the sphere), light pulses on the rings and two "the team is working" cards.
 * Pure CSS motion (offset-path); static and evenly spread under prefers-reduced-motion. Decorative.
 */
export async function HeroOrbit({ className }: { className?: string }) {
  const t = await getTranslations("app.home.orbit");
  const tl = await getTranslations("landing.v2.hero");
  return (
    <div className={cn("hero-orbit-frame relative mx-auto", className)} aria-hidden>
      <div className="hero-orbit-scene absolute left-0 top-0" dir="ltr" style={{ width: W, height: H }}>
        {/* atmosphere */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_52%_46%_at_50%_46%,rgba(79,156,255,.20),transparent_70%)]" />
        <div className="hero-orbit-dots pointer-events-none absolute inset-0" />

        {/* orbit rings */}
        <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 size-full" fill="none">
          <defs>
            <linearGradient id="hero-ring" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#6aa8ff" stopOpacity=".15" />
              <stop offset=".5" stopColor="#6aa8ff" stopOpacity=".7" />
              <stop offset="1" stopColor="#8b7bff" stopOpacity=".15" />
            </linearGradient>
          </defs>
          <path d={ellipse(OUTER.rx, OUTER.ry)} stroke="url(#hero-ring)" strokeWidth="1.2" />
          <path d={ellipse(INNER.rx, INNER.ry)} stroke="url(#hero-ring)" strokeWidth="1" strokeDasharray="2 7" opacity=".9" />
          <path d={ellipse(OUTER.rx + 44, OUTER.ry + 26)} stroke="#6aa8ff" strokeOpacity=".14" strokeWidth="1" />
        </svg>

        {/* sphere */}
        <div className="absolute z-20" style={{ left: CX - ORB * 0.75, top: CY - ORB / 2 }}>
          <NovaOrb size={ORB} subtitle="AI OPERATING SYSTEM" />
        </div>

        {/* light pulses on the rings */}
        {[
          { ring: INNER, seconds: 11, delay: 0, color: "#7cc4ff" },
          { ring: INNER, seconds: 11, delay: -5.5, color: "#b9a8ff" },
          { ring: OUTER, seconds: 19, delay: -4, color: "#7cc4ff" },
        ].map((p, i) => (
          <span
            key={i}
            className="hero-orbit-rider hero-orbit-pulse absolute left-0 top-0 size-[7px] rounded-full"
            style={
              {
                offsetPath: `path("${ellipse(p.ring.rx, p.ring.ry)}")`,
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
          return (
            <span
              key={h.key}
              className="hero-orbit-rider hero-orbit-label absolute left-0 top-0 inline-flex h-[3em] items-center gap-[.7em] whitespace-nowrap rounded-full border border-white/80 bg-surface/95 pe-[1.1em] ps-[.4em] font-semibold text-ink shadow-[0_10px_26px_-12px_rgba(30,70,140,.4)] ring-1 ring-[var(--nova-line)]"
              style={
                {
                  offsetPath: `path("${ellipse(OUTER.rx, OUTER.ry)}")`,
                  "--orbit-seconds": `${HUB_SECONDS}s`,
                  "--orbit-delay": `${-(pos / 100) * HUB_SECONDS}s`,
                  "--orbit-pos": `${pos}%`,
                } as CSSProperties
              }
            >
              <span className="flex size-[2.2em] items-center justify-center rounded-full" style={{ color: h.color, background: `color-mix(in oklab, ${h.color} 13%, white)` }}>
                <Icon className="size-[1.15em]" strokeWidth={2.1} />
              </span>
              {t(h.key as "content")}
            </span>
          );
        })}

        {/* what the team is doing */}
        <LiveCard className="left-[2px] top-[18px]" icon={CircleCheck} color="var(--orbit-green)" text={tl("live1")} delay="0s" />
        <LiveCard className="right-[2px] top-[372px]" icon={MessageCircle} color="var(--orbit-purple)" text={tl("live2")} delay="-2.6s" />
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
      <span className="flex size-[2.3em] shrink-0 items-center justify-center rounded-[.7em]" style={{ color, background: `color-mix(in oklab, ${color} 13%, white)` }}>
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
