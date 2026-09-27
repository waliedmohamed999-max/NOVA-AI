"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import type { Policies } from "@/server/approvals/policies";
import { Section, useAct } from "./ui";
import { savePolicies, saveApprovalPolicy } from "./actions";

const FORMATS = ["POST", "CAROUSEL", "STORY", "REEL", "SHORT_VIDEO", "LINKEDIN_POST"] as const;
const FAQ = ["greeting", "opening_hours", "location", "services_info", "contact_details", "booking_info"] as const;
const LOCKED = ["discount", "custom_pricing", "proposal", "contract_promise"] as const;

/** Approval rules written as business decisions, not switches for internal actions. */
export function BusinessPolicies({ initial, salesAutoReply, canEdit }: { initial: Policies; salesAutoReply: boolean; canEdit: boolean }) {
  const t = useTranslations("settings.policies");
  const tc = useTranslations("common");
  const { act, pending } = useAct();
  const [p, setP] = useState(initial);
  const [autoReply, setAutoReply] = useState(salesAutoReply);
  const toggle = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const chip = (on: boolean) => cn("rounded-full border px-3 py-1.5 text-sm transition", on ? "border-accent bg-accent-soft text-accent-ink" : "border-line text-ink-3 hover:text-ink", !canEdit && "pointer-events-none opacity-60");

  return (
    <div className="space-y-6">
      <Section
        title={t("content.title")}
        description={t("content.description")}
        footer={canEdit && <Button loading={pending} onClick={() => act(() => savePolicies(p), t("saved"))}>{tc("actions.save")}</Button>}
      >
        <fieldset className="space-y-2" disabled={!canEdit}>
          <legend className="sr-only">{t("content.title")}</legend>
          {(["always", "auto_selected"] as const).map((mode) => (
            <label key={mode} className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5", p.content.mode === mode ? "border-accent bg-accent-soft/40" : "border-line")}>
              <input type="radio" name="content-mode" className="mt-1" checked={p.content.mode === mode} onChange={() => setP({ ...p, content: { ...p.content, mode } })} />
              <span>
                <span className="block text-sm font-medium">{t(`content.${mode}`)}</span>
                <span className="block text-xs text-ink-3">{t(`content.${mode}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {p.content.mode === "auto_selected" && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-ink-3">{t("content.formats")}</p>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map((f) => (
                <button key={f} type="button" aria-pressed={p.content.autoFormats.includes(f)} className={chip(p.content.autoFormats.includes(f))} onClick={() => setP({ ...p, content: { ...p.content, autoFormats: toggle(p.content.autoFormats, f) } })}>
                  {tc(`formats.${f}` as "formats.POST")}
                </button>
              ))}
            </div>
            {p.content.autoFormats.length === 0 && <p className="text-xs text-ink-4">{t("content.noneSelected")}</p>}
          </div>
        )}
      </Section>

      <Section title={t("sales.title")} description={t("sales.description")}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">{t("sales.autoReply")}</div>
            <div className="text-xs text-ink-3">{t("sales.autoReplyHint")}</div>
          </div>
          <Switch
            label={t("sales.autoReply")}
            checked={autoReply}
            disabled={!canEdit}
            onChange={(v) => {
              setAutoReply(v);
              act(() => saveApprovalPolicy({ action: "send_message", requiresApproval: !v }), t("saved"));
            }}
          />
        </div>
        <div className="rounded-2xl bg-surface-2 p-3.5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-2"><Lock className="size-3.5" /> {t("sales.alwaysAsk")}</p>
          <ul className="grid gap-1 text-sm text-ink-2 sm:grid-cols-2">
            {LOCKED.map((k) => <li key={k}>• {t(`sales.locked.${k}`)}</li>)}
          </ul>
        </div>
      </Section>

      <Section
        title={t("messages.title")}
        description={t("messages.description")}
        footer={canEdit && <Button loading={pending} onClick={() => act(() => savePolicies(p), t("saved"))}>{tc("actions.save")}</Button>}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">{t("messages.autoFaq")}</div>
            <div className="text-xs text-ink-3">{t("messages.autoFaqHint")}</div>
          </div>
          <Switch label={t("messages.autoFaq")} checked={p.messages.autoReplyFaq} disabled={!canEdit} onChange={(v) => setP({ ...p, messages: { ...p.messages, autoReplyFaq: v } })} />
        </div>
        {p.messages.autoReplyFaq && (
          <div className="flex flex-wrap gap-2">
            {FAQ.map((f) => (
              <button key={f} type="button" aria-pressed={p.messages.safeIntents.includes(f)} className={chip(p.messages.safeIntents.includes(f))} onClick={() => setP({ ...p, messages: { ...p.messages, safeIntents: toggle(p.messages.safeIntents, f) } })}>
                {t(`messages.intents.${f}`)}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-4">{t("messages.note")}</p>
      </Section>
    </div>
  );
}
