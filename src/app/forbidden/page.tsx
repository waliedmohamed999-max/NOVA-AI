import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "No access" };

export default async function ForbiddenPage() {
  const t = await getTranslations("errors.page");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-warning-soft text-warning"><ShieldAlert className="size-6" /></div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("forbiddenTitle")}</h1>
      <p className="max-w-sm text-ink-3">{t("forbiddenBody")}</p>
      <Link href="/home" className={buttonClass("primary", "md")}>{t("home")}</Link>
    </main>
  );
}
