"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/controls";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { updateAgent } from "./actions";

export function AgentSettings({ agentId, enabled, guidance, canConfigure }: { agentId: string; enabled: boolean; guidance: string; canConfigure: boolean }) {
  const t = useTranslations("app.team");
  const te = useTranslations("errors");
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [text, setText] = useState(guidance);
  const [advanced, setAdvanced] = useState(false);
  const [pending, start] = useTransition();
  const save = (patch: { enabled?: boolean; guidance?: string }) =>
    start(async () => {
      const r = await updateAgent({ id: agentId, ...patch });
      if (r.ok) {
        toast(t("saved"));
        router.refresh();
      } else toast.error(te(r.error as "unexpected"));
    });
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">{t("active")}</h2>
          <p className="text-xs text-ink-3">{t("activeHint")}</p>
        </div>
        <Switch label={t("active")} checked={on} disabled={!canConfigure || pending} onChange={(v) => { setOn(v); save({ enabled: v }); }} />
      </div>
      <button className="flex w-full items-center justify-between border-t border-line pt-4 text-sm font-medium text-ink-2" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
        {t("advanced")} <ChevronDown className={`size-4 transition ${advanced ? "rotate-180" : ""}`} />
      </button>
      {advanced && (
        <div className="space-y-3">
          <p className="text-xs text-ink-3">{t("guidanceHint")}</p>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} disabled={!canConfigure} aria-label={t("advanced")} maxLength={1000} />
          <Button size="sm" variant="secondary" disabled={!canConfigure || text === guidance} loading={pending} onClick={() => save({ guidance: text })}>{t("save")}</Button>
        </div>
      )}
    </Card>
  );
}
