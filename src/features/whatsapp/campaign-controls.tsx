"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Pause, Play, XCircle } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { campaignControlAction } from "./actions";

export function CampaignControls({ id, state }: { id: string; state: string }) {
  const t = useTranslations("whatsapp.campaigns.controls");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (op: "pause" | "resume" | "cancel") =>
    start(async () => {
      const r = await campaignControlAction({ id, op });
      if (!r.ok) return void toast(te((r.error ?? "unexpected") as "unexpected"), "error");
      router.refresh();
    });
  return (
    <div className="flex flex-wrap gap-2">
      {pending && <Loader2 className="size-4 animate-spin self-center" />}
      {["SENDING", "SCHEDULED"].includes(state) && (
        <button onClick={() => run("pause")} disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-surface-2" data-testid="wa-pause">
          <Pause className="size-4" /> {t("pause")}
        </button>
      )}
      {state === "PAUSED" && (
        <button onClick={() => run("resume")} disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1fa855] px-4 text-sm font-semibold text-white" data-testid="wa-resume">
          <Play className="size-4 flip-rtl" /> {t("resume")}
        </button>
      )}
      {!["COMPLETED", "CANCELLED", "DRAFT"].includes(state) && (
        <button onClick={() => run("cancel")} disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-danger hover:bg-danger-soft">
          <XCircle className="size-4" /> {t("cancel")}
        </button>
      )}
    </div>
  );
}
