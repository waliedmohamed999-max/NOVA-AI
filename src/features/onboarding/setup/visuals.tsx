"use client";

import { useTranslations } from "next-intl";
import { BarChart3, FileText, Target, Users } from "lucide-react";
import { cn } from "@/lib/cn";

/** The intelligence node beside the hero: a central core connected to what the team builds. Pure SVG/CSS. */
export function HeroGraphic({ className }: { className?: string }) {
  const t = useTranslations("onboarding.setup.hero.nodes");
  // Label positions as % of the box (the lines below end at the same points).
  const nodes = [
    { key: "analysis", x: 50, y: 9 },
    { key: "strategy", x: 13, y: 38 },
    { key: "growth", x: 88, y: 38 },
    { key: "content", x: 20, y: 84 },
    { key: "sales", x: 80, y: 84 },
  ] as const;
  return (
    <div className={cn("relative aspect-[16/11] w-full select-none", className)} aria-hidden>
      <svg viewBox="0 0 320 220" className="absolute inset-0 size-full">
        <defs>
          <radialGradient id="hg-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--nova-blue)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--nova-blue)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hg-core" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--surface)" />
            <stop offset="100%" stopColor="var(--nova-blue-soft)" />
          </linearGradient>
          <linearGradient id="hg-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--nova-blue)" stopOpacity="0.1" />
            <stop offset="100%" stopColor="var(--nova-blue)" stopOpacity="0.45" />
          </linearGradient>
        </defs>
        <circle cx="160" cy="110" r="104" fill="url(#hg-glow)" />
        <circle cx="160" cy="110" r="74" fill="none" stroke="var(--nova-blue-line)" strokeDasharray="2 6" />
        {nodes.map((n) => (
          <path key={n.key} d={`M160 110 Q ${(160 + n.x * 3.2) / 2} ${(110 + n.y * 2.2) / 2 - 18} ${n.x * 3.2} ${n.y * 2.2}`} fill="none" stroke="url(#hg-line)" strokeWidth="1.4" />
        ))}
        {nodes.map((n, i) => (
          <circle key={n.key} cx={n.x * 3.2} cy={n.y * 2.2} r="3.2" fill="var(--accent)" className="motion-safe:animate-[nova-twinkle_3s_ease-in-out_infinite]" style={{ animationDelay: `${i * 0.5}s` }} />
        ))}
        <g className="motion-safe:animate-[nova-float_6s_ease-in-out_infinite]" style={{ transformOrigin: "160px 110px" }}>
          <polygon points="160,62 202,86 202,134 160,158 118,134 118,86" fill="url(#hg-core)" stroke="var(--nova-blue-line)" strokeWidth="1.5" />
          <polygon points="160,62 202,86 160,110 118,86" fill="var(--surface)" opacity="0.7" />
          <path d="M160 92c1.5 9.4 6.2 14.1 15.6 15.6-9.4 1.5-14.1 6.2-15.6 15.6-1.5-9.4-6.2-14.1-15.6-15.6 9.4-1.5 14.1-6.2 15.6-15.6Z" fill="var(--accent)" />
        </g>
      </svg>
      {nodes.map((n) => (
        <span
          key={n.key}
          className="absolute -translate-x-1/2 -translate-y-[130%] whitespace-nowrap rounded-full border border-nova-line bg-surface/90 px-2.5 py-1 text-[11px] font-semibold text-ink-2 shadow-xs backdrop-blur"
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
        >
          {t(n.key)}
        </span>
      ))}
    </div>
  );
}

/** The dark "technical" card atop the progress sidebar: the core the team works around. */
export function PartnerCard() {
  const t = useTranslations("onboarding.setup.sidebar");
  const tiles = [
    { Icon: BarChart3, x: "14%", y: "44%" },
    { Icon: Target, x: "86%", y: "44%" },
    { Icon: FileText, x: "22%", y: "82%" },
    { Icon: Users, x: "78%", y: "82%" },
  ];
  return (
    <div className="relative h-[210px] overflow-hidden rounded-t-[28px] bg-[linear-gradient(160deg,#0b1224_0%,#101a36_60%,#172447_100%)]" aria-hidden={false}>
      <p className="relative z-10 pt-5 text-center text-sm font-semibold text-white/90">{t("partner")}</p>
      <svg viewBox="0 0 340 200" className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <linearGradient id="pc-top" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5d8dff" />
            <stop offset="100%" stopColor="#2a4fb8" />
          </linearGradient>
          <linearGradient id="pc-left" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#233b82" />
            <stop offset="100%" stopColor="#101c44" />
          </linearGradient>
          <linearGradient id="pc-right" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a2d68" />
            <stop offset="100%" stopColor="#0c1636" />
          </linearGradient>
          <radialGradient id="pc-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff7a3d" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ff7a3d" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* floor grid */}
        {Array.from({ length: 9 }, (_, i) => (
          <path key={`a${i}`} d={`M${-40 + i * 50} 210 L${170} 120`} stroke="#3b5bb5" strokeOpacity="0.18" />
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <path key={`b${i}`} d={`M${380 - i * 50} 210 L${170} 120`} stroke="#3b5bb5" strokeOpacity="0.18" />
        ))}
        {/* connections */}
        {[
          [48, 88],
          [292, 88],
          [75, 164],
          [265, 164],
        ].map(([x, y], i) => (
          <path key={i} d={`M170 118 L${x} ${y}`} stroke="#ff7a3d" strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="3 4" className="motion-safe:animate-[nova-twinkle_4s_ease-in-out_infinite]" style={{ animationDelay: `${i * 0.6}s` }} />
        ))}
        <circle cx="170" cy="112" r="58" fill="url(#pc-glow)" />
        {/* cube */}
        <g className="motion-safe:animate-[nova-float_7s_ease-in-out_infinite]">
          <polygon points="170,72 212,94 170,116 128,94" fill="url(#pc-top)" />
          <polygon points="128,94 170,116 170,160 128,138" fill="url(#pc-left)" />
          <polygon points="212,94 170,116 170,160 212,138" fill="url(#pc-right)" />
          <polyline points="128,94 170,72 212,94" fill="none" stroke="#9cc0ff" strokeOpacity="0.8" />
          <path d="M170 84c1.1 6.9 4.5 10.3 11.4 11.4-6.9 1.1-10.3 4.5-11.4 11.4-1.1-6.9-4.5-10.3-11.4-11.4 6.9-1.1 10.3-4.5 11.4-11.4Z" fill="#ff7a3d" />
        </g>
      </svg>
      {tiles.map(({ Icon, x, y }, i) => (
        <span key={i} className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-[#9cc0ff] shadow-[0_8px_24px_-8px_rgb(0_0_0/0.6)] backdrop-blur" style={{ left: x, top: y }} aria-hidden>
          <Icon className="size-5" />
        </span>
      ))}
    </div>
  );
}

export function ProgressRing({ value, size = 96, stroke = 9, label }: { value: number; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} className="transition-[stroke-dashoffset] duration-700 ease-out" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-ink" dir="ltr">
        {value}%
      </span>
    </div>
  );
}
