"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, Check, CircleCheckBig, Pause, Pencil, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { approveCampaignFromRun } from "@/features/command/actions";
import { editCampaign, setCampaign } from "./actions";

export type CampaignBrief = {
  name: string;
  objective: string;
  audience: string | null;
  offer: string | null;
  startDate: string | null;
  endDate: string | null;
  budget: number | null;
  currency: string | null;
};

export function CampaignActions({ id, status, channel, brief }: { id: string; status: string; channel: string; brief: CampaignBrief }) {
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
  // WhatsApp sends are controlled from their own page (send queue); here they can only be archived.
  const social = channel !== "whatsapp";
  return (
    <div className="flex flex-wrap gap-2">
      {social && (status === "PENDING_APPROVAL" || status === "DRAFT") && (
        <Button loading={pending} icon={<Check className="size-4" />} onClick={() => run(() => approveCampaignFromRun({ campaignId: id }), t("approvedToast"))}>{t("approve")}</Button>
      )}
      {social && status === "ACTIVE" && <Button variant="secondary" loading={pending} icon={<Pause className="size-4" />} onClick={() => run(() => setCampaign({ id, status: "PAUSED" }), t("pausedToast"))}>{t("pause")}</Button>}
      {social && status === "PAUSED" && <Button variant="secondary" loading={pending} icon={<Play className="size-4" />} onClick={() => run(() => setCampaign({ id, status: "ACTIVE" }), t("resumedToast"))}>{t("resume")}</Button>}
      {social && (status === "ACTIVE" || status === "PAUSED") && (
        <Button variant="secondary" loading={pending} icon={<CircleCheckBig className="size-4" />} onClick={() => run(() => setCampaign({ id, status: "COMPLETED" }), t("completedToast"))}>{t("complete")}</Button>
      )}
      {status !== "ARCHIVED" && <EditCampaign id={id} brief={brief} />}
      {status !== "ARCHIVED" && <Button variant="ghost" loading={pending} icon={<Archive className="size-4" />} onClick={() => run(() => setCampaign({ id, status: "ARCHIVED" }), t("archivedToast"))}>{t("archive")}</Button>}
    </div>
  );
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function EditCampaign({ id, brief }: { id: string; brief: CampaignBrief }) {
  const t = useTranslations("app.campaigns.edit");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ ...brief, startDate: day(brief.startDate), endDate: day(brief.endDate), budget: brief.budget == null ? "" : String(brief.budget), currency: brief.currency ?? "USD" });
  const save = () =>
    start(async () => {
      setError(null);
      const r = await editCampaign({
        id,
        data: {
          name: f.name,
          objective: f.objective,
          audience: f.audience || null,
          offer: f.offer || null,
          startDate: f.startDate || null,
          endDate: f.endDate || null,
          budget: f.budget === "" ? null : Number(f.budget),
          currency: f.currency || null,
        },
      });
      if (r.ok) {
        toast(t("saved"));
        setOpen(false);
        router.refresh();
      } else {
        const end = !r.ok && r.fieldErrors?.endDate?.length;
        setError(end ? t("endBeforeStart") : te((r.error ?? "unexpected") as "unexpected"));
      }
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setOpen(true)}>
        {t("open")}
      </Button>
      <DialogContent
        title={t("title")}
        description={t("description")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{tc("actions.cancel")}</Button>
            <Button loading={pending} disabled={!f.name.trim() || !f.objective.trim()} onClick={save}>{tc("actions.save")}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t("name")}>{(p) => <Input {...p} value={f.name} maxLength={160} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label={t("objective")}>{(p) => <Textarea {...p} value={f.objective} maxLength={2000} onChange={(e) => setF({ ...f, objective: e.target.value })} />}</Field>
          <Field label={t("audience")} optional={tc("optional")}>{(p) => <Textarea {...p} className="min-h-20" value={f.audience ?? ""} maxLength={2000} onChange={(e) => setF({ ...f, audience: e.target.value })} />}</Field>
          <Field label={t("offer")} optional={tc("optional")}>{(p) => <Input {...p} value={f.offer ?? ""} maxLength={1000} onChange={(e) => setF({ ...f, offer: e.target.value })} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("startDate")} optional={tc("optional")}>{(p) => <Input {...p} type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />}</Field>
            <Field label={t("endDate")} optional={tc("optional")}>{(p) => <Input {...p} type="date" value={f.endDate} min={f.startDate || undefined} onChange={(e) => setF({ ...f, endDate: e.target.value })} />}</Field>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-4">
            <Field label={t("budget")} optional={tc("optional")}>{(p) => <Input {...p} type="number" inputMode="decimal" min={0} step="any" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} />}</Field>
            <Field label={t("currency")}>{(p) => <Input {...p} value={f.currency} maxLength={3} dir="ltr" onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />}</Field>
          </div>
          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
