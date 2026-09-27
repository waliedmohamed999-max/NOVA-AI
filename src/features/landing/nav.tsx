"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/brand/logo";
import { buttonClass } from "@/components/ui/button";
import { LocaleSwitch } from "@/components/shell/locale-switch";

const LINKS = [
  { href: "#team", key: "product" },
  { href: "#team", key: "team" },
  { href: "#how", key: "how" },
  { href: "#pricing", key: "pricing" },
  { href: "#brain", key: "resources" },
] as const;

export function LandingNav({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("landing.nav");
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cn("sticky top-0 z-40 transition-all duration-300", scrolled ? "border-b border-line/70 bg-canvas/80 backdrop-blur-xl" : "border-b border-transparent")}>
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-5 lg:px-8" aria-label="Main">
        <Link href="/" aria-label="Home">
          <Logo />
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.key}>
              <a href={l.href} className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-2 transition hover:bg-sunken hover:text-ink">
                {t(l.key)}
              </a>
            </li>
          ))}
        </ul>
        <div className="hidden items-center gap-2 md:flex">
          <LocaleSwitch compact />
          {signedIn ? (
            <Link href="/home" className={buttonClass("primary", "sm")}>{t("open")}</Link>
          ) : (
            <>
              <Link href="/sign-in" className={buttonClass("ghost", "sm")}>{t("signIn")}</Link>
              <Link href="/sign-up" className={buttonClass("primary", "sm")}>{t("start")}</Link>
            </>
          )}
        </div>
        <button className="rounded-full p-2 md:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>
      {open && (
        <div className="border-t border-line bg-canvas px-5 pb-6 pt-3 md:hidden">
          <ul className="space-y-1">
            {LINKS.map((l) => (
              <li key={l.key}>
                <a href={l.href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-3 text-base font-medium">
                  {t(l.key)}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <LocaleSwitch />
            <Link href={signedIn ? "/home" : "/sign-up"} className={buttonClass("primary", "md", "flex-1")}>{signedIn ? t("open") : t("start")}</Link>
          </div>
        </div>
      )}
    </header>
  );
}
