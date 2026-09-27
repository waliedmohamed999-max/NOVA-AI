"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { PanelLeftClose, PanelLeftOpen, Sparkles } from "lucide-react";
import { brand } from "@/config/brand";
import { cn } from "@/lib/cn";
import { LogoMark } from "@/components/brand/logo";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { Tooltip, TooltipProvider } from "@/components/ui/menu";
import { FOOTER_NAV, MOBILE_TABS, MORE_ICON, PRIMARY_NAV, SECONDARY_NAV, type NavItem } from "./nav-config";
import { UserMenu } from "./user-menu";
import { NotificationBell } from "./notification-bell";
import { CommandBar, useCommandBar } from "@/features/command/command-bar";

export type ShellData = {
  user: { name: string | null; email: string; isPlatformAdmin: boolean };
  organization: { name: string; isDemo: boolean };
  role: string;
  counts: { approvals: number; hotLeads: number; unreadNotifications: number };
  collapsed: boolean;
  aiOffline: boolean;
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, collapsed, count, onNavigate }: { item: NavItem; collapsed: boolean; count?: number; onNavigate?: () => void }) {
  const t = useTranslations("common.nav");
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  const label = t(item.key as "home");
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-xl px-2.5 text-[14px] font-medium transition-colors duration-150",
        active ? "bg-surface text-ink shadow-xs ring-1 ring-line" : "text-ink-3 hover:bg-sunken hover:text-ink",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className={cn("size-[18px] shrink-0", active ? "text-ink" : "text-ink-3 group-hover:text-ink")} strokeWidth={active ? 2.2 : 1.9} aria-hidden />
      {!collapsed && <span className="truncate">{label}</span>}
      {count ? (
        <span
          className={cn(
            "tabular rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-white",
            collapsed ? "absolute -end-0.5 -top-0.5 min-w-[18px] text-center" : "ms-auto",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function countFor(item: NavItem, counts: ShellData["counts"]) {
  if (item.badge === "approvals") return counts.approvals;
  if (item.badge === "leads") return counts.hotLeads;
  return undefined;
}

export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const t = useTranslations("common");
  const [collapsed, setCollapsed] = useState(data.collapsed);
  const [moreOpen, setMoreOpen] = useState(false);
  const command = useCommandBar();
  const pathname = usePathname();

  useEffect(() => {
    document.cookie = `${brand.sidebarCookie}=${collapsed ? "1" : "0"};path=/;max-age=31536000;samesite=lax`;
  }, [collapsed]);

  return (
    <TooltipProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[70] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-ink-inverse">
        {t("nav.skipToContent")}
      </a>
      <div className="flex min-h-dvh">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-line bg-canvas px-3 pb-3 pt-4 transition-[width] duration-300 ease-[var(--ease-out-soft)] lg:flex",
            collapsed ? "w-[68px]" : "w-[236px]",
          )}
        >
          <div className={cn("mb-5 flex items-center", collapsed ? "justify-center" : "justify-between px-1")}>
            <Link href="/home" className="flex items-center gap-2.5" aria-label={brand.name}>
              <LogoMark />
              {!collapsed && (
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold tracking-[0.14em]" dir="ltr">
                    {brand.name}
                  </span>
                  <span className="block max-w-[130px] truncate text-[11px] text-ink-3">{data.organization.name}</span>
                </span>
              )}
            </Link>
            {!collapsed && (
              <button onClick={() => setCollapsed(true)} className="rounded-lg p-1.5 text-ink-4 hover:bg-sunken hover:text-ink" aria-label={t("nav.collapse")}>
                <PanelLeftClose className="size-4 flip-rtl" />
              </button>
            )}
          </div>

          <nav aria-label={t("nav.mainNav")} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-none">
            {PRIMARY_NAV.map((item) => (
              <NavLink key={item.href} item={item} collapsed={collapsed} count={countFor(item, data.counts)} />
            ))}
            <div className="my-3 h-px bg-line" />
            {SECONDARY_NAV.map((item) => (
              <NavLink key={item.href} item={item} collapsed={collapsed} count={countFor(item, data.counts)} />
            ))}
          </nav>

          <div className="mt-2 flex flex-col gap-0.5 border-t border-line pt-3">
            {FOOTER_NAV.map((item) => (
              <NavLink key={item.href} item={item} collapsed={collapsed} />
            ))}
            {collapsed && (
              <button onClick={() => setCollapsed(false)} className="mx-auto mt-1 rounded-lg p-2 text-ink-4 hover:bg-sunken hover:text-ink" aria-label={t("nav.expand")}>
                <PanelLeftOpen className="size-4 flip-rtl" />
              </button>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/85 backdrop-blur-xl">
            <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
              <Link href="/home" className="lg:hidden" aria-label={brand.name}>
                <LogoMark />
              </Link>
              <button
                onClick={() => command.open()}
                className="group flex h-11 min-w-0 flex-1 items-center gap-3 rounded-full border border-line bg-surface ps-4 pe-2 text-start text-[14px] text-ink-4 shadow-xs transition hover:border-line-strong hover:shadow-sm md:max-w-xl"
                aria-label={t("command.dialogTitle")}
              >
                <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
                <span className="truncate">{t("command.placeholder")}</span>
                <span className="ms-auto hidden items-center gap-1 rounded-full bg-sunken px-2 py-1 text-[11px] font-medium text-ink-3 sm:inline-flex">
                  <span className="font-mono">⌘K</span>
                </span>
              </button>
              <div className="ms-auto flex items-center gap-1.5">
                {data.aiOffline && (
                  <Tooltip content={t("aiOffline.hint")} side="bottom">
                    <span className="hidden rounded-full border border-dashed border-line-strong px-2.5 py-1 text-[11px] font-medium text-ink-3 xl:inline-flex">
                      {t("aiOffline.badge")}
                    </span>
                  </Tooltip>
                )}
                <NotificationBell unread={data.counts.unreadNotifications} />
                <UserMenu user={data.user} />
              </div>
            </div>
            {data.organization.isDemo && (
              <div className="border-t border-line/70 bg-accent-soft/60 px-4 py-1.5 text-center text-xs font-medium text-accent-ink">{t("demo.banner")}</div>
            )}
          </header>

          <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-16 lg:pt-8">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label={t("nav.mainNav")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-2">
          {MOBILE_TABS.slice(0, 2).map((item) => (
            <MobileTab key={item.href} item={item} active={isActive(pathname, item.href)} count={countFor(item, data.counts)} />
          ))}
          <div className="flex justify-center">
            <button
              onClick={() => command.open()}
              className="-mt-6 flex size-14 items-center justify-center rounded-full bg-ink text-ink-inverse shadow-lg ring-4 ring-canvas transition active:scale-95"
              aria-label={t("command.dialogTitle")}
            >
              <Sparkles className="size-5 text-accent" />
            </button>
          </div>
          {MOBILE_TABS.slice(2).map((item) => (
            <MobileTab key={item.href} item={item} active={isActive(pathname, item.href)} count={countFor(item, data.counts)} />
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center gap-1 text-[11px] font-medium text-ink-3"
            aria-haspopup="dialog"
          >
            <MORE_ICON className="size-5" aria-hidden />
            {t("nav.more")}
          </button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent title={t("nav.more")}>
          <div className="grid grid-cols-3 gap-2">
            {[...PRIMARY_NAV, ...SECONDARY_NAV, ...FOOTER_NAV].map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface-2 px-2 py-4 text-center text-[12px] font-medium text-ink-2",
                    isActive(pathname, item.href) && "border-ink text-ink",
                  )}
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
        <Icon className="size-5" strokeWidth={active ? 2.3 : 1.9} aria-hidden />
        {count ? <span className="absolute -end-2 -top-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-white">{count > 9 ? "9+" : count}</span> : null}
      </span>
      {t(item.key as "home")}
    </Link>
  );
}
