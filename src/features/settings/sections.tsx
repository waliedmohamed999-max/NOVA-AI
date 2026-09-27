"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, Copy, Download, Monitor, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/controls";
import { Progress } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { Section, useAct } from "./ui";
import {
  deleteAccount,
  deleteOrganizationAction,
  requestExport,
  revokeSession,
  saveAiBudget,
  saveAiSettings,
  saveApprovalPolicy,
  saveLeadForm,
  saveNotificationPref,
  startCheckout,
} from "./actions";

/* ───────── AI Team ───────── */

type AiSettings = { salesAutonomy: "ASSIST" | "COPILOT" | "AUTOPILOT"; autopilotAllowedTasks: string[]; requireContentApproval: boolean; weeklyAutoPlan: boolean; dailyBriefHour: number };
const AUTOPILOT_TASKS = ["send_follow_up", "send_first_reply", "schedule_reminder"] as const;

export function AiTeamSettings({ initial, canEdit, provider }: { initial: AiSettings; canEdit: boolean; provider: { configured: boolean; offline: boolean; names: string[] } }) {
  const t = useTranslations("settings.ai");
  const tc = useTranslations("common");
  const { act, pending } = useAct();
  const [s, setS] = useState(initial);
  return (
    <div className="space-y-6">
      <Section title={t("provider")} description={t("providerHint")}>
        <div className="flex items-center gap-3 text-sm">
          <Badge tone={provider.configured && !provider.offline ? "success" : provider.offline ? "warning" : "danger"}>
            {provider.offline ? tc("aiOffline.badge") : provider.configured ? provider.names.join(" + ") : t("notConfigured")}
          </Badge>
          <span className="text-ink-3">{provider.offline ? tc("aiOffline.hint") : provider.configured ? t("configured") : t("setupHint")}</span>
        </div>
      </Section>

      <Section
        title={t("autonomy")}
        description={t("autonomyHint")}
        footer={canEdit && <Button loading={pending} onClick={() => act(() => saveAiSettings({ ...s, autopilotAllowedTasks: s.autopilotAllowedTasks as (typeof AUTOPILOT_TASKS)[number][] }), t("saved"))}>{tc("actions.save")}</Button>}
      >
        <div role="radiogroup" aria-label={t("autonomy")} className="grid gap-3 md:grid-cols-3">
          {(["ASSIST", "COPILOT", "AUTOPILOT"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={s.salesAutonomy === m}
              disabled={!canEdit}
              onClick={() => setS({ ...s, salesAutonomy: m })}
              className={cn("rounded-2xl border p-4 text-start transition", s.salesAutonomy === m ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong")}
            >
              <div className="flex items-center justify-between font-semibold">
                {t(`modes.${m}.title`)}
                {m === "COPILOT" && <Badge tone="outline">{t("default")}</Badge>}
              </div>
              <p className="mt-1 text-sm text-ink-3">{t(`modes.${m}.body`)}</p>
            </button>
          ))}
        </div>
        {s.salesAutonomy === "AUTOPILOT" && (
          <div className="space-y-2 rounded-2xl bg-surface-2 p-4">
            <p className="text-sm font-medium">{t("allowedTasks")}</p>
            {AUTOPILOT_TASKS.map((task) => (
              <label key={task} className="flex items-center gap-3 text-sm">
                <input type="checkbox" checked={s.autopilotAllowedTasks.includes(task)} disabled={!canEdit} onChange={(e) => setS({ ...s, autopilotAllowedTasks: e.target.checked ? [...s.autopilotAllowedTasks, task] : s.autopilotAllowedTasks.filter((x) => x !== task) })} />
                {t(`tasks.${task}`)}
              </label>
            ))}
            <p className="text-xs text-ink-3">{t("sensitiveNote")}</p>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
          <div>
            <div className="text-sm font-medium">{t("contentApproval")}</div>
            <div className="text-xs text-ink-3">{t("contentApprovalHint")}</div>
          </div>
          <Switch label={t("contentApproval")} checked={s.requireContentApproval} disabled={!canEdit} onChange={(v) => setS({ ...s, requireContentApproval: v })} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">{t("weeklyPlan")}</div>
            <div className="text-xs text-ink-3">{t("weeklyPlanHint")}</div>
          </div>
          <Switch label={t("weeklyPlan")} checked={s.weeklyAutoPlan} disabled={!canEdit} onChange={(v) => setS({ ...s, weeklyAutoPlan: v })} />
        </div>
        <Field label={t("briefHour")}>
          {(p) => (
            <Select {...p} className="w-40" value={s.dailyBriefHour} disabled={!canEdit} onChange={(e) => setS({ ...s, dailyBriefHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
            </Select>
          )}
        </Field>
      </Section>
    </div>
  );
}

/* ───────── Approval rules ───────── */

export function ApprovalRules({ policies, canEdit }: { policies: { action: string; requiresApproval: boolean }[]; canEdit: boolean }) {
  const t = useTranslations("settings.approvals");
  const { act } = useAct();
  const [local, setLocal] = useState(policies);
  return (
    <Section title={t("title")} description={t("description")}>
      <ul className="divide-y divide-line">
        {local.map((p) => (
          <li key={p.action} className="flex items-center justify-between gap-4 py-3.5">
            <div>
              <div className="text-sm font-medium">{t(`actions.${p.action}.title` as "actions.discount.title")}</div>
              <div className="text-xs text-ink-3">{t(`actions.${p.action}.body` as "actions.discount.body")}</div>
            </div>
            <Switch
              label={t(`actions.${p.action}.title` as "actions.discount.title")}
              checked={p.requiresApproval}
              disabled={!canEdit}
              onChange={(v) => {
                setLocal(local.map((x) => (x.action === p.action ? { ...x, requiresApproval: v } : x)));
                act(() => saveApprovalPolicy({ action: p.action, requiresApproval: v }), t("saved"));
              }}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ───────── Notifications ───────── */

export function NotificationPrefs({ prefs }: { prefs: { type: string; inApp: boolean; email: boolean }[] }) {
  const t = useTranslations("settings.notifications");
  const { act } = useAct();
  const [local, setLocal] = useState(prefs);
  const update = (type: string, patch: Partial<{ inApp: boolean; email: boolean }>) => {
    const next = local.map((p) => (p.type === type ? { ...p, ...patch } : p));
    setLocal(next);
    const row = next.find((p) => p.type === type)!;
    act(() => saveNotificationPref({ type, inApp: row.inApp, email: row.email }));
  };
  return (
    <Section title={t("title")} description={t("description")}>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 gap-y-3 text-sm">
        <span />
        <span className="text-xs font-semibold text-ink-3">{t("inApp")}</span>
        <span className="text-xs font-semibold text-ink-3">{t("email")}</span>
        {local.map((p) => (
          <div key={p.type} className="contents">
            <span>{t(`types.${p.type}` as "types.APPROVAL_NEEDED")}</span>
            <Switch label={`${t(`types.${p.type}` as "types.APPROVAL_NEEDED")} · ${t("inApp")}`} checked={p.inApp} onChange={(v) => update(p.type, { inApp: v })} />
            <Switch label={`${t(`types.${p.type}` as "types.APPROVAL_NEEDED")} · ${t("email")}`} checked={p.email} onChange={(v) => update(p.type, { email: v })} />
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-4">{t("futureChannels")}</p>
    </Section>
  );
}

/* ───────── Billing ───────── */

type BillingProps = {
  plan: "STARTER" | "GROWTH" | "SCALE";
  status: string;
  trialEndsAt: string | null;
  seats: { used: number; limit: number };
  channels: { used: number; limit: number };
  ai: { spentUsd: number; allowanceUsd: number; percent: number; softLimitPercent: number; hardLimitEnabled: boolean };
  byAgent: { agent: string; requests: number; costUsd: number }[];
  paymentsConfigured: boolean;
  canManage: boolean;
  invoices: { id: string; status: string; amount: string; date: string; url: string | null }[];
};

export function BillingSettings(b: BillingProps) {
  const t = useTranslations("settings.billing");
  const tc = useTranslations("common");
  const format = useFormatter();
  const { act, pending } = useAct();
  const [budget, setBudget] = useState({ monthlyAllowanceUsd: b.ai.allowanceUsd, softLimitPercent: b.ai.softLimitPercent, hardLimitEnabled: b.ai.hardLimitEnabled });
  const money = (v: number) => format.number(v, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  return (
    <div className="space-y-6">
      <Section title={t("plan")} description={b.paymentsConfigured ? t("planHint") : t("paymentsOff")}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-2xl font-semibold">{t(`plans.${b.plan}`)}</span>
          <Badge tone={b.status === "ACTIVE" ? "success" : b.status === "TRIALING" ? "info" : "warning"}>{t(`status.${b.status}` as "status.ACTIVE")}</Badge>
          {b.trialEndsAt && b.status === "TRIALING" && <span className="text-sm text-ink-3">{t("trialEnds", { date: format.dateTime(new Date(b.trialEndsAt), { dateStyle: "medium" }) })}</span>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {([["seats", b.seats], ["channels", b.channels]] as const).map(([k, v]) => (
            <div key={k} className="space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-ink-3">{t(k)}</span><span className="tabular font-medium">{v.used} / {v.limit}</span></div>
              <Progress value={(v.used / Math.max(1, v.limit)) * 100} label={t(k)} tone="ink" />
            </div>
          ))}
        </div>
        {b.canManage && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {(["STARTER", "GROWTH", "SCALE"] as const).filter((p) => p !== b.plan).map((p) => (
              <Button key={p} variant="secondary" size="sm" loading={pending} onClick={() => act(async () => {
                const r = await startCheckout({ plan: p });
                if (r.ok) window.location.href = r.data.url;
                return r;
              })}>
                {t("switchTo", { plan: t(`plans.${p}`) })}
              </Button>
            ))}
          </div>
        )}
      </Section>

      <Section
        title={t("ai")}
        description={t("aiHint")}
        footer={b.canManage && <Button loading={pending} onClick={() => act(() => saveAiBudget(budget), t("saved"))}>{tc("actions.save")}</Button>}
      >
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm"><span className="text-ink-3">{t("thisMonth")}</span><span className="tabular font-medium">{money(b.ai.spentUsd)} / {money(b.ai.allowanceUsd)}</span></div>
          <Progress value={b.ai.percent} label={t("ai")} tone={b.ai.percent >= 100 ? "danger" : b.ai.percent >= b.ai.softLimitPercent ? "warning" : "accent"} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("allowance")}>{(p) => <Input {...p} type="number" min={1} step="1" value={budget.monthlyAllowanceUsd} disabled={!b.canManage} onChange={(e) => setBudget({ ...budget, monthlyAllowanceUsd: Number(e.target.value) })} />}</Field>
          <Field label={t("softLimit")}>{(p) => <Input {...p} type="number" min={10} max={100} value={budget.softLimitPercent} disabled={!b.canManage} onChange={(e) => setBudget({ ...budget, softLimitPercent: Number(e.target.value) })} />}</Field>
          <div className="flex items-end justify-between gap-3 pb-2">
            <span className="text-sm">{t("hardLimit")}</span>
            <Switch label={t("hardLimit")} checked={budget.hardLimitEnabled} disabled={!b.canManage} onChange={(v) => setBudget({ ...budget, hardLimitEnabled: v })} />
          </div>
        </div>
        {b.byAgent.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-ink-2">{t("advanced")}</summary>
            <table className="mt-3 w-full text-start text-sm">
              <thead className="text-xs text-ink-3"><tr><th className="py-1 text-start font-medium">{t("agent")}</th><th className="text-end font-medium">{t("requests")}</th><th className="text-end font-medium">{t("cost")}</th></tr></thead>
              <tbody>
                {b.byAgent.map((r) => (
                  <tr key={r.agent} className="border-t border-line">
                    <td className="py-1.5">{r.agent === "none" ? t("system") : tc(`agents.${r.agent}.name` as "agents.DESIGNER.name")}</td>
                    <td className="text-end tabular">{r.requests}</td>
                    <td className="text-end tabular">{money(r.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </Section>

      <Section title={t("invoices")}>
        {b.invoices.length === 0 ? (
          <p className="text-sm text-ink-3">{t("noInvoices")}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {b.invoices.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5">
                <span className="flex-1">{i.date}</span>
                <span className="tabular">{i.amount}</span>
                <Badge tone={i.status === "paid" ? "success" : "neutral"}>{i.status}</Badge>
                {i.url && <a href={i.url} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">{t("view")}</a>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/* ───────── Security ───────── */

export function SecuritySettings({ sessions }: { sessions: { id: string; current: boolean; userAgent: string | null; ip: string | null; lastSeen: string }[] }) {
  const t = useTranslations("settings.security");
  const { act, pending } = useAct();
  return (
    <Section
      title={t("sessions")}
      description={t("sessionsHint")}
      footer={sessions.length > 1 && <Button variant="secondary" loading={pending} onClick={() => act(() => revokeSession({ all: true }), t("signedOutOthers"))}>{t("signOutOthers")}</Button>}
    >
      <ul className="divide-y divide-line">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-3 text-sm">
            <Monitor className="size-4 text-ink-3" />
            <div className="min-w-0 flex-1">
              <div className="truncate">{s.userAgent ?? t("unknownDevice")}</div>
              <div className="text-xs text-ink-4">{[s.ip, s.lastSeen].filter(Boolean).join(" · ")}</div>
            </div>
            {s.current ? <Badge tone="success">{t("current")}</Badge> : <Button size="xs" variant="ghost" onClick={() => act(() => revokeSession({ id: s.id }), t("signedOut"))}>{t("signOut")}</Button>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ───────── Data & privacy ───────── */

export function DataSettings({ orgName, email, exports, canExport, canDelete }: { orgName: string; email: string; exports: { id: string; status: string; date: string; url: string | null }[]; canExport: boolean; canDelete: boolean }) {
  const t = useTranslations("settings.data");
  const { act, pending } = useAct();
  const [orgConfirm, setOrgConfirm] = useState("");
  const [meConfirm, setMeConfirm] = useState("");
  return (
    <div className="space-y-6">
      <Section title={t("ownership")} description={t("ownershipBody")}>
        {canExport && <Button variant="secondary" loading={pending} icon={<Download className="size-4" />} onClick={() => act(() => requestExport({}), t("exportQueued"))}>{t("export")}</Button>}
        {exports.length > 0 && (
          <ul className="divide-y divide-line text-sm">
            {exports.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <span className="flex-1">{e.date}</span>
                <Badge tone={e.status === "READY" ? "success" : e.status === "FAILED" ? "danger" : "info"}>{t(`exportStatus.${e.status}` as "exportStatus.READY")}</Badge>
                {e.url && <a href={e.url} className="text-accent-ink hover:underline">{t("download")}</a>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink-4">{t("disconnectHint")}</p>
      </Section>
      {canDelete && (
        <Section title={t("deleteOrg")} description={t("deleteOrgBody")}>
          <Field label={t("typeToConfirm", { value: orgName })}>{(p) => <Input {...p} value={orgConfirm} onChange={(e) => setOrgConfirm(e.target.value)} />}</Field>
          <Button variant="danger" disabled={orgConfirm !== orgName} loading={pending} icon={<Trash2 className="size-4" />} onClick={() => act(() => deleteOrganizationAction({ confirm: orgConfirm }))}>{t("deleteOrg")}</Button>
        </Section>
      )}
      <Section title={t("deleteAccount")} description={t("deleteAccountBody")}>
        <Field label={t("typeToConfirm", { value: email })}>{(p) => <Input {...p} value={meConfirm} dir="ltr" onChange={(e) => setMeConfirm(e.target.value)} />}</Field>
        <Button variant="danger" disabled={meConfirm.toLowerCase() !== email.toLowerCase()} loading={pending} onClick={() => act(() => deleteAccount({ confirm: meConfirm }))}>{t("deleteAccount")}</Button>
      </Section>
    </div>
  );
}

/* ───────── Website lead capture ───────── */

export function LeadCaptureSettings({ forms, appUrl, canEdit }: { forms: { id: string; name: string; publicKey: string; allowedOrigins: string[]; isActive: boolean; submissions: number; successMessage: string }[]; appUrl: string; canEdit: boolean }) {
  const t = useTranslations("settings.leadCapture");
  const tc = useTranslations("common");
  const { act, pending } = useAct();
  const [newName, setNewName] = useState("");
  return (
    <div className="space-y-6">
      {forms.map((f) => (
        <LeadFormCard key={f.id} form={f} appUrl={appUrl} canEdit={canEdit} />
      ))}
      {canEdit && (
        <Section title={t("newForm")}>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act(() => saveLeadForm({ name: newName, allowedOrigins: [], isActive: true }), t("created"), () => setNewName("")); }}>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("formName")} required aria-label={t("formName")} />
            <Button type="submit" loading={pending} icon={<Plus className="size-4" />}>{tc("actions.create")}</Button>
          </form>
        </Section>
      )}
    </div>
  );
}

type LeadForm = { id: string; name: string; publicKey: string; allowedOrigins: string[]; isActive: boolean; submissions: number; successMessage: string };

function LeadFormCard({ form, appUrl: base, canEdit: editable }: { form: LeadForm; appUrl: string; canEdit: boolean }) {
const t = useTranslations("settings.leadCapture");
const tc = useTranslations("common");
const { act, pending } = useAct();
  const [origins, setOrigins] = useState(form.allowedOrigins.join("\n"));
  const [msg, setMsg] = useState(form.successMessage);
  const [active, setActive] = useState(form.isActive);
  const [copied, setCopied] = useState(false);
  const iframe = `<iframe src="${base}/embed/lead/${form.publicKey}" style="width:100%;max-width:520px;height:560px;border:0" title="Contact form"></iframe>`;
  const api = `POST ${base}/api/public/leads/${form.publicKey}\nContent-Type: application/json\n\n{"name":"…","email":"…","message":"…","utm_source":"…"}`;
  return (
    <Section
      title={form.name}
      description={t("submissions", { count: form.submissions })}
      footer={editable && (
        <Button loading={pending} onClick={() => act(() => saveLeadForm({ id: form.id, name: form.name, isActive: active, successMessage: msg || undefined, allowedOrigins: origins.split("\n").map((x) => x.trim()).filter(Boolean) }), t("saved"))}>{tc("actions.save")}</Button>
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t("active")}</span>
        <Switch label={t("active")} checked={active} disabled={!editable} onChange={setActive} />
      </div>
      <Field label={t("embed")} hint={t("embedHint")}>
        {(p) => (
          <div className="relative">
            <Textarea {...p} readOnly rows={3} value={iframe} dir="ltr" className="font-mono text-xs" />
            <button type="button" className="absolute end-2 top-2 rounded-lg bg-surface p-1.5 text-ink-3 shadow-xs hover:text-ink" onClick={() => { void navigator.clipboard.writeText(iframe); setCopied(true); toast(tc("actions.copied")); }} aria-label={tc("actions.copy")}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        )}
      </Field>
      <Field label={t("api")} hint={t("apiHint")}>{(p) => <Textarea {...p} readOnly rows={5} value={api} dir="ltr" className="font-mono text-xs" />}</Field>
      <Field label={t("origins")} hint={t("originsHint")}>{(p) => <Textarea {...p} rows={3} value={origins} dir="ltr" disabled={!editable} onChange={(e) => setOrigins(e.target.value)} placeholder="https://yourcompany.com" />}</Field>
      <Field label={t("successMessage")} optional={tc("optional")}>{(p) => <Input {...p} value={msg} disabled={!editable} onChange={(e) => setMsg(e.target.value)} />}</Field>
    </Section>
  );
}

