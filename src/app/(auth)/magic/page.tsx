import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { KeyRound, MailWarning } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { peekMagicLink } from "@/server/auth/service";

export const metadata: Metadata = { title: "Sign in", referrer: "no-referrer" };

/** Confirmation step for magic links: viewing this page (or a scanner fetching it) does not sign anyone in. */
export default async function MagicLinkPage(props: PageProps<"/magic">) {
  const t = await getTranslations("auth.magicConfirm");
  const { token } = await props.searchParams;
  const link = typeof token === "string" && token ? await peekMagicLink(token) : null;
  if (!link)
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-warning-soft text-warning"><MailWarning className="size-6" /></div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("invalidTitle")}</h1>
        <p className="text-sm text-ink-3">{t("invalidBody")}</p>
        <Link href="/sign-in" className={buttonClass("primary", "lg", "w-full")}>{t("back")}</Link>
      </div>
    );
  return (
    <form method="post" action="/api/auth/magic" className="space-y-6 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink"><KeyRound className="size-6" /></div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-ink-3" dir="ltr">{link.email}</p>
      <input type="hidden" name="token" value={token as string} />
      <button type="submit" className={buttonClass("primary", "lg", "w-full")}>{t("continue")}</button>
      <p className="text-xs text-ink-4">{t("hint")}</p>
    </form>
  );
}
