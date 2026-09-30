"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BarChart3, CircleCheck, Mail, PenSquare, Search, Sparkles, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { openCommand } from "@/features/command/store";
import { RefreshBriefButton } from "./home-client";

/** Small, lightweight illustration: a report sheet with a chart (inline SVG, no stock art). */
function BriefIllustration() {
  return (
    <svg viewBox="0 0 150 130" className="h-[118px] w-[136px] shrink-0" aria-hidden>
      <defs>
        <linearGradient id="bp" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e6efff" />
        </linearGradient>
      </defs>
      <g transform="rotate(-10 75 70)">
        <rect x="40" y="18" width="78" height="96" rx="10" fill="url(#bp)" stroke="#d6e3fb" />
        <rect x="52" y="32" width="40" height="5" rx="2.5" fill="#cfdcf5" />
        <rect x="52" y="42" width="54" height="4" rx="2" fill="#e1e9f8" />
        <rect x="52" y="50" width="48" height="4" rx="2" fill="#e1e9f8" />
      </g>
      <g transform="rotate(-6 60 90)">
        <rect x="18" y="52" width="70" height="62" rx="10" fill="#fff" stroke="#d6e3fb" />
        <rect x="32" y="88" width="7" height="14" rx="2" fill="#7fb0ff" />
        <rect x="43" y="80" width="7" height="22" rx="2" fill="#4b8df5" />
        <rect x="54" y="72" width="7" height="30" rx="2" fill="#2f6fe6" />
        <rect x="65" y="84" width="7" height="18" rx="2" fill="#9cc2ff" />
      </g>
      <path d="M124 14 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#f5a33a" />
    </svg>
  );
}

export function DailyBriefCard({ brief }: { brief: { id: string; narrative: string | null; offline: boolean } | null }) {
  const t = useTranslations("app.home");
  const tc = useTranslations("common");
  return (
    <section className="flex h-full flex-col rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="label-mono flex items-center gap-2">
          <Sparkles className="size-[18px] text-[var(--orbit-orange)]" aria-hidden /> {t("brief.label")}
        </h2>
        <RefreshBriefButton />
      </div>
      <div className="mt-2 flex flex-1 items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[19px] font-bold leading-snug text-ink">{brief ? t("brief.readyTitle") : t("brief.title")}</p>
          <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed text-ink-3" dir="auto">{brief?.narrative ?? t("brief.body")}</p>
          {brief && (
            <Link href={`/reports/${brief.id}`} className="mt-2 inline-block text-[13px] font-semibold text-nova-blue hover:underline">
              {t("brief.open")}
              {brief.offline && <span className="ms-2 font-normal text-ink-4">· {tc("aiOffline.badge")}</span>}
            </Link>
          )}
        </div>
        <BriefIllustration />
      </div>
    </section>
  );
}

type Action = { key: string; icon: LucideIcon; color: string; href?: string; run?: () => void };

export function QuickActionsCard() {
  const t = useTranslations("app.home.actions");
  const router = useRouter();
  const actions: Action[] = [
    { key: "approvals", icon: CircleCheck, color: "text-[var(--orbit-green)]", href: "/approvals" },
    { key: "deals", icon: BarChart3, color: "text-[var(--orbit-blue)]", href: "/sales" },
    { key: "leads", icon: Users, color: "text-[var(--orbit-orange)]", href: "/leads" },
    { key: "messages", icon: Mail, color: "text-[var(--orbit-purple)]", href: "/inbox" },
    { key: "create", icon: PenSquare, color: "text-[var(--orbit-blue)]", run: () => openCommand(t("createPrompt")) },
    { key: "ask", icon: Search, color: "text-[var(--orbit-blue)]", run: () => openCommand() },
  ];
  return (
    <section className="h-full rounded-xl border border-line bg-surface p-5 lg:order-first">
      <h2 className="mb-3 text-[15px] font-semibold text-ink">{t("title")}</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {actions.map(({ key, icon: Icon, color, href, run }) => (
          <button
            key={key}
            type="button"
            onClick={() => (href ? router.push(href) : run?.())}
            className="flex h-[46px] items-center gap-2.5 rounded-[10px] border border-line bg-surface px-2.5 text-start text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
          >
            <span className={cn("app-tile size-7 shrink-0 rounded-[8px]", color)}>
              <Icon className="size-4" strokeWidth={2} aria-hidden />
            </span>
            <span className="min-w-0 leading-tight">{t(key)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
