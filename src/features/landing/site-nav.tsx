"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/brand/logo";
import { buttonClass } from "@/components/ui/button";
import { LocaleSwitch } from "@/components/shell/locale-switch";

const LINKS = [
  { href: "#product", key: "product", menu: true },
  { href: "#team", key: "team", menu: false },
  { href: "#pricing", key: "pricing", menu: false },
] as const;

/** Reference nav: logo, text links (chevron = section menu), then "How it works", grey "Log in", ink "Sign up". */
export function SiteNav({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("landing.nav");
  const v = useTranslations("landing.v2.nav");
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cn("sticky top-0 z-40 bg-canvas/90 backdrop-blur-xl transition-[border-color] duration-300", scrolled ? "border-b border-line" : "border-b border-transparent")}>
      <nav className="mx-auto flex h-[60px] max-w-[1200px] items-center gap-8 px-5" aria-label="Main">
        <Link href="/" aria-label="NOVA" className="shrink-0">
          <Logo />
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.key}>
              <a href={l.href} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[15px] font-medium text-ink-3 transition-colors duration-150 hover:bg-black/[0.04] hover:text-ink">
                {t(l.key)}
                {l.menu && <ChevronDown className="size-3.5 opacity-70" aria-hidden />}
              </a>
            </li>
          ))}
        </ul>
        <div className="ms-auto hidden items-center gap-2 md:flex">
          <LocaleSwitch compact />
          <a href="#how" className="px-2 text-[15px] font-medium text-ink-3 transition-colors hover:text-ink">{v("demo")}</a>
          {signedIn ? (
            <Link href="/home" className={buttonClass("primary", "sm", "h-9 px-3.5 text-[15px]")}>{t("open")}</Link>
          ) : (
            <>
              <Link href="/sign-in" className={buttonClass("secondary", "sm", "h-9 px-3.5 text-[15px]")}>{v("login")}</Link>
              <Link href="/sign-up" className={buttonClass("primary", "sm", "h-9 px-3.5 text-[15px]")}>{v("signup")}</Link>
            </>
          )}
        </div>
        <button className="ms-auto rounded-[8px] p-2 md:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Menu">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>
      {open && (
        <div className="border-t border-line bg-canvas px-5 pb-6 pt-3 md:hidden">
          <ul>
            {LINKS.map((l) => (
              <li key={l.key} className="border-b border-line last:border-0">
                <a href={l.href} onClick={() => setOpen(false)} className="block py-3.5 text-[17px] font-semibold">
                  {t(l.key)}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href={signedIn ? "/home" : "/sign-in"} className={buttonClass("secondary", "md")}>{signedIn ? t("open") : v("login")}</Link>
            <Link href="/sign-up" className={buttonClass("primary", "md")}>{v("signup")}</Link>
          </div>
          <div className="mt-3"><LocaleSwitch /></div>
        </div>
      )}
    </header>
  );
}
