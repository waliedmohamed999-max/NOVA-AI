"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { RunSteps, useRun } from "@/features/agents/run-view";
import { completeSetup } from "./actions";

/**
 * Shown on Settings while onboarding left team-setup steps unfinished (they were skipped so the owner could
 * enter NOVA). "Complete now" re-runs the setup and follows the real run.
 */
export function SetupIncompleteCard({ steps, canEdit }: { steps: string[]; canEdit: boolean }) {
  const t = useTranslations("settings.setupIncomplete");
  const ts = useTranslations("app.steps");
  const te = useTranslations("errors");
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = useRun(runId);
  const finished = run?.status === "COMPLETED" || run?.status === "FAILED" || run?.status === "CANCELLED";
  const running = Boolean(runId) && !finished;

  useEffect(() => {
    if (!run || !finished) return;
    if (run.status === "COMPLETED" && !run.steps.some((s) => s.status === "incomplete")) toast(t("done"));
    else toast.error(t("stillIncomplete"));
    router.refresh();
  }, [run, finished, router, t]);

  const complete = () =>
    start(async () => {
      const r = await completeSetup({});
      if (r.ok) setRunId(r.data.runId);
      else toast.error(te((r.error ?? "unexpected") as "unexpected"));
    });

  return (
    <Card className="overflow-hidden border-warning/30" data-testid="setup-incomplete">
      <div className="flex items-start gap-3 px-6 py-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
          <CircleAlert className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-semibold">{t("title")}</h2>
          <p className="text-sm text-ink-3">{t("description")}</p>
        </div>
      </div>
      <div className="border-t border-line px-6 py-4">
        {runId ? (
          <RunSteps run={run} />
        ) : (
          <ul className="space-y-2">
            {steps.map((key) => (
              <li key={key} className="flex items-center gap-2.5 text-sm text-ink-2">
                <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                {ts.has(key) ? ts(key as "understanding_goal") : key}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface-2 px-6 py-4">
        {canEdit ? (
          <Button loading={pending || running} onClick={complete}>
            {running ? t("running") : t("cta")}
          </Button>
        ) : (
          <p className="text-sm text-ink-3">{t("viewOnly")}</p>
        )}
      </div>
    </Card>
  );
}
