"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, RefreshCw, Send, Sparkles, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { draftTemplateTextAction, deleteTemplateAction, saveTemplateAction, submitTemplateAction, syncTemplatesAction } from "./actions";
import { StateBadge } from "./ui";

export type TemplateRow = { id: string; name: string; language: string; category: string; status: string; header: string | null; body: string; footer: string | null; buttons: { type: "QUICK_REPLY" | "URL"; text: string; url?: string }[]; variables: Record<string, string>; rejectedReason: string | null };
const TABS = ["APPROVED", "PENDING", "REJECTED", "DRAFT"] as const;
const SOURCES = ["customer_name", "company", "appointment", "order", "quote_amount", "agent_name", "static"] as const;

export function TemplatesView({ rows, canManage, connected, aiReady }: { rows: TemplateRow[]; canManage: boolean; connected: boolean; aiReady: boolean }) {
  const t = useTranslations("whatsapp.templates");
  const te = useTranslations("errors");
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("APPROVED");
  const [editing, setEditing] = useState<TemplateRow | "new" | null>(null);
  const [pending, start] = useTransition();
  const shown = rows.filter((r) => (tab === "PENDING" ? ["PENDING", "PAUSED"].includes(r.status) : tab === "REJECTED" ? ["REJECTED", "DISABLED"].includes(r.status) : r.status === tab));
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex gap-1 rounded-2xl bg-sunken p-1">
          {TABS.map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("rounded-xl px-3 py-1.5 text-sm font-semibold", tab === k ? "bg-surface text-ink shadow-xs" : "text-ink-3")}>
              {t(`tabs.${k}`)} <span className="text-ink-4">{rows.filter((r) => (k === "PENDING" ? ["PENDING", "PAUSED"].includes(r.status) : k === "REJECTED" ? ["REJECTED", "DISABLED"].includes(r.status) : r.status === k)).length}</span>
            </button>
          ))}
        </div>
        {canManage && (
          <div className="ms-auto flex gap-2">
            {connected && (
              <button disabled={pending} onClick={() => start(async () => { const r = await syncTemplatesAction({}); if (!r.ok) return void toast(te(r.error as "unexpected"), "error"); toast(t("synced")); router.refresh(); })} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold hover:bg-surface-2">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {t("sync")}
              </button>
            )}
            <button onClick={() => setEditing("new")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-ink-inverse" data-testid="wa-new-template">
              <Plus className="size-4" /> {t("new")}
            </button>
          </div>
        )}
      </div>
      {tab === "DRAFT" && <p className="text-xs text-ink-3">{t("draftNote")}</p>}
      {shown.length === 0 ? (
        <p className="rounded-[24px] border border-dashed border-line-strong bg-surface-2 p-10 text-center text-sm text-ink-3">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="wa-templates">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-col rounded-[20px] border border-line bg-surface p-4 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-sm font-semibold" dir="ltr">{r.name}</span>
                <span className="text-xs text-ink-4">{r.language}</span>
                <span className="ms-auto">
                  <StateBadge state={r.status === "APPROVED" ? "SENDING" : r.status === "REJECTED" ? "FAILED" : r.status === "PENDING" ? "SCHEDULED" : "DRAFT"} label={t(`tabs.${(TABS as readonly string[]).includes(r.status) ? r.status : "PENDING"}` as "tabs.DRAFT")} />
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-3">{t(`builder.categories.${r.category}` as "builder.categories.MARKETING")}</p>
              <p className="mt-3 line-clamp-4 whitespace-pre-wrap rounded-xl bg-[#d9fdd3] p-2.5 text-sm text-[#0b2e13]" dir="auto">{r.body}</p>
              {r.rejectedReason && <p className="mt-2 text-xs text-danger">{t("rejectedReason", { reason: r.rejectedReason })}</p>}
              {canManage && ["DRAFT", "REJECTED"].includes(r.status) && (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setEditing(r)} className="h-9 flex-1 rounded-xl border border-line text-sm font-semibold hover:bg-surface-2">{t("builder.title")}</button>
                  <button onClick={() => start(async () => { const x = await deleteTemplateAction({ id: r.id }); if (!x.ok) return void toast(te(x.error as "unexpected"), "error"); router.refresh(); })} className="rounded-xl border border-line px-3 text-ink-3 hover:text-danger" aria-label="delete">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <Builder row={editing === "new" ? null : editing} connected={connected} aiReady={aiReady} onClose={() => setEditing(null)} />}
    </section>
  );
}

function Builder({ row, connected, aiReady, onClose }: { row: TemplateRow | null; connected: boolean; aiReady: boolean; onClose: () => void }) {
  const t = useTranslations("whatsapp.templates");
  const tb = useTranslations("whatsapp.templates.builder");
  const te = useTranslations("errors");
  const router = useRouter();
  const [f, setF] = useState<Omit<TemplateRow, "id" | "status" | "rejectedReason">>(row ?? { name: "", language: "ar", category: "MARKETING", header: "", body: "", footer: "", buttons: [], variables: {} });
  const [objective, setObjective] = useState("");
  const [savedId, setSavedId] = useState<string | null>(row?.id ?? null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const vars = useMemo(() => [...new Set([...f.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b), [f.body]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const sample: Record<string, string> = { customer_name: "Sara", company: "Example Co", appointment: "Sun 10:00", order: "#1024", quote_amount: "5,000", agent_name: "Ahmed" };
  const previewText = f.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => {
    const src = f.variables[n] ?? "customer_name";
    return src.startsWith("static:") ? src.slice(7) || `{{${n}}}` : sample[src] ?? `{{${n}}}`;
  });

  const save = (then?: (id: string) => Promise<void>) =>
    start(async () => {
      const variables = Object.fromEntries(vars.map((n) => [String(n), f.variables[String(n)] || "customer_name"]));
      const r = await saveTemplateAction({ id: savedId ?? undefined, template: { ...f, header: f.header || null, footer: f.footer || null, variables } });
      if (!r.ok) return void toast(te((r.error ?? "validation") as "unexpected"), "error");
      setSavedId(r.data.id);
      if (then) await then(r.data.id);
      else {
        toast(t("builder.save"));
        router.refresh();
      }
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={tb("title")} size="xl">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3">
            {aiReady && (
              <div className="flex gap-2 rounded-2xl bg-nova-blue-soft/60 p-3">
                <input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder={tb("objective")} aria-label={tb("objective")} className="h-10 flex-1 rounded-xl border border-nova-blue-line bg-surface px-3 text-sm" />
                <button disabled={pending || objective.trim().length < 2} onClick={() => start(async () => { const r = await draftTemplateTextAction({ objective }); if (!r.ok) return void toast(te(r.error as "unexpected"), "error"); setF((x) => ({ ...x, name: x.name || r.data.name, body: r.data.body, footer: r.data.footer || x.footer, variables: { "1": "customer_name" } })); })} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-nova-blue px-3 text-sm font-semibold text-white disabled:opacity-50">
                  <Sparkles className="size-4" /> {tb("aiHelp")}
                </button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold text-ink-2 sm:col-span-3">
                {tb("name")}
                <input value={f.name} onChange={(e) => set("name", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} dir="ltr" className="mt-1 h-10 w-full rounded-xl border border-line px-3 font-mono text-sm" data-testid="tpl-name" />
              </label>
              <label className="text-xs font-semibold text-ink-2">
                {tb("language")}
                <select value={f.language} onChange={(e) => set("language", e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line px-2 text-sm">
                  {["ar", "en", "en_US", "en_GB", "fr"].map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-ink-2 sm:col-span-2">
                {tb("category")}
                <select value={f.category} onChange={(e) => set("category", e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line px-2 text-sm">
                  {["MARKETING", "UTILITY", "AUTHENTICATION"].map((c) => <option key={c} value={c}>{tb(`categories.${c}` as "categories.MARKETING")}</option>)}
                </select>
              </label>
            </div>
            <label className="block text-xs font-semibold text-ink-2">
              {tb("header")}
              <input value={f.header ?? ""} maxLength={60} onChange={(e) => set("header", e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line px-3 text-sm" dir="auto" />
            </label>
            <label className="block text-xs font-semibold text-ink-2">
              {tb("body")}
              <textarea value={f.body} maxLength={1024} onChange={(e) => set("body", e.target.value)} rows={5} className="mt-1 w-full rounded-xl border border-line p-3 text-sm" dir="auto" data-testid="tpl-body" />
              <span className="mt-1 block font-normal text-ink-4">{tb("bodyHint")}</span>
            </label>
            <button type="button" onClick={() => set("body", `${f.body}{{${(vars.at(-1) ?? 0) + 1}}}`)} className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-surface-2">
              + {tb("insertVar")}
            </button>
            {vars.length > 0 && (
              <fieldset className="space-y-2 rounded-2xl border border-line p-3">
                <legend className="px-1 text-xs font-bold">{tb("variables")}</legend>
                {vars.map((n) => {
                  const cur = f.variables[String(n)] ?? "customer_name";
                  const isStatic = cur.startsWith("static:");
                  return (
                    <div key={n} className="flex flex-wrap items-center gap-2">
                      <span className="w-24 text-xs text-ink-3">{tb("variableFor", { n })}</span>
                      <select value={isStatic ? "static" : cur} onChange={(e) => set("variables", { ...f.variables, [String(n)]: e.target.value === "static" ? "static:" : e.target.value })} className="h-9 rounded-xl border border-line px-2 text-sm">
                        {SOURCES.map((s) => <option key={s} value={s}>{tb(`sources.${s}`)}</option>)}
                      </select>
                      {isStatic && <input value={cur.slice(7)} onChange={(e) => set("variables", { ...f.variables, [String(n)]: `static:${e.target.value}` })} placeholder={tb("staticValue")} className="h-9 flex-1 rounded-xl border border-line px-2 text-sm" />}
                    </div>
                  );
                })}
              </fieldset>
            )}
            <label className="block text-xs font-semibold text-ink-2">
              {tb("footer")}
              <input value={f.footer ?? ""} maxLength={60} onChange={(e) => set("footer", e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-line px-3 text-sm" dir="auto" />
            </label>
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-ink-2">{tb("buttons")}</legend>
              {f.buttons.map((b, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <select value={b.type} onChange={(e) => set("buttons", f.buttons.map((x, j) => (j === i ? { ...x, type: e.target.value as "URL" | "QUICK_REPLY" } : x)))} className="h-9 rounded-xl border border-line px-2 text-sm">
                    <option value="QUICK_REPLY">{tb("quickReply")}</option>
                    <option value="URL">{tb("urlButton")}</option>
                  </select>
                  <input value={b.text} maxLength={25} onChange={(e) => set("buttons", f.buttons.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder={tb("buttonText")} className="h-9 flex-1 rounded-xl border border-line px-2 text-sm" />
                  {b.type === "URL" && <input value={b.url ?? ""} onChange={(e) => set("buttons", f.buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://" dir="ltr" className="h-9 flex-1 rounded-xl border border-line px-2 text-sm" />}
                  <button onClick={() => set("buttons", f.buttons.filter((_, j) => j !== i))} className="px-2 text-ink-3 hover:text-danger" aria-label="remove">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              {f.buttons.length < 3 && (
                <button type="button" onClick={() => set("buttons", [...f.buttons, { type: "QUICK_REPLY", text: "" }])} className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-surface-2">
                  + {tb("addButton")}
                </button>
              )}
            </fieldset>
          </div>

          <aside className="space-y-2">
            <p className="text-xs font-bold text-ink-2">{tb("preview")}</p>
            <div className="rounded-2xl bg-[#efe7dd] p-3 dark:bg-sunken">
              <div className="rounded-2xl rounded-ee-md bg-[#d9fdd3] p-3 text-sm text-[#0b2e13] shadow-xs">
                {f.header && <p className="mb-1 font-bold" dir="auto">{f.header}</p>}
                <p className="whitespace-pre-wrap" dir="auto" data-testid="tpl-preview">{previewText || "…"}</p>
                {f.footer && <p className="mt-1 text-xs opacity-60" dir="auto">{f.footer}</p>}
              </div>
              {f.buttons.filter((b) => b.text).map((b, i) => (
                <div key={i} className="mt-1 rounded-xl bg-surface py-2 text-center text-sm font-semibold text-[#027eb5]">{b.text}</div>
              ))}
            </div>
            <p className="text-xs text-ink-4">{tb("submitNote")}</p>
          </aside>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <button disabled={pending || !f.name || !f.body} onClick={() => save()} className="h-10 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-surface-2" data-testid="tpl-save">
            {tb("save")}
          </button>
          {connected && (
            confirm ? (
              <button
                disabled={pending}
                onClick={() => save(async (id) => { const r = await submitTemplateAction({ id }); if (!r.ok) return void toast(te(r.error as "unexpected"), "error"); toast(t("tabs.PENDING")); onClose(); router.refresh(); })}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#1fa855] px-4 text-sm font-semibold text-white"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4 flip-rtl" />} {tb("submit")} ✓
              </button>
            ) : (
              <button disabled={pending || !f.name || !f.body} onClick={() => setConfirm(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-ink-inverse">
                <Send className="size-4 flip-rtl" /> {tb("submit")}
              </button>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
