"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { PlatformDot } from "@/components/content/post-preview";
import { RunView } from "@/features/agents/run-view";
import type { WeekProposal } from "@/server/studio/content";
import { createWeekAction, proposeWeekAction } from "./studio-actions";

/** "Plan next week": NOVA proposes a mix grounded in real data → the user confirms → background run. */
export function PlanWeekDialog({ open, onClose, imagesEnabled }: { open: boolean; onClose: () => void; imagesEnabled: boolean }) {
  const t = useTranslations("content.studio.week");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();
  const [proposal, setProposal] = useState<WeekProposal | null>(null);
  const [withDesigns, setWithDesigns] = useState(imagesEnabled);
  const [runId, setRunId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || proposal || runId) return;
    start(async () => {
      const r = await proposeWeekAction({});
      if (r.ok) setProposal(r.data);
      else {
        toast.error(te.has(r.error as "unexpected") ? te(r.error as "unexpected") : te("unexpected"));
        onClose();
      }
    });
  }, [open, proposal, runId, te, onClose]);

  const close = () => {
    setProposal(null);
    setRunId(null);
    onClose();
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title={t("title")} size="lg">
        {runId ? (
          <RunView runId={runId} onNavigate={close} />
        ) : !proposal ? (
          <p className="flex items-center gap-2 py-6 text-sm text-ink-3"><Loader2 className="size-4 animate-spin" /> {t("analyzing")}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-ink-2" dir="auto">{proposal.summary}</p>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">{t("proposal")}</p>
            <ol className="space-y-2">
              {proposal.days.map((d, i) => (
                <li key={`${d.day}-${i}`} className="flex items-start gap-3 rounded-2xl border border-line p-3">
                  <div className="w-20 shrink-0 text-sm font-semibold">{t(`days.${d.day}`)}</div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span>{d.type}</span>
                      <span className="inline-flex items-center gap-1 text-xs text-ink-3"><PlatformDot platform={d.platform} />{tc(`platforms.${d.platform}` as "platforms.INSTAGRAM")} · {tc(`formats.${d.format}` as "formats.POST")}</span>
                    </p>
                    <p className="text-sm text-ink-2" dir="auto">{d.topic}</p>
                    <p className="text-xs text-ink-3" dir="auto">{d.reason}</p>
                  </div>
                  <button type="button" aria-label={t("remove")} className="rounded-full p-1 text-ink-4 hover:bg-sunken hover:text-ink" onClick={() => setProposal({ ...proposal, days: proposal.days.filter((_, j) => j !== i) })}>
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ol>
            {imagesEnabled && <Checkbox label={t("withDesigns")} checked={withDesigns} onChange={setWithDesigns} />}
            <Button
              className="w-full"
              loading={pending}
              disabled={proposal.days.length === 0}
              icon={<Sparkles className="size-4 text-accent" />}
              onClick={() =>
                start(async () => {
                  const r = await createWeekAction({ proposal: proposal.days, withDesigns: imagesEnabled && withDesigns });
                  if (r.ok) setRunId(r.data.runId);
                  else toast.error(te.has(r.error as "unexpected") ? te(r.error as "unexpected") : te("unexpected"));
                })
              }
            >
              {t("create")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
