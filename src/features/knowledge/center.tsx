"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Brain, FileText, Globe, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { addSource, removeSource, resyncSource, saveOffering, saveProfile } from "./actions";

type Source = { id: string; type: string; title: string; url: string | null; status: string; error: string | null; updated: string; documents: number; chunks: number };
type Offering = { id: string; name: string; type: "PRODUCT" | "SERVICE"; priceText: string; description: string };
const TYPES = ["WEBSITE", "DOCUMENT", "MANUAL", "FAQ", "PRODUCT", "SERVICE", "PRICING", "POLICY", "CASE_STUDY"] as const;

export function KnowledgeCenter({ canManage, profile, offerings, sources }: { canManage: boolean; profile: { summary: string; industry: string; valueProps: string[]; contentPillars: string[]; completeness: number }; offerings: Offering[]; sources: Source[] }) {
  const t = useTranslations("settings.knowledge");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]>("FAQ");
  const [p, setP] = useState({ ...profile, valueProps: profile.valueProps.join("\n"), contentPillars: profile.contentPillars.join(", ") });
  const [newOffer, setNewOffer] = useState({ name: "", type: "SERVICE" as "PRODUCT" | "SERVICE", priceText: "" });

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        if (ok) toast(ok);
        after?.();
        router.refresh();
      } else toast.error(te((r.error ?? "unexpected") as "unexpected"));
    });

  async function uploadAndAdd(file: File, title: string) {
    const body = new FormData();
    body.append("file", file);
    body.append("purpose", "knowledge");
    const res = await fetch("/api/uploads", { method: "POST", body });
    const json = await res.json();
    if (!res.ok) return toast.error(te(json.error ?? "unexpected"));
    act(() => addSource({ type: "DOCUMENT", title: title || file.name, fileId: json.id }), t("added"), () => setAdding(false));
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-6">
        <Card className="space-y-4 p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Brain className="size-4 text-accent" /> {t("profile")}</h2>
            <div className="w-40"><Progress value={profile.completeness} label={t("completeness")} /></div>
          </div>
          <Field label={t("summary")}>{(f) => <Textarea {...f} rows={3} value={p.summary} disabled={!canManage} onChange={(e) => setP({ ...p, summary: e.target.value })} dir="auto" />}</Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("industry")}>{(f) => <Input {...f} value={p.industry} disabled={!canManage} onChange={(e) => setP({ ...p, industry: e.target.value })} />}</Field>
            <Field label={t("pillars")} hint={t("commaHint")}>{(f) => <Input {...f} value={p.contentPillars} disabled={!canManage} onChange={(e) => setP({ ...p, contentPillars: e.target.value })} />}</Field>
          </div>
          <Field label={t("valueProps")} hint={t("lineHint")}>{(f) => <Textarea {...f} rows={3} value={p.valueProps} disabled={!canManage} onChange={(e) => setP({ ...p, valueProps: e.target.value })} dir="auto" />}</Field>
          {canManage && (
            <Button loading={pending} onClick={() => act(() => saveProfile({ summary: p.summary, industry: p.industry, valueProps: p.valueProps.split("\n").map((x) => x.trim()).filter(Boolean), contentPillars: p.contentPillars.split(",").map((x) => x.trim()).filter(Boolean) }), tc("actions.save"))}>
              {tc("actions.save")}
            </Button>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t("sources")}</h2>
            {canManage && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>{t("addSource")}</Button>}
          </div>
          {sources.length === 0 ? (
            <p className="text-sm text-ink-3">{t("noSources")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {sources.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-3">
                  {s.type === "WEBSITE" ? <Globe className="size-4 text-ink-3" /> : <FileText className="size-4 text-ink-3" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{s.title}</div>
                    <div className="text-xs text-ink-3">{t(`types.${s.type}` as "types.FAQ")} · {t("chunks", { count: s.chunks })} · {s.updated}</div>
                    {s.error && <div className="text-xs text-danger">{te(s.error as "unexpected")}</div>}
                  </div>
                  <Badge tone={s.status === "READY" ? "success" : s.status === "FAILED" ? "danger" : "info"}>{t(`status.${s.status}` as "status.READY")}</Badge>
                  {canManage && (
                    <>
                      <button className="rounded-full p-1.5 text-ink-4 hover:bg-sunken hover:text-ink" onClick={() => act(() => resyncSource({ id: s.id }))} aria-label={t("resync")}><RefreshCw className="size-3.5" /></button>
                      <button className="rounded-full p-1.5 text-ink-4 hover:bg-danger-soft hover:text-danger" onClick={() => act(() => removeSource({ id: s.id }))} aria-label={tc("actions.delete")}><Trash2 className="size-3.5" /></button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-ink-4">{t("ragNote")}</p>
        </Card>
      </div>

      <aside className="space-y-6">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold">{t("offerings")}</h2>
          <ul className="space-y-2">
            {offerings.map((o) => (
              <li key={o.id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span>
                {o.priceText && <span className="text-ink-3">{o.priceText}</span>}
                {canManage && <button className="text-ink-4 hover:text-danger" aria-label={tc("actions.remove")} onClick={() => act(() => saveOffering({ id: o.id, name: o.name, type: o.type, remove: true }))}><Trash2 className="size-3.5" /></button>}
              </li>
            ))}
          </ul>
          {canManage && (
            <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); act(() => saveOffering(newOffer), t("added"), () => setNewOffer({ name: "", type: "SERVICE", priceText: "" })); }}>
              <Input value={newOffer.name} onChange={(e) => setNewOffer({ ...newOffer, name: e.target.value })} placeholder={t("offeringName")} required aria-label={t("offeringName")} />
              <div className="flex gap-2">
                <Select value={newOffer.type} onChange={(e) => setNewOffer({ ...newOffer, type: e.target.value as "PRODUCT" | "SERVICE" })} aria-label={t("offeringType")}>
                  <option value="SERVICE">{t("types.SERVICE")}</option>
                  <option value="PRODUCT">{t("types.PRODUCT")}</option>
                </Select>
                <Input value={newOffer.priceText} onChange={(e) => setNewOffer({ ...newOffer, priceText: e.target.value })} placeholder={t("price")} aria-label={t("price")} />
              </div>
              <Button type="submit" size="sm" variant="secondary" className="w-full">{tc("actions.add")}</Button>
            </form>
          )}
        </Card>
      </aside>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent title={t("addSource")} description={t("addHint")}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const file = f.get("file");
              if (type === "DOCUMENT" && file instanceof File && file.size) return void uploadAndAdd(file, String(f.get("title") ?? ""));
              act(() => addSource({ type, title: String(f.get("title") || "") || undefined, url: String(f.get("url") || "") || undefined, text: String(f.get("text") || "") || undefined }), t("added"), () => setAdding(false));
            }}
          >
            <Field label={t("type")}>{(f) => <Select {...f} value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>{TYPES.map((x) => <option key={x} value={x}>{t(`types.${x}` as "types.FAQ")}</option>)}</Select>}</Field>
            <Field label={t("titleField")} optional={tc("optional")}>{(f) => <Input {...f} name="title" />}</Field>
            {type === "WEBSITE" ? (
              <Field label="URL">{(f) => <Input {...f} name="url" dir="ltr" placeholder="https://" required />}</Field>
            ) : type === "DOCUMENT" ? (
              <Field label={t("file")} hint={t("fileHint")}>{(f) => <Input {...f} name="file" type="file" accept=".txt,.md,.csv,.json" className="pt-2.5" required />}</Field>
            ) : (
              <Field label={t("content")}>{(f) => <Textarea {...f} name="text" rows={8} required dir="auto" />}</Field>
            )}
            <Button type="submit" loading={pending} className="w-full" icon={type === "DOCUMENT" ? <Upload className="size-4" /> : undefined}>{t("addSource")}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
