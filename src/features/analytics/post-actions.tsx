"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MessageSquareText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { openCommand } from "@/features/command/store";
import { analyzePostNow } from "./actions";

export function PostAnalysisActions({ postId, hasInsight }: { postId: string; hasInsight: boolean }) {
  const t = useTranslations("analytics.post");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={hasInsight ? "secondary" : "primary"}
        loading={pending}
        icon={<Sparkles className="size-4 text-accent" />}
        onClick={() =>
          start(async () => {
            const r = await analyzePostNow({ id: postId });
            if (r.ok) router.refresh();
            else toast.error(te(r.error as "unexpected"));
          })
        }
      >
        {hasInsight ? t("reanalyze") : t("analyze")}
      </Button>
      <Button variant="secondary" icon={<MessageSquareText className="size-4" />} onClick={() => openCommand(t("askPrompt"))}>
        {t("ask")}
      </Button>
    </div>
  );
}
