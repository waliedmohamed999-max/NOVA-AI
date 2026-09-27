"use client";

import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openCommand } from "@/features/command/store";

/** Campaigns are created by talking to the AI team — the command bar opens pre-filled. */
export function NewCampaignButton() {
  const t = useTranslations("app.campaigns");
  return (
    <Button icon={<Sparkles className="size-4 text-accent" />} onClick={() => openCommand(t("prompt"))}>
      {t("create")}
    </Button>
  );
}
