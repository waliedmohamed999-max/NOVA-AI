import { cn } from "@/lib/cn";

/** Deterministic "star field" so server and client render identically. */
const STARS = Array.from({ length: 34 }, (_, i) => {
  const a = (i * 137.5 * Math.PI) / 180;
  const r = 0.12 + ((i * 53) % 100) / 100 * 0.36;
  return { x: 50 + Math.cos(a) * r * 100, y: 50 + Math.sin(a) * r * 100, s: 1 + ((i * 7) % 3) * 0.6, d: ((i * 31) % 30) / 10 };
});

/**
 * The NOVA "AI operating system" sphere: layered radial gradients for depth,
 * a slowly rotating meridian grid, twinkling particles, a specular highlight,
 * an outer halo and floor rings. Pure CSS/SVG; motion stops under
 * prefers-reduced-motion (see globals.css).
 */
export function NovaOrb({ size = 250, subtitle, className }: { size?: number; subtitle: string; className?: string }) {
  return (
    <div className={cn("relative flex flex-col items-center", className)} style={{ width: size * 1.5 }} aria-hidden>
      {/* halo */}
      <div
        className="nova-orb-halo pointer-events-none absolute rounded-full"
        style={{ width: size * 1.45, height: size * 1.45, top: -size * 0.225, background: "radial-gradient(circle, rgba(79,156,255,.38) 0%, rgba(79,156,255,.14) 38%, rgba(79,156,255,0) 68%)" }}
      />
      <div className="nova-orb relative" style={{ width: size, height: size }}>
        {/* sphere body */}
        <div
          className="absolute inset-0 overflow-hidden rounded-full"
          style={{
            background:
              "radial-gradient(circle at 50% 40%, #6fd0ff 0%, #2d7ff0 18%, #1450c4 36%, #0b2f86 58%, #061a4f 78%, #030c2c 100%)",
            boxShadow:
              "0 0 0 1.5px rgba(160,210,255,.55), 0 0 42px rgba(56,140,255,.55), 0 26px 60px -12px rgba(10,40,120,.55), inset 0 -24px 48px rgba(0,8,40,.75), inset 0 18px 40px rgba(140,210,255,.35)",
          }}
        >
          {/* meridian grid */}
          <svg viewBox="0 0 100 100" className="nova-orb-grid absolute inset-0 size-full opacity-40">
            <g fill="none" stroke="rgba(170,215,255,.55)" strokeWidth=".35">
              <ellipse cx="50" cy="50" rx="48" ry="16" />
              <ellipse cx="50" cy="50" rx="48" ry="32" />
              <ellipse cx="50" cy="50" rx="16" ry="48" />
              <ellipse cx="50" cy="50" rx="32" ry="48" />
              <line x1="2" y1="50" x2="98" y2="50" />
              <line x1="50" y1="2" x2="50" y2="98" />
            </g>
          </svg>
          {/* particles */}
          {STARS.map((s, i) => (
            <span
              key={i}
              className="nova-orb-star absolute rounded-full bg-white"
              style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s`, boxShadow: "0 0 6px rgba(200,235,255,.9)" }}
            />
          ))}
          {/* core glow */}
          <div className="absolute inset-[22%] rounded-full" style={{ background: "radial-gradient(circle, rgba(150,225,255,.55) 0%, rgba(80,160,255,.18) 45%, transparent 70%)" }} />
          {/* specular highlight + rim */}
          <div className="absolute rounded-full" style={{ left: "16%", top: "8%", width: "46%", height: "30%", background: "radial-gradient(ellipse at center, rgba(255,255,255,.55), rgba(255,255,255,0) 70%)", filter: "blur(2px)" }} />
          <div className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(circle at 50% 50%, transparent 62%, rgba(120,190,255,.35) 72%, transparent 76%)" }} />
        </div>
        {/* wordmark */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center" dir="ltr">
          <span className="text-[34px] font-semibold tracking-[0.32em] text-white [text-shadow:0_2px_18px_rgba(120,200,255,.9)]" style={{ fontSize: size * 0.135 }}>
            NOVA
          </span>
          <span className="mt-1 font-semibold tracking-[0.28em] text-white/80" style={{ fontSize: Math.max(8, size * 0.038) }}>
            {subtitle}
          </span>
        </div>
      </div>
      {/* floor rings */}
      <div className="pointer-events-none relative -mt-7" style={{ width: size * 1.25, height: size * 0.28 }}>
        <div className="absolute inset-0 rounded-[50%] border border-[rgba(90,160,255,.35)]" />
        <div className="absolute inset-x-[12%] inset-y-[18%] rounded-[50%] border border-[rgba(90,160,255,.45)]" />
        <div className="absolute inset-x-[26%] inset-y-[34%] rounded-[50%] bg-[radial-gradient(ellipse,rgba(120,190,255,.45),transparent_70%)]" />
      </div>
    </div>
  );
}
