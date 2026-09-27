"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

const TABS = ["", "organizations", "users", "ai", "integrations", "jobs", "incidents"] as const;

export function AdminNav() {
  const t = useTranslations("settings.admin.tabs");
  const pathname = usePathname();
  return (
    <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-5 scrollbar-none" aria-label={t("label")}>
      {TABS.map((tab) => {
        const href = `/admin${tab ? `/${tab}` : ""}`;
        const active = pathname === href;
        return (
          <Link key={tab} href={href} aria-current={active ? "page" : undefined} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium", active ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
            {t(tab || "overview")}
          </Link>
        );
      })}
    </nav>
  );
}
