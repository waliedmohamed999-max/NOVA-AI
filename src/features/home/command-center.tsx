import { getTranslations } from "next-intl/server";
import { BarChart3, CalendarDays, CircleCheck, FileText, Megaphone, Users } from "lucide-react";
import { NovaOrb } from "./nova-orb";
import { OrbitDot, OrbitModule, type OrbitColor } from "./orbit-module";
import { GlobalCommandInput, type CommandHistoryItem } from "./global-command-input";

type Module = { key: string; href: string; icon: typeof CalendarDays; color: OrbitColor; dot: OrbitColor };

// "start" side = next to the sidebar (right in Arabic), mirrored in English.
const START: Module[] = [
  { key: "calendar", href: "/calendar", icon: CalendarDays, color: "green", dot: "cyan" },
  { key: "leads", href: "/leads", icon: Users, color: "orange", dot: "purple" },
  { key: "approvals", href: "/approvals", icon: CircleCheck, color: "green", dot: "green" },
];
const END: Module[] = [
  { key: "content", href: "/content", icon: FileText, color: "blue", dot: "blue" },
  { key: "campaigns", href: "/campaigns", icon: Megaphone, color: "purple", dot: "orange" },
  { key: "analytics", href: "/analytics", icon: BarChart3, color: "blue", dot: "blue" },
];

// Vertical positions (%) and horizontal inset (%) of the three modules on each side.
const ROWS = [
  { top: 16, inset: 9 },
  { top: 50, inset: 1.5 },
  { top: 84, inset: 9 },
];
// Where each connector meets its module (percent of the orbit area width, measured from the side's edge).
const DOT_X = [32, 26, 32];

/**
 * Home header: left-aligned two-tone greeting, the NOVA orb with the six hubs orbiting it, and the AI
 * command box (the page's single rainbow-bordered element).
 */
export async function HomeCommandCenter({
  name,
  period,
  agentsWorking,
  suggestions = [],
  history = [],
}: {
  name: string;
  period: "morning" | "afternoon" | "evening";
  agentsWorking: number;
  suggestions?: { key: string }[];
  history?: CommandHistoryItem[];
}) {
  const t = await getTranslations("app.home");
  const tc = await getTranslations("common.cmd");
  return (
    <section aria-labelledby="home-greeting" className="animate-fade-up">
      <h2 className="label-mono">{t("hero.headline")}</h2>
      <h1 id="home-greeting" className="mt-3 text-[34px] font-bold leading-[1.08] tracking-[-0.04em] text-ink sm:text-[44px]">
        <span>{t(`hero.greeting.${period}`, { name })}</span>{" "}
        <span className="tone-tail block text-[0.62em] leading-[1.25] tracking-[-0.03em]" dir="auto">
          {agentsWorking ? t("hero.working", { count: agentsWorking }) : t("hero.calm")}
        </span>
      </h1>

      {/* Orbit system (md+) */}
      <div className="relative mx-auto mt-4 hidden h-[300px] max-w-[860px] md:block">
        <div className="pointer-events-none absolute inset-x-0 top-[10%] h-[80%] bg-[radial-gradient(ellipse_at_center,rgba(120,180,255,.22),transparent_65%)]" aria-hidden />
        <svg viewBox="0 0 1000 300" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
          <g fill="none" stroke="rgba(100,150,225,.5)" strokeWidth="1" vectorEffect="non-scaling-stroke">
            <ellipse cx="500" cy="150" rx="330" ry="118" vectorEffect="non-scaling-stroke" />
            <ellipse cx="500" cy="150" rx="250" ry="86" vectorEffect="non-scaling-stroke" opacity=".7" />
            {[0, 1, 2].map((i) => {
              const y = (ROWS[i].top / 100) * 300;
              const x = DOT_X[i] * 10;
              return (
                <g key={i}>
                  <path d={`M ${x} ${y} C ${x + 70} ${y} ${380} ${150 + (y - 150) * 0.35} 400 ${150 + (y - 150) * 0.3}`} vectorEffect="non-scaling-stroke" />
                  <path d={`M ${1000 - x} ${y} C ${1000 - x - 70} ${y} ${620} ${150 + (y - 150) * 0.35} 600 ${150 + (y - 150) * 0.3}`} vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
          </g>
        </svg>
        {[0, 1, 2].map((i) => (
          <span key={`d${i}`}>
            <OrbitDot color={END[i].dot} style={{ left: `${DOT_X[i]}%`, top: `${ROWS[i].top}%` }} />
            <OrbitDot color={START[i].dot} style={{ left: `${100 - DOT_X[i]}%`, top: `${ROWS[i].top}%` }} />
          </span>
        ))}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[52%]">
          <NovaOrb size={236} subtitle="AI OPERATING SYSTEM" />
        </div>
        {START.map((m, i) => (
          <div key={m.key} className="absolute -translate-y-1/2" style={{ top: `${ROWS[i].top}%`, insetInlineStart: `${ROWS[i].inset}%` }}>
            <OrbitModule href={m.href} label={t(`orbit.${m.key}`)} icon={m.icon} color={m.color} />
          </div>
        ))}
        {END.map((m, i) => (
          <div key={m.key} className="absolute -translate-y-1/2" style={{ top: `${ROWS[i].top}%`, insetInlineEnd: `${ROWS[i].inset}%` }}>
            <OrbitModule href={m.href} label={t(`orbit.${m.key}`)} icon={m.icon} color={m.color} />
          </div>
        ))}
      </div>

      {/* Small screens: orb + module grid */}
      <div className="relative mt-3 flex flex-col items-center md:hidden">
        <NovaOrb size={150} subtitle="AI OPERATING SYSTEM" />
        <div className="relative mt-1 grid w-full grid-cols-3 gap-2">
          {[...START, ...END].map((m) => (
            <OrbitModule key={m.key} href={m.href} label={t(`orbit.${m.key}`)} icon={m.icon} color={m.color} compact />
          ))}
        </div>
      </div>

      <div className="rainbow-border mt-5 rounded-[16px] md:mt-6">
        <div className="rounded-[16px] bg-surface p-1">
          <GlobalCommandInput suggestions={suggestions.map((s) => tc(`commands.${s.key}`))} history={history} />
        </div>
      </div>
      <p className="mt-3 text-[14px] text-ink-3">{t("hero.body")}</p>
    </section>
  );
}
