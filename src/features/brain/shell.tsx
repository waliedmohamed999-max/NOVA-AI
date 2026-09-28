import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { BarChart3, Brain, Building2, Database, FileQuestion, Gauge, Megaphone, Package, Swords, Target, Upload, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { BrainSearch } from "./search-box";

export const BRAIN_TABS = ["overview", "profile", "products", "customers", "strategy", "market", "sales", "content", "faq", "sources", "imports", "health"] as const;
export type BrainTab = (typeof BRAIN_TABS)[number];

const ICONS: Record<BrainTab, LucideIcon> = {
  overview: Brain,
  profile: Building2,
  products: Package,
  customers: Users,
  strategy: Target,
  market: Swords,
  sales: BarChart3,
  content: Megaphone,
  faq: FileQuestion,
  sources: Database,
  imports: Upload,
  health: Gauge,
};

/** Company Brain workspace: internal navigation (sidebar on desktop, scrollable tabs on mobile) + search. */
export async function BrainShell({ tab, children, badges = {} }: { tab: BrainTab; children: ReactNode; badges?: Partial<Record<BrainTab, number>> }) {
  const t = await getTranslations("brain");
  return (
    <div className="space-y-5" data-brain-tab={tab}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-4" dir="ltr">
          NOVA / COMPANY BRAIN
        </p>
        <BrainSearch />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={t("navLabel")} className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
          <ul className="flex gap-1.5 lg:sticky lg:top-4 lg:flex-col">
            {BRAIN_TABS.map((k) => {
              const Icon = ICONS[k];
              const active = k === tab;
              return (
                <li key={k} className="shrink-0">
                  <Link
                    href={k === "overview" ? "/knowledge" : `/knowledge?tab=${k}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition",
                      active ? "bg-accent-soft font-semibold text-accent" : "text-ink-3 hover:bg-sunken hover:text-ink",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span>{t(`tabs.${k}`)}</span>
                    {badges[k] ? <span className="ms-auto rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning">{badges[k]}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="min-w-0 space-y-5">{children}</main>
      </div>
    </div>
  );
}
