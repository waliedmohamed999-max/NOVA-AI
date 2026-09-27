"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Languages, LogOut, Moon, Settings, Shield, Sun, User } from "lucide-react";
import { Avatar } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { setLocaleAction, setThemeAction, signOutAction } from "@/features/auth/actions";

export function UserMenu({ user }: { user: { name: string | null; email: string; isPlatformAdmin: boolean } }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [, start] = useTransition();

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    start(() => setThemeAction(next));
  };
  const switchLocale = () =>
    start(async () => {
      await setLocaleAction(locale === "ar" ? "en" : "ar");
      router.refresh();
    });

  return (
    <Menu>
      <MenuTrigger className="rounded-full ring-offset-2 ring-offset-canvas transition hover:ring-2 hover:ring-line-strong" aria-label={t("nav.account")}>
        <Avatar name={user.name ?? user.email} size={34} />
      </MenuTrigger>
      <MenuContent className="w-64">
        <MenuLabel>
          <div className="truncate text-sm font-semibold text-ink">{user.name ?? user.email}</div>
          <div className="truncate text-xs font-normal text-ink-3">{user.email}</div>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem icon={<User />} asChild>
          <Link href="/settings/profile">{t("nav.account")}</Link>
        </MenuItem>
        <MenuItem icon={<Settings />} asChild>
          <Link href="/settings">{t("nav.settings")}</Link>
        </MenuItem>
        <MenuItem icon={<Languages />} onSelect={switchLocale}>
          <span lang={locale === "ar" ? "en" : "ar"}>{t(`language.${locale === "ar" ? "en" : "ar"}`)}</span>
        </MenuItem>
        <MenuItem icon={<ThemeIcon />} onSelect={toggleTheme}>
          {t("nav.theme")}
        </MenuItem>
        {user.isPlatformAdmin && (
          <MenuItem icon={<Shield />} asChild>
            <Link href="/admin">{t("nav.admin")}</Link>
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={() => start(() => signOutAction())}>
          {t("nav.signOut")}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function ThemeIcon() {
  return (
    <>
      <Moon className="dark:hidden" />
      <Sun className="hidden dark:block" />
    </>
  );
}
