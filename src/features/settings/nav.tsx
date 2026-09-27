"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

export const SETTINGS_SECTIONS = [
  { href: "/settings", key: "organization" },
  { href: "/settings/profile", key: "profile" },
  { href: "/settings/team", key: "team" },
  { href: "/brand", key: "brand" },
  { href: "/settings/ai", key: "ai" },
  { href: "/settings/approvals", key: "approvals" },
  { href: "/integrations", key: "integrations" },
  { href: "/settings/lead-capture", key: "leadCapture" },
  { href: "/settings/notifications", key: "notifications" },
  { href: "/settings/billing", key: "billing" },
  { href: "/settings/security", key: "security" },
  { href: "/settings/data", key: "data" },
] as const;

export function SettingsNav() {
  const t = useTranslations("settings.sections");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {SETTINGS_SECTIONS.map((s) => {
          const active = pathname === s.href;
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition",
                  active ? "bg-surface text-ink shadow-xs ring-1 ring-line" : "text-ink-3 hover:bg-sunken hover:text-ink",
                )}
              >
                {t(s.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
