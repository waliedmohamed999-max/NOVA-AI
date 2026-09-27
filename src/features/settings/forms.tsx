"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Section, useAct } from "./ui";
import { changePassword, saveOrganization, saveProfile } from "./actions";

export function OrganizationForm({ org, timezones, canEdit }: { org: { name: string; timezone: string; locale: "en" | "ar"; website: string; slug: string }; timezones: string[]; canEdit: boolean }) {
  const t = useTranslations("settings.organization");
  const tc = useTranslations("common");
  const { act, pending } = useAct();
  const [f, setF] = useState(org);
  return (
    <Section
      title={t("title")}
      description={t("description")}
      footer={canEdit && <Button loading={pending} onClick={() => act(() => saveOrganization({ name: f.name, timezone: f.timezone, locale: f.locale, website: f.website }), t("saved"))}>{tc("actions.save")}</Button>}
    >
      <Field label={t("name")}>{(p) => <Input {...p} value={f.name} disabled={!canEdit} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("timezone")} hint={t("timezoneHint")}>
          {(p) => (
            <Select {...p} value={f.timezone} disabled={!canEdit} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {["UTC", ...timezones].map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t("language")} hint={t("languageHint")}>
          {(p) => (
            <Select {...p} value={f.locale} disabled={!canEdit} onChange={(e) => setF({ ...f, locale: e.target.value as "en" | "ar" })}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
          )}
        </Field>
      </div>
      <Field label={t("website")} optional={tc("optional")}>{(p) => <Input {...p} value={f.website} dir="ltr" disabled={!canEdit} onChange={(e) => setF({ ...f, website: e.target.value })} />}</Field>
      <p className="text-xs text-ink-4">{t("id", { slug: org.slug })}</p>
    </Section>
  );
}

export function ProfileForm({ user }: { user: { name: string; email: string; locale: "en" | "ar" } }) {
  const t = useTranslations("settings.profile");
  const tc = useTranslations("common");
  const tf = useTranslations("auth.fields");
  const { act, pending } = useAct();
  const [f, setF] = useState(user);
  const [pw, setPw] = useState({ current: "", next: "" });
  return (
    <div className="space-y-6">
      <Section title={t("title")} description={t("description")} footer={<Button loading={pending} onClick={() => act(() => saveProfile({ name: f.name, locale: f.locale }), t("saved"))}>{tc("actions.save")}</Button>}>
        <Field label={tf("name")}>{(p) => <Input {...p} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label={tf("email")} hint={t("emailHint")}>{(p) => <Input {...p} value={f.email} disabled dir="ltr" />}</Field>
        <Field label={t("language")}>
          {(p) => (
            <Select {...p} value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value as "en" | "ar" })}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
          )}
        </Field>
      </Section>
      <Section
        title={t("password")}
        description={t("passwordHint")}
        footer={<Button variant="secondary" disabled={!pw.next} loading={pending} onClick={() => act(() => changePassword(pw), t("passwordChanged"), () => setPw({ current: "", next: "" }))}>{t("changePassword")}</Button>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("currentPassword")}>{(p) => <Input {...p} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}</Field>
          <Field label={tf("newPassword")} hint={tf("passwordHint")}>{(p) => <Input {...p} type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />}</Field>
        </div>
      </Section>
    </div>
  );
}
