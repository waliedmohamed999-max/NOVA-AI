"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocaleAction } from "@/features/auth/actions";
import { cn } from "@/lib/cn";

/** Switches between English (LTR) and Arabic (RTL); the whole UI re-renders with the new direction. */
export function LocaleSwitch({ className, compact }: { className?: string; compact?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = locale === "ar" ? "en" : "ar";

  return (
    <button
      type="button"
      onClick={() =>
        start(async () => {
          await setLocaleAction(next);
          router.refresh();
        })
      }
      disabled={pending}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 transition hover:border-line-strong hover:text-ink",
        pending && "opacity-60",
        className,
      )}
      aria-label={`${t("nav.language")}: ${t(`language.${next}`)}`}
    >
      <Languages className="size-4" aria-hidden />
      {!compact && <span lang={next}>{t(`language.${next}`)}</span>}
    </button>
  );
}
