"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Search, Sparkles } from "lucide-react";
import { brand } from "@/config/brand";
import { cn } from "@/lib/cn";
import { LogoMark } from "@/components/brand/logo";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { Tooltip, TooltipProvider } from "@/components/ui/menu";
import { FOOTER_NAV, MOBILE_TABS, MORE_ICON, NAV_GROUPS, PRIMARY_NAV, type NavGroup, type NavItem } from "./nav-config";
import { UserMenu } from "./user-menu";
import { NotificationBell } from "./notification-bell";
import { CommandBar, useCommandBar } from "@/features/command/command-bar";

export type ShellData = {
  user: { name: string | null; email: string; isPlatformAdmin: boolean };
  organization: { name: string; isDemo: boolean };
  role: string;
  counts: { approvals: number; hotLeads: number; unreadNotifications: number };
  collapsed: boolean;
  ai: "live" | "offline" | "off";
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function groupFor(pathname: string): NavGroup | undefined {
  return NAV_GROUPS.find((g) => g.items.some((i) => isActive(pathname, i.href)));
}

function countFor(item: NavItem, counts: ShellData["counts"]) {
  if (item.badge === "approvals") return counts.approvals;
  if (item.badge === "leads") return counts.hotLeads;
  return undefined;
}

/** Black rail button: icon + tiny label (reference: Home / Spaces / Chat / AI / Apps). */
function RailButton({ href, icon: Icon, label, active, count }: { href: string; icon: NavItem["icon"]; label: string; active: boolean; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex w-[52px] flex-col items-center gap-1 rounded-[10px] py-2 text-[10px] font-semibold transition-colors duration-150",
        active ? "bg-white/[0.14] text-white" : "text-white/55 hover:bg-white/[0.07] hover:text-white",
      )}
    >
      <Icon className="size-[19px]" aria-hidden />
      <span className="max-w-full truncate px-0.5">{label}</span>
      {count ? <span className="tabular absolute end-1 top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[9px] font-bold leading-4 text-white">{count > 99 ? "99+" : count}</span> : null}
    </Link>
  );
}

/** Light sidebar row (reference list sidebar): icon + label, violet wash when active. */
function SideLink({ item, count, onNavigate }: { item: NavItem; count?: number; onNavigate?: () => void }) {
  const t = useTranslations("common.nav");
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-9 items-center gap-2.5 rounded-[8px] px-2.5 text-[14px] font-medium transition-colors duration-150",
        active ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.05]",
      )}
    >
      <Icon className={cn("size-[17px] shrink-0", active ? "text-accent" : "text-ink-3 group-hover:text-ink")} aria-hidden />
      <span className="truncate">{t(item.key as "home")}</span>
      {count ? <span className="tabular ms-auto rounded-[5px] bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-white">{count > 99 ? "99+" : count}</span> : null}
    </Link>
  );
}

