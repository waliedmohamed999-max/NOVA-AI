import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Compass } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors.page");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-sunken text-ink-2"><Compass className="size-6" /></div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("notFoundTitle")}</h1>
      <p className="max-w-sm text-ink-3">{t("notFoundBody")}</p>
      <Link href="/" className={buttonClass("primary", "md")}>{t("home")}</Link>
    </main>
  );
}
