"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, Check, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { approveCampaignFromRun } from "@/features/command/actions";
import { setCampaign } from "./actions";

export function CampaignActions({ id, status }: { id: string; status: string }) {
  const t = useTranslations("app.campaigns");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(msg);
        router.refresh();
      } else toast.error(te((r.error ?? "unexpected") as "unexpected"));
    });
  return (
    <div className="flex flex-wrap gap-2">
      {(status === "PENDING_APPROVAL" || status === "DRAFT") && (
        <Button loading={pending} icon={<Check className="size-4" />} onClick={() => run(() => approveCampaignFromRun({ campaignId: id }), t("approvedToast"))}>{t("approve")}</Button>
      )}
      {status === "ACTIVE" && <Button variant="secondary" loading={pending} icon={<Pause className="size-4" />} onClick={() => run(() => setCampaign({ id, status: "PAUSED" }), t("pausedToast"))}>{t("pause")}</Button>}
      {status === "PAUSED" && <Button variant="secondary" loading={pending} icon={<Play className="size-4" />} onClick={() => run(() => setCampaign({ id, status: "ACTIVE" }), t("resumedToast"))}>{t("resume")}</Button>}
      {status !== "ARCHIVED" && <Button variant="ghost" loading={pending} icon={<Archive className="size-4" />} onClick={() => run(() => setCampaign({ id, status: "ARCHIVED" }), t("archivedToast"))}>{t("archive")}</Button>}
    </div>
  );
}
