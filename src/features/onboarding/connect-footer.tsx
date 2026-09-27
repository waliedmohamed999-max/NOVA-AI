"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { saveAnswers } from "./actions";

/** Continue (or skip) back into the conversational onboarding at the goals step. */
export function ConnectStepFooter({ done, anyConnected }: { done: boolean; anyConnected: boolean }) {
  const t = useTranslations("settings.connect");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = () =>
    start(async () => {
      if (done) return router.push("/home");
      const r = await saveAnswers({ step: 7 });
      if (!r.ok) return void toast.error(te(r.error as "unexpected"));
      router.push("/onboarding");
    });
  return (
    <div className="flex flex-col items-start gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-ink-3">{t("skipHint")}</p>
      <div className="flex gap-2">
        {!anyConnected && (
          <Button variant="ghost" loading={pending} onClick={next}>{t("skip")}</Button>
        )}
        <Button loading={pending} disabled={!anyConnected} onClick={next} iconEnd={<ArrowRight className="size-4 flip-rtl" />}>{t("continue")}</Button>
      </div>
    </div>
  );
}
