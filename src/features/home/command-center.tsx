import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BarChart3, CalendarDays, CircleCheck, FileText, Megaphone, Users, type LucideIcon } from "lucide-react";
import { GlobalCommandInput, type CommandHistoryItem } from "./global-command-input";

type Module = { key: string; href: string; icon: LucideIcon; color: string };

const MODULES: Module[] = [
  { key: "content", href: "/content", icon: FileText, color: "text-[#0091ff]" },
  { key: "calendar", href: "/calendar", icon: CalendarDays, color: "text-[#16c0a4]" },
  { key: "leads", href: "/leads", icon: Users, color: "text-[#f59a3a]" },
  { key: "campaigns", href: "/campaigns", icon: Megaphone, color: "text-[#6647f0]" },
  { key: "approvals", href: "/approvals", icon: CircleCheck, color: "text-[#00c07a]" },
  { key: "analytics", href: "/analytics", icon: BarChart3, color: "text-[#fa24ce]" },
];

/**
 * Home header in the reference language: a left-aligned two-tone greeting, the AI command box as the page's
 * one rainbow-bordered element, and the six hubs as app tiles in a hairline grid.
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

      <div className="rainbow-border mt-7 rounded-[16px]">
        <div className="rounded-[16px] bg-surface p-1">
          <GlobalCommandInput suggestions={suggestions.map((s) => tc(`commands.${s.key}`))} history={history} />
        </div>
      </div>
      <p className="mt-3 text-[14px] text-ink-3">{t("hero.body")}</p>

      <nav aria-label={t("hero.headline")} className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-6">
        {MODULES.map((m) => {
          const Icon = m.icon;
          return (
            <Link key={m.key} href={m.href} className="group flex flex-col items-center gap-2.5 bg-surface px-2 py-4 text-center transition-colors duration-150 hover:bg-surface-2">
              <span className="app-tile size-10 transition-transform duration-300 ease-[var(--ease-out-soft)] group-hover:-translate-y-0.5">
                <Icon className={`size-5 ${m.color}`} strokeWidth={2} aria-hidden />
              </span>
              <span className="text-[13.5px] font-medium text-ink-2 group-hover:text-ink">{t(`orbit.${m.key}`)}</span>
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
