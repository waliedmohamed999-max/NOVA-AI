import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, MailWarning } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { AuthError, verifyEmail } from "@/server/auth/service";
import { getSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage(props: PageProps<"/verify-email">) {
  const t = await getTranslations("auth.verify");
  const { token } = await props.searchParams;
  let ok = false;
  if (typeof token === "string" && token) {
    try {
      await verifyEmail(token);
      ok = true;
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
    }
  }
  const session = await getSession();
  return (
    <div className="space-y-6 text-center">
      <div className={`mx-auto flex size-14 items-center justify-center rounded-2xl ${ok ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
        {ok ? <CheckCircle2 className="size-6" /> : <MailWarning className="size-6" />}
      </div>
      <h1 className="text-[32px] font-bold leading-tight tracking-[-0.035em]">{ok ? t("success") : t("failed")}</h1>
      <Link href={session ? "/home" : "/sign-in"} className={buttonClass("primary", "lg", "w-full")}>
        {t("continue")}
      </Link>
    </div>
  );
}
