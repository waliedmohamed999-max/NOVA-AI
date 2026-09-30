"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Briefcase, Building, Building2, CheckCircle2, Globe, Layers, Loader2, Package, Sparkles, User, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { BUSINESS_TYPES, COUNTRIES, CUSTOMER_TYPES, INDUSTRIES, WEBSITE_RE, countryName, label, type BusinessType, type CustomerType } from "@/lib/onboarding-setup";
import { useSetup } from "./state";
import { StepFooter } from "./footer";
import { ChoiceCard, GroupLabel, QuestionRow, StatusChip, StepCard, TagInput, inputClass } from "./ui";

const TYPE_ICONS: Record<BusinessType, typeof Package> = { PRODUCTS: Package, SERVICES: Briefcase, BOTH: Layers };
const CUSTOMER_ICONS: Record<CustomerType, typeof User> = { B2C: User, B2B: Building, BOTH: Users };

export function BusinessStep() {
  const t = useTranslations("onboarding.setup");
  const tb = useTranslations("onboarding.setup.business");
  const s = useSetup();
  const a = s.answers;
  const ids = { name: useId(), site: useId(), industry: useId(), country: useId(), markets: useId(), desc: useId(), offer: useId(), list: useId() };
  const industryRef = useRef<HTMLInputElement>(null);
  const [site, setSite] = useState(a.website ?? "");
  const [nameTouched, setNameTouched] = useState(false);
  const siteInvalid = Boolean(site.trim()) && !WEBSITE_RE.test(site.trim());
  const suggestion = s.site.phase === "review" || s.site.phase === "applied" ? s.site.findings?.industry : null;

  return (
    <StepCard icon={<Building2 />} title={tb("title")} subtitle={tb("subtitle")} footer={<StepFooter step="business" />}>
      {!s.hasOrg && !s.companyName.trim() && <p className="rounded-2xl bg-nova-blue-soft px-4 py-3 text-sm text-nova-blue">{tb("needName")}</p>}

      <div className="space-y-5 rounded-3xl border border-line p-4 sm:p-6">
        <QuestionRow label={tb("name.q")} hint={tb("name.hint")} done={Boolean(s.companyName.trim())} required htmlFor={ids.name}>
          <FieldIcon icon={<Building2 />}>
            <input
              id={ids.name}
              value={s.companyName}
              onChange={(e) => s.update("business", { companyName: e.target.value.slice(0, 120) })}
              onBlur={() => setNameTouched(true)}
              placeholder={tb("name.placeholder")}
              aria-invalid={nameTouched && !s.companyName.trim() ? true : undefined}
              aria-required
              autoComplete="organization"
              className={cn(inputClass, "ps-12")}
            />
          </FieldIcon>
        </QuestionRow>

        <QuestionRow label={tb("website.q")} hint={tb("website.hint")} done={s.site.phase === "applied" || Boolean(a.noWebsite) || (Boolean(site.trim()) && !siteInvalid)} htmlFor={ids.site}>
          {a.noWebsite ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-ink-2">{tb("website.none")}</span>
              <button type="button" className="text-sm font-semibold text-nova-blue hover:underline" onClick={() => s.update("business", { noWebsite: false })}>
                {tb("website.has")}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <FieldIcon icon={<Globe />} className="flex-1">
                  <input
                    id={ids.site}
                    dir="ltr"
                    inputMode="url"
                    value={site}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSite(v);
                      if (!v.trim() || WEBSITE_RE.test(v.trim())) s.update("business", { website: v.trim() || null });
                    }}
                    placeholder={tb("website.placeholder")}
                    aria-invalid={siteInvalid || undefined}
                    className={cn(inputClass, "ps-12 text-start")}
                  />
                </FieldIcon>
                <button
                  type="button"
                  onClick={() => void s.analyze(site)}
                  disabled={!site.trim() || siteInvalid || s.site.phase === "running" || (!s.hasOrg && !s.companyName.trim())}
                  data-testid="analyze-website"
                  className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-nova-blue px-5 text-sm font-semibold text-white transition hover:bg-nova-blue-strong disabled:opacity-40"
                >
                  {s.site.phase === "running" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {tb("website.analyze")}
                </button>
              </div>
              {siteInvalid && (
                <p role="alert" className="text-xs font-medium text-danger">
                  {tb("website.invalid")}
                </p>
              )}
              <button type="button" className="text-xs font-medium text-ink-3 hover:text-ink" onClick={() => { setSite(""); s.update("business", { noWebsite: true, website: null }); s.resetSite(); }}>
                {tb("website.none")}
              </button>
            </div>
          )}
        </QuestionRow>

        {!a.noWebsite && <WebsitePanel onRetry={() => void s.analyze(site)} />}

        <QuestionRow label={tb("industry.q")} hint={tb("industry.hint")} done={Boolean(a.industry?.trim())} required htmlFor={ids.industry}>
          <div className="space-y-2">
            <input ref={industryRef} id={ids.industry} list={ids.list} value={a.industry ?? ""} onChange={(e) => s.update("business", { industry: e.target.value.slice(0, 120) })} placeholder={tb("industry.placeholder")} aria-required className={inputClass} autoComplete="off" />
            <datalist id={ids.list}>
              {Object.values(INDUSTRIES).map((o) => (
                <option key={o.en} value={label(o, s.lang)} />
              ))}
            </datalist>
            {suggestion && suggestion !== a.industry && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-nova-blue-soft px-3 py-2 text-sm" data-testid="industry-suggestion">
                <Sparkles className="size-4 text-nova-blue" />
                <span className="font-medium text-ink">{tb("industry.suggest", { value: suggestion })}</span>
                <span className="ms-auto flex gap-1.5">
                  <button type="button" onClick={() => s.update("business", { industry: suggestion }, { immediate: true })} className="rounded-full bg-nova-blue px-3 py-1 text-xs font-semibold text-white">
                    {tb("industry.accept")}
                  </button>
                  <button type="button" onClick={() => { s.update("business", { industry: suggestion }); industryRef.current?.focus(); }} className="rounded-full border border-nova-blue-line bg-surface px-3 py-1 text-xs font-semibold text-ink">
                    {tb("industry.edit")}
                  </button>
                </span>
              </div>
            )}
          </div>
        </QuestionRow>

        <QuestionRow label={tb("country.q")} done={Boolean(a.country)} htmlFor={ids.country}>
          <div className="grid gap-2 sm:grid-cols-2">
            <select id={ids.country} value={a.country ?? ""} onChange={(e) => s.update("business", { country: e.target.value || null }, { immediate: true })} className={cn(inputClass, "appearance-none")}>
              <option value="">{tb("country.placeholder")}</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {countryName(c, s.lang)}
                </option>
              ))}
            </select>
            <input id={ids.markets} aria-label={tb("markets.q")} value={a.markets ?? ""} onChange={(e) => s.update("business", { markets: e.target.value.slice(0, 200) })} placeholder={tb("markets.placeholder")} className={inputClass} />
          </div>
        </QuestionRow>

        <QuestionRow label={tb("description.q")} hint={t("optional")} done={Boolean(a.description?.trim())} htmlFor={ids.desc}>
          <textarea id={ids.desc} rows={2} value={a.description ?? ""} onChange={(e) => s.update("business", { description: e.target.value.slice(0, 2000) })} placeholder={tb("description.placeholder")} className={cn(inputClass, "h-auto min-h-[76px] resize-y py-3")} />
        </QuestionRow>

        <QuestionRow label={tb("offerings.q")} hint={tb("offerings.hint")} done={Boolean(a.offerings?.length)} htmlFor={ids.offer}>
          <TagInput id={ids.offer} values={a.offerings ?? []} onChange={(v) => s.update("business", { offerings: v }, { immediate: true })} placeholder={tb("offerings.placeholder")} addLabel={tb("offerings.add")} removeLabel={(v) => tb("offerings.remove", { name: v })} />
        </QuestionRow>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 rounded-3xl border border-line bg-surface-2 p-4 sm:p-5">
          <GroupLabel hint={tb("type.hint")}>{tb("type.q")}</GroupLabel>
          <div role="radiogroup" aria-label={tb("type.q")} className="grid grid-cols-3 gap-2.5">
            {(Object.keys(BUSINESS_TYPES) as BusinessType[]).map((k) => {
              const Icon = TYPE_ICONS[k];
              return <ChoiceCard key={k} selected={a.businessType === k} onClick={() => s.update("business", { businessType: k }, { immediate: true })} icon={<Icon />} title={label(BUSINESS_TYPES[k], s.lang)} desc={tb(`typeDesc.${k}`)} />;
            })}
          </div>
        </div>
        <div className="space-y-4 rounded-3xl border border-line bg-surface-2 p-4 sm:p-5">
          <GroupLabel hint={tb("customerType.hint")}>{tb("customerType.q")}</GroupLabel>
          <div role="radiogroup" aria-label={tb("customerType.q")} className="grid grid-cols-3 gap-2.5">
            {(Object.keys(CUSTOMER_TYPES) as CustomerType[]).map((k) => {
              const Icon = CUSTOMER_ICONS[k];
              return <ChoiceCard key={k} selected={a.customerType === k} onClick={() => s.update("business", { customerType: k }, { immediate: true })} icon={<Icon />} title={label(CUSTOMER_TYPES[k], s.lang)} desc={tb(`customerDesc.${k}`)} />;
            })}
          </div>
        </div>
      </div>
    </StepCard>
  );
}