export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const t = useTranslations("common");
  const [collapsed, setCollapsed] = useState(data.collapsed);
  const [moreOpen, setMoreOpen] = useState(false);
  const command = useCommandBar();
  const pathname = usePathname();
  const group = groupFor(pathname) ?? NAV_GROUPS[0];
  const footerActive = FOOTER_NAV.find((i) => isActive(pathname, i.href));

  useEffect(() => {
    document.cookie = `${brand.sidebarCookie}=${collapsed ? "1" : "0"};path=/;max-age=31536000;samesite=lax`;
  }, [collapsed]);

  const groupCount = (g: NavGroup) => g.items.reduce((n, i) => n + (countFor(i, data.counts) ?? 0), 0) || undefined;

  return (
    <TooltipProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[70] focus:rounded-[8px] focus:bg-ink focus:px-4 focus:py-2 focus:text-ink-inverse">
        {t("nav.skipToContent")}
      </a>
      <div className="flex min-h-dvh bg-surface-2">
        {/* Black icon rail */}
        <aside className="sticky top-0 hidden h-dvh w-[68px] shrink-0 flex-col items-center gap-1 bg-[#111111] py-3 lg:flex" aria-label={t("nav.mainNav")}>
          <Link href="/home" aria-label={brand.name} className="mb-3 rounded-[10px] p-1 transition-opacity hover:opacity-85">
            <LogoMark size={32} />
          </Link>
          <nav className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-none">
            {NAV_GROUPS.map((g) => (
              <RailButton key={g.key} href={g.items[0].href} icon={g.icon} label={t(`nav.groups.${g.key}`)} active={!footerActive && g.key === group.key} count={groupCount(g)} />
            ))}
          </nav>
          <div className="flex flex-col items-center gap-1 border-t border-white/10 pt-2">
            {FOOTER_NAV.map((i) => (
              <RailButton key={i.href} href={i.href} icon={i.icon} label={t(`nav.${i.key}` as "nav.home")} active={Boolean(footerActive && footerActive.href === i.href)} />
            ))}
            {collapsed && (
              <Tooltip content={t("nav.expand")} side="right">
                <button onClick={() => setCollapsed(false)} className="mt-1 rounded-[8px] p-2 text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white" aria-label={t("nav.expand")}>
                  <PanelLeftOpen className="size-4 flip-rtl" />
                </button>
              </Tooltip>
            )}
          </div>
        </aside>

        {/* Light hub sidebar */}
        {!collapsed && (
          <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col px-3 pb-3 pt-3 lg:flex">
            <div className="mb-4 flex items-center gap-1">
              <span className="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 py-1.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-[#f59a3a] text-[12px] font-bold text-white" aria-hidden>
                  {data.organization.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate text-[14px] font-semibold text-ink">{data.organization.name}</span>
                <ChevronDown className="size-3.5 shrink-0 text-ink-4" aria-hidden />
              </span>
              <button onClick={() => setCollapsed(true)} className="rounded-[8px] p-1.5 text-ink-4 transition-colors hover:bg-black/[0.05] hover:text-ink" aria-label={t("nav.collapse")}>
                <PanelLeftClose className="size-4 flip-rtl" />
              </button>
            </div>
            <p className="label-mono mb-2 px-2.5">{t(`nav.groups.${group.key}`)}</p>
            <nav aria-label={t(`nav.groups.${group.key}`)} className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <SideLink key={item.href} item={item} count={countFor(item, data.counts)} />
              ))}
            </nav>
            {group.key !== "home" && (
              <div className="mt-5 border-t border-line pt-4">
                <SideLink item={NAV_GROUPS[0].items[1]} count={data.counts.approvals} />
              </div>
            )}
            <div className="mt-auto rounded-[10px] border border-line bg-surface p-3">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
                <span className={cn("size-1.5 rounded-full", data.ai === "live" ? "bg-[#00c07a]" : data.ai === "offline" ? "bg-[#f59a3a]" : "bg-ink-4")} />
                {data.ai === "offline" ? t("aiOffline.badge") : data.ai === "live" ? t("aiStatus.live") : t("aiStatus.off")}
              </p>
              <p className="mt-1 text-[11.5px] leading-snug text-ink-4">{data.ai === "offline" ? t("aiOffline.hint") : data.ai === "live" ? t("aiStatus.liveHint") : t("aiStatus.offHint")}</p>
            </div>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col lg:py-2 lg:pe-2">
          {/* Top bar */}
          <header className="sticky top-0 z-30 bg-surface-2/95 backdrop-blur-xl lg:static lg:bg-transparent">
            <div className="flex h-[52px] items-center gap-3 px-4 lg:h-11 lg:px-1">
              <Link href="/home" className="lg:hidden" aria-label={brand.name}>
                <LogoMark />
              </Link>
              <button
                onClick={() => command.open()}
                className="group mx-auto flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[9px] border border-line bg-surface px-3 text-start text-[13.5px] text-ink-4 transition-colors duration-150 hover:border-line-strong md:max-w-[520px]"
                aria-label={t("command.dialogTitle")}
              >
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{t("command.placeholder")}</span>
                <Sparkles className="ms-auto size-4 shrink-0 text-accent" aria-hidden />
                <span className="hidden font-mono text-[11px] text-ink-4 sm:inline" dir="ltr">
                  ⌘K
                </span>
              </button>
              <div className="flex items-center gap-1.5">
                <NotificationBell unread={data.counts.unreadNotifications} />
                <UserMenu user={data.user} />
              </div>
            </div>
          </header>

          {/* White content panel inside the grey frame */}
          <div className="flex min-h-0 flex-1 flex-col bg-canvas lg:rounded-[12px] lg:border lg:border-line">
            {data.organization.isDemo && <div className="border-b border-line bg-accent-soft/60 px-4 py-1.5 text-center text-xs font-medium text-accent-ink lg:rounded-t-[12px]">{t("demo.banner")}</div>}
            <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-7">
              {children}
            </main>
          </div>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label={t("nav.mainNav")} className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-2">
          {MOBILE_TABS.slice(0, 2).map((item) => (
            <MobileTab key={item.href} item={item} active={isActive(pathname, item.href)} count={countFor(item, data.counts)} />
          ))}
          <div className="flex justify-center">
            <button
              onClick={() => command.open()}
              className="-mt-6 flex size-14 items-center justify-center rounded-[16px] bg-ink text-ink-inverse shadow-lg ring-4 ring-canvas transition active:scale-95"
              aria-label={t("command.dialogTitle")}
            >
              <Sparkles className="size-5 text-accent" />
            </button>
          </div>
          {MOBILE_TABS.slice(2).map((item) => (
            <MobileTab key={item.href} item={item} active={isActive(pathname, item.href)} count={countFor(item, data.counts)} />
          ))}
          <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-1 text-[11px] font-medium text-ink-3" aria-haspopup="dialog">
            <MORE_ICON className="size-5" aria-hidden />
            {t("nav.more")}
          </button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent title={t("nav.more")}>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
            {[...PRIMARY_NAV, ...FOOTER_NAV].map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn("flex flex-col items-center gap-2 bg-surface px-2 py-4 text-center text-[12px] font-medium text-ink-2", isActive(pathname, item.href) && "bg-accent-soft text-accent-ink")}
                >
                  <Icon className="size-5" aria-hidden />
                  {t(`nav.${item.key}` as "nav.home")}
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Dialog>

      <CommandBar controller={command} />
    </TooltipProvider>
  );
}

function MobileTab({ item, active, count }: { item: NavItem; active: boolean; count?: number }) {
  const t = useTranslations("common.nav");
  const Icon = item.icon;
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("relative flex flex-col items-center gap-1 text-[11px] font-medium", active ? "text-ink" : "text-ink-3")}>
      <span className="relative">
        <Icon className="size-5" strokeWidth={active ? 2.3 : 1.75} aria-hidden />
        {count ? <span className="absolute -end-2 -top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-white">{count > 9 ? "9+" : count}</span> : null}
      </span>
      {t(item.key as "home")}
    </Link>
  );
}
