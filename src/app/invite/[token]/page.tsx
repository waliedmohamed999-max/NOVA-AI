import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MailWarning, Users } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { buttonClass } from "@/components/ui/button";
import { getSession } from "@/server/auth/session";
import { lookupInvitation } from "@/server/team/invitations";
import { InviteDecision } from "@/features/settings/invite-decision";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const t = await getTranslations("settings.invite");
  const tc = await getTranslations("common");
  const { state, invitation } = await lookupInvitation(token);
  const session = await getSession();
  const next = encodeURIComponent(`/invite/${token}`);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <Logo className="mb-10" />
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-md">
        {state !== "valid" || !invitation ? (
          <>
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-warning-soft text-warning"><MailWarning className="size-6" /></div>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">{t(`states.${state}` as "states.expired")}</h1>
            <p className="mt-2 text-sm text-ink-3">{t("askAgain")}</p>
            <Link href="/" className={`mt-6 ${buttonClass("secondary", "md")}`}>{t("home")}</Link>
          </>
        ) : (
          <>
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Users className="size-6" /></div>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">{t("title", { org: invitation.organization.name })}</h1>
            <p className="mt-2 text-sm text-ink-3">{t("role", { role: tc(`roles.${invitation.role}`) })}</p>
            {!session ? (
              <div className="mt-6 space-y-2">
                <p className="text-sm text-ink-3">{t("signInAs", { email: invitation.email })}</p>
                <Link href={`/sign-up?next=${next}`} className={buttonClass("primary", "lg", "w-full")}>{t("createAccount")}</Link>
                <Link href={`/sign-in?next=${next}`} className={buttonClass("ghost", "md", "w-full")}>{t("signIn")}</Link>
              </div>
            ) : session.user.email.toLowerCase() !== invitation.email.toLowerCase() ? (
              <p className="mt-6 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">{t("wrongAccount", { email: invitation.email })}</p>
            ) : (
              <InviteDecision token={token} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