function FieldIcon({ icon, children, className }: { icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute inset-y-1.5 start-1.5 flex w-9 items-center justify-center rounded-xl bg-sunken text-ink-3 [&_svg]:size-[18px]" aria-hidden>
        {icon}
      </span>
      {children}
    </div>
  );
}

/** Live website analysis: real job states, then what was found for the owner to approve. */
function WebsitePanel({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("onboarding.setup.site");
  const te = useTranslations("errors");
  const s = useSetup();
  const [picked, setPicked] = useState<string[] | null>(null);
  const [pending, start] = useTransition();
  const site = s.site;
  if (site.phase === "idle") return null;

  if (site.phase === "failed") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm" data-testid="site-failed">
        <AlertTriangle className="size-4 text-warning" />
        <span className="flex-1 text-ink">{site.error === "invalid" ? te("validation") : t("failed")}</span>
        {site.error !== "invalid" && (
          <button type="button" onClick={onRetry} className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold">
            {t("retry")}
          </button>
        )}
      </div>
    );
  }

  const f = site.findings;
  if (site.phase === "running") {
    const st = f?.status ?? "UPLOADED";
    const rows = [
      { key: "fetch", done: st === "EXTRACTING" || st === "REVIEW", active: st === "UPLOADED" || st === "PARSING" },
      { key: "detect", done: Boolean(f?.title) , active: st === "EXTRACTING" && !f?.title },
      { key: "extract", done: false, active: st === "EXTRACTING" },
    ] as const;
    return (
      <div className="space-y-3 rounded-2xl border border-nova-blue-line bg-nova-blue-soft/50 p-4" aria-live="polite" data-testid="site-running">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Loader2 className="size-4 animate-spin text-nova-blue" /> {t("analyzing")}
        </p>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className={cn("flex items-center gap-2 text-sm", r.done || r.active ? "text-ink" : "text-ink-4")}>
              {r.done ? <CheckCircle2 className="size-4 text-success" /> : r.active ? <Loader2 className="size-4 animate-spin text-nova-blue" /> : <span className="size-4 rounded-full border border-line-strong" />}
              {t(r.key)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (site.phase === "applied") {
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid="site-applied">
        <StatusChip>{t("applied")}</StatusChip>
        {f && f.pages > 0 && <StatusChip tone="info">{t("pages", { count: f.pages })}</StatusChip>}
      </div>
    );
  }

  // review
  const findings = site.findings;
  const selected = picked ?? findings.offerings.filter((o) => o.selected).map((o) => o.id);
  return (
    <div className="space-y-4 rounded-2xl border border-nova-blue-line bg-nova-blue-soft/40 p-4" data-testid="site-review">
      <ul className="space-y-1.5 text-sm">
        {(findings.title || findings.description) && (
          <li className="flex items-center gap-2 text-ink">
            <CheckCircle2 className="size-4 text-success" /> {t("activity")}
            {findings.title && <span className="truncate text-ink-3">— {findings.title}</span>}
          </li>
        )}
        <li className="flex items-center gap-2 text-ink">
          <CheckCircle2 className={cn("size-4", findings.offerings.length ? "text-success" : "text-ink-4")} /> {t("services", { count: findings.offerings.length })}
        </li>
        <li className="flex items-center gap-2 text-ink">
          <CheckCircle2 className="size-4 text-success" /> {t("pages", { count: findings.pages })}
        </li>
        {findings.platform && findings.platform !== "generic" && <li className="text-xs text-ink-3">{t("platform", { name: findings.platform })}</li>}
      </ul>
      {findings.offerings.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold text-ink">{t("pick")}</legend>
          <div className="flex flex-wrap gap-2">
            {findings.offerings.map((o) => {
              const on = selected.includes(o.id);
              return (
                <label key={o.id} className={cn("inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm font-medium transition", on ? "border-nova-blue bg-surface text-ink" : "border-line bg-surface/60 text-ink-3")}>
                  <input type="checkbox" className="size-4 accent-[var(--nova-blue)]" checked={on} onChange={() => setPicked(on ? selected.filter((x) => x !== o.id) : [...selected, o.id])} />
                  {o.name}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <p className="text-sm text-ink-3">{t("noneFound")}</p>
      )}
      {findings.critical > 0 && <p className="text-xs text-ink-3">{t("critical", { count: findings.critical })}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => void (await s.applySite(selected)))}
        data-testid="apply-website"
        className="inline-flex h-11 items-center gap-2 rounded-2xl bg-ink px-5 text-sm font-semibold text-ink-inverse transition hover:-translate-y-0.5 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        {t("apply")}
      </button>
    </div>
  );
}
