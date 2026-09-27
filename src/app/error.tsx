"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";

/** Human-friendly error screen. Technical detail stays in server logs (digest only). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors.page");
  const tc = useTranslations("common.actions");
  useEffect(() => {
    console.error(error.digest ?? error.message);
  }, [error]);
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-5 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger"><TriangleAlert className="size-6" /></div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="max-w-sm text-ink-3">{t("body")}</p>
      <div className="flex gap-2">
        <Button onClick={reset}>{tc("retry")}</Button>
        <Link href="/home" className={buttonClass("secondary", "md")}>{t("home")}</Link>
      </div>
      {error.digest && <p className="font-mono text-xs text-ink-4">ref: {error.digest}</p>}
    </main>
  );
}
