"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Flame, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { RunView } from "@/features/agents/run-view";
import { addLead, moveLead, runPipelineAction } from "./actions";

export type LeadCard = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  stage: string;
  temperature: "HOT" | "WARM" | "COLD";
  score: number;
  valueCents: number | null;
  currency: string;
  source: string | null;
  lastContactAt: string | null;
  nextAction: string | null;
  aiInsight: string | null;
  createdAt: string;
};

export const STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;

const TEMP: Record<LeadCard["temperature"], "accent" | "warning" | "neutral"> = { HOT: "accent", WARM: "warning", COLD: "neutral" };

export function LeadBoard({ leads, stageLabels, mode: initial, canManage, pipeline }: { leads: LeadCard[]; stageLabels: Record<string, string>; mode: "board" | "table"; canManage: boolean; pipeline?: boolean }) {
  const t = useTranslations("leads");
  const te = useTranslations("errors");
  const format = useFormatter();
  const router = useRouter();
  const [mode, setMode] = useState(initial);
  const [items, setItems] = useState(leads);
  const [drag, setDrag] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "HOT" | "WARM" | "COLD">("ALL");
  const [pending, start] = useTransition();

  const money = (c: number | null, cur: string) => (c == null ? "—" : format.number(c / 100, { style: "currency", currency: cur, maximumFractionDigits: 0 }));
  const shown = items.filter((l) => filter === "ALL" || l.temperature === filter);

  const drop = (stage: string) => {
    const id = drag;
    setDrag(null);
    if (!id || !canManage) return;
    const lead = items.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    setItems((xs) => xs.map((l) => (l.id === id ? { ...l, stage } : l)));
    start(async () => {
      const res = await moveLead({ id, stage });
      if (!res.ok) {
        toast.error(te(res.error as "unexpected"));
        setItems(leads);
      } else toast(t("moved", { name: lead.name, stage: stageLabels[stage] }));
    });
  };

  const ai = (action: "summarize" | "stalled" | "hot" | "followups") =>
    start(async () => {
      const res = await runPipelineAction({ action });
      if (res.ok) setRunId(res.data.runId);
      else toast.error(te(res.error as "unexpected"));
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {!pipeline && (
          <Segmented label={t("view")} value={mode} onChange={setMode} size="sm" options={[{ value: "board", label: t("board") }, { value: "table", label: t("table") }]} />
        )}
        <Segmented
          label={t("temperature")}
          value={filter}
          onChange={setFilter}
          size="sm"
          options={(["ALL", "HOT", "WARM", "COLD"] as const).map((v) => ({ value: v, label: t(`temps.${v}`), count: v === "ALL" ? items.length : items.filter((l) => l.temperature === v).length }))}
        />
        <div className="ms-auto flex flex-wrap gap-2">
          {pipeline &&
            (["summarize", "stalled", "hot", "followups"] as const).map((a) => (
              <Button key={a} size="sm" variant="secondary" onClick={() => ai(a)} icon={<Sparkles className="size-3.5 text-accent" />}>
                {t(`ai.${a}`)}
              </Button>
            ))}
          {canManage && (
            <Button size="sm" onClick={() => setAdding(true)} icon={<Plus className="size-4" />}>
              {t("add")}
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-line-strong bg-surface-2">
          <EmptyState icon={<Flame />} title={t("empty.title")} description={t("empty.body")} action={<Link href="/settings/lead-capture" className="text-sm font-semibold text-accent-ink hover:underline">{t("empty.cta")}</Link>} />
        </div>
      ) : mode === "board" || pipeline ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex min-w-max gap-3">
            {STAGES.map((stage) => {
              const col = shown.filter((l) => l.stage === stage);
              const total = col.reduce((a, l) => a + (l.valueCents ?? 0), 0);
              return (
                <section
                  key={stage}
                  onDragOver={(e) => canManage && e.preventDefault()}
                  onDrop={() => drop(stage)}
                  aria-label={stageLabels[stage]}
                  className={cn("flex w-[272px] shrink-0 flex-col rounded-[22px] bg-sunken/70 p-2.5 transition", drag && "ring-2 ring-transparent hover:ring-accent/40")}
                >
                  <header className="flex items-baseline justify-between px-2 pb-2.5 pt-1">
                    <h3 className="text-sm font-semibold">
                      {stageLabels[stage]} <span className="ms-1 text-xs font-normal text-ink-3 tabular">{col.length}</span>
                    </h3>
                    <span className="text-xs tabular text-ink-3">{total ? money(total, col[0]?.currency ?? "USD") : ""}</span>
                  </header>
                  <ol className="flex min-h-24 flex-col gap-2">
                    {col.map((l) => (
                      <li key={l.id} draggable={canManage} onDragStart={() => setDrag(l.id)} onDragEnd={() => setDrag(null)} className={cn(drag === l.id && "opacity-40")}>
                        <Link href={`/leads/${l.id}`} className="block space-y-2.5 rounded-2xl border border-line bg-surface p-3.5 shadow-xs transition hover:border-line-strong hover:shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{l.name}</div>
                              {l.company && <div className="truncate text-xs text-ink-3">{l.company}</div>}
                            </div>
                            <Badge tone={TEMP[l.temperature]} className="shrink-0">{l.temperature === "HOT" && <Flame className="size-3" />}{t(`temps.${l.temperature}`)}</Badge>
                          </div>
                          <div className="flex items-center justify-between text-xs text-ink-3">
                            <span className="font-semibold tabular text-ink-2">{money(l.valueCents, l.currency)}</span>
                            <span>{l.lastContactAt ? format.relativeTime(new Date(l.lastContactAt)) : t("noContact")}</span>
                          </div>
                          {l.nextAction && <div className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-ink-2">→ {l.nextAction}</div>}
                          {l.aiInsight && l.aiInsight !== l.nextAction && <div className="flex gap-1.5 text-xs text-ink-3"><Sparkles className="mt-0.5 size-3 shrink-0 text-accent" />{l.aiInsight}</div>}
                        </Link>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[24px] border border-line bg-surface">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-line bg-surface-2 text-start text-xs uppercase tracking-wider text-ink-3">
              <tr>
                {["name", "stage", "score", "value", "source", "lastContact", "nextAction"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 text-start font-semibold">{t(`columns.${h}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((l) => (
                <tr key={l.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link href={`/leads/${l.id}`} className="font-medium hover:underline">{l.name}</Link>
                    <div className="text-xs text-ink-3">{l.company ?? l.email}</div>
                  </td>
                  <td className="px-4 py-3">{stageLabels[l.stage]}</td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-2"><Badge tone={TEMP[l.temperature]}>{t(`temps.${l.temperature}`)}</Badge><span className="tabular text-ink-3">{l.score}</span></span></td>
                  <td className="px-4 py-3 tabular">{money(l.valueCents, l.currency)}</td>
                  <td className="px-4 py-3 text-ink-3">{l.source ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-3">{l.lastContactAt ? format.relativeTime(new Date(l.lastContactAt)) : "—"}</td>
                  <td className="max-w-64 truncate px-4 py-3 text-ink-2">{l.nextAction ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent title={t("add")} description={t("addHint")}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const value = Number(f.get("value") || NaN);
              start(async () => {
                const res = await addLead({
                  name: String(f.get("name")),
                  company: String(f.get("company") || "") || undefined,
                  email: String(f.get("email") || ""),
                  phone: String(f.get("phone") || "") || undefined,
                  message: String(f.get("message") || "") || undefined,
                  source: "Manual",
                  estimatedValue: Number.isFinite(value) ? value : undefined,
                });
                if (res.ok) {
                  setAdding(false);
                  router.push(`/leads/${res.data.id}`);
                } else toast.error(te(res.error as "unexpected"));
              });
            }}
          >
            <Field label={t("fields.name")}>{(p) => <Input {...p} name="name" required />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("fields.company")} optional={t("optional")}>{(p) => <Input {...p} name="company" />}</Field>
              <Field label={t("fields.value")} optional={t("optional")}>{(p) => <Input {...p} name="value" type="number" min={0} step="1" />}</Field>
              <Field label={t("fields.email")} optional={t("optional")}>{(p) => <Input {...p} name="email" type="email" dir="ltr" />}</Field>
              <Field label={t("fields.phone")} optional={t("optional")}>{(p) => <Input {...p} name="phone" type="tel" dir="ltr" />}</Field>
            </div>
            <Field label={t("fields.message")} optional={t("optional")} hint={t("fields.messageHint")}>{(p) => <Textarea {...p} name="message" rows={3} />}</Field>
            <Button type="submit" loading={pending} className="w-full">{t("add")}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(runId)} onOpenChange={(o) => { if (!o) { setRunId(null); router.refresh(); } }}>
        <DialogContent title={t("aiTitle")} size="lg">{runId && <RunView runId={runId} onNavigate={() => setRunId(null)} />}</DialogContent>
      </Dialog>
    </div>
  );
}
