"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { acceptInviteAction, declineInviteAction } from "./invite-actions";

export function InviteDecision({ token }: { token: string }) {
  const t = useTranslations("settings.invite");
  const te = useTranslations("errors");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string } | void>) =>
    start(async () => {
      const r = await fn();
      if (r && !r.ok) toast.error(te((r.error ?? "unexpected") as "unexpected"));
    });
  return (
    <div className="mt-6 space-y-2">
      <Button size="lg" className="w-full" loading={pending} onClick={() => run(() => acceptInviteAction(token))}>{t("accept")}</Button>
      <Button variant="ghost" className="w-full" disabled={pending} onClick={() => run(() => declineInviteAction(token))}>{t("decline")}</Button>
    </div>
  );
}
