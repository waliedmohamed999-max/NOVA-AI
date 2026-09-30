"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Loader2, Plus, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { BUDGETS, COMPANY_SIZES, CUSTOMER_TYPES, label, type Budget, type CompanySize } from "@/lib/onboarding-setup";
import { suggestAudienceAction } from "../actions";
import { useSetup } from "./state";
import { StepFooter } from "./footer";
import { GroupLabel, Pill, QuestionRow, StepCard, TagInput, inputClass } from "./ui";

export function AudienceStep() {
  const t = useTranslations("onboarding.setup");
  const ta = useTranslations("onboarding.setup.audience");
  const s = useSetup();
  const a = s.answers;
  const au = a.audience ?? {};
  const ids = { who: useId(), loc: useId(), ind: useId(), dm: useId(), min: useId(), max: useId(), pains: useId(), trig: useId() };
  const b2b = a.customerType !== "B2C";
  const b2c = a.customerType !== "B2B";
  const hasDetail = Boolean(au.industries?.length || au.companySize || au.decisionMaker || au.ageMin || au.budget);
  const hasPains = Boolean(au.painPoints?.length || au.buyingTriggers?.length);
  const [level, setLevel] = useState(hasPains ? 3 : hasDetail ? 2 : 1);
  const [ageMin, setAgeMin] = useState(au.ageMin?.toString() ?? "");
  const [ageMax, setAgeMax] = useState(au.ageMax?.toString() ?? "");
  const detected = s.site.phase === "review" || s.site.phase === "applied" ? s.site.findings?.customerType : null;

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const ageValid = (lo: number | null, hi: number | null) => [lo, hi].every((x) => x === null || (Number.isInteger(x) && x >= 13 && x <= 100)) && (lo === null || hi === null || lo <= hi);
  const ageError = !ageValid(num(ageMin), num(ageMax));
  const setAge = (lo: string, hi: string) => {
    setAgeMin(lo);
    setAgeMax(hi);
    if (ageValid(num(lo), num(hi))) s.update("audience", { ageMin: num(lo), ageMax: num(hi) });
  };

  return (
    <StepCard icon={<Users />} title={ta("title")} subtitle={ta("subtitle")} footer={<StepFooter step="audience" />}>
      <div className="flex flex-wrap items-center gap-2">
        {a.customerType && (
          <span className="inline-flex h-9 items-center gap-2 rounded-full bg-nova-blue-soft px-3.5 text-sm font-semibold text-nova-blue ring-1 ring-nova-blue-line">
            {ta("known", { value: label(CUSTOMER_TYPES[a.customerType], s.lang) })}
            <button type="button" className="text-xs font-semibold text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={() => void s.goTo("business")}>
              {ta("change")}
            </button>
          </span>
        )}
        {detected && detected !== a.customerType && (
          <span className="inline-flex flex-wrap items-center gap-2 rounded-2xl bg-accent-soft px-3.5 py-2 text-sm text-ink" data-testid="audience-detected">
            <Sparkles className="size-4 text-accent" />
            {ta("detected", { value: label(CUSTOMER_TYPES[detected as keyof typeof CUSTOMER_TYPES], s.lang) })}
            <button type="button" className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-ink-inverse" onClick={() => s.update("business", { customerType: detected }, { immediate: true })}>
              {t("business.industry.accept")}
            </button>
          </span>
        )}
      </div>

      <div className="space-y-5 rounded-3xl border border-line p-4 sm:p-6">
        <QuestionRow label={ta("who.q")} done={Boolean(a.customers?.trim())} required htmlFor={ids.who}>
          <textarea id={ids.who} rows={2} value={a.customers ?? ""} onChange={(e) => s.update("audience", { customers: e.target.value.slice(0, 1000) })} placeholder={ta("who.placeholder")} aria-required className={cn(inputClass, "h-auto min-h-[76px] resize-y py-3")} />
        </QuestionRow>
        <QuestionRow label={ta("locations.q")} done={Boolean(au.locations?.trim() || a.markets?.trim())} required htmlFor={ids.loc}>
          <input id={ids.loc} value={au.locations ?? a.markets ?? ""} onChange={(e) => s.update("audience", { locations: e.target.value.slice(0, 200) })} placeholder={ta("locations.placeholder")} aria-required className={inputClass} />
        </QuestionRow>
      </div>

      {level >= 2 && (
        <div className="space-y-5 rounded-3xl border border-line p-4 animate-fade-up sm:p-6">
          {b2b && (
            <>
              <GroupLabel>{ta("b2b.title")}</GroupLabel>
              <QuestionRow label={ta("b2b.industries.q")} done={Boolean(au.industries?.length)} htmlFor={ids.ind}>
                <TagInput id={ids.ind} values={au.industries ?? []} max={8} onChange={(v) => s.update("audience", { industries: v }, { immediate: true })} placeholder={ta("b2b.industries.placeholder")} addLabel={t("business.offerings.add")} removeLabel={(v) => t("business.offerings.remove", { name: v })} />
              </QuestionRow>
              <QuestionRow label={ta("b2b.size.q")} done={Boolean(au.companySize)}>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={ta("b2b.size.q")}>
                  {(Object.keys(COMPANY_SIZES) as CompanySize[]).map((k) => (
                    <Pill key={k} selected={au.companySize === k} onClick={() => s.update("audience", { companySize: au.companySize === k ? null : k }, { immediate: true })}>
                      {label(COMPANY_SIZES[k], s.lang)}
                    </Pill>
                  ))}
                </div>
              </QuestionRow>
              <QuestionRow label={ta("b2b.decision.q")} done={Boolean(au.decisionMaker?.trim())} htmlFor={ids.dm}>
                <input id={ids.dm} value={au.decisionMaker ?? ""} onChange={(e) => s.update("audience", { decisionMaker: e.target.value.slice(0, 160) })} placeholder={ta("b2b.decision.placeholder")} className={inputClass} />
              </QuestionRow>
            </>
          )}
          {b2c && (
            <>
              <GroupLabel>{ta("b2c.title")}</GroupLabel>
              <QuestionRow label={ta("b2c.age.q")} done={Boolean(au.ageMin && au.ageMax)} htmlFor={ids.min}>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <input id={ids.min} type="number" inputMode="numeric" min={13} max={100} value={ageMin} onChange={(e) => setAge(e.target.value, ageMax)} aria-label={ta("b2c.age.min")} placeholder={ta("b2c.age.min")} aria-invalid={ageError || undefined} className={cn(inputClass, "w-28")} dir="ltr" />
                    <span className="text-ink-4">—</span>
                    <input id={ids.max} type="number" inputMode="numeric" min={13} max={100} value={ageMax} onChange={(e) => setAge(ageMin, e.target.value)} aria-label={ta("b2c.age.max")} placeholder={ta("b2c.age.max")} aria-invalid={ageError || undefined} className={cn(inputClass, "w-28")} dir="ltr" />
                  </div>
                  {ageError && (
                    <p role="alert" className="text-xs font-medium text-danger">
                      {ta("b2c.age.error")}
                    </p>
                  )}
                </div>
              </QuestionRow>
            </>
          )}
          <QuestionRow label={ta("budget.q")} done={Boolean(au.budget)}>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={ta("budget.q")}>
              {(Object.keys(BUDGETS) as Budget[]).map((k) => (
                <Pill key={k} selected={au.budget === k} onClick={() => s.update("audience", { budget: au.budget === k ? null : k }, { immediate: true })}>
                  {label(BUDGETS[k], s.lang)}
                </Pill>
              ))}
            </div>
          </QuestionRow>
        </div>
      )}

      {level >= 3 && (
        <div className="space-y-5 rounded-3xl border border-line p-4 animate-fade-up sm:p-6">
          <QuestionRow label={ta("pains.q")} done={Boolean(au.painPoints?.length)} htmlFor={ids.pains}>
            <TagInput id={ids.pains} values={au.painPoints ?? []} max={8} onChange={(v) => s.update("audience", { painPoints: v }, { immediate: true })} placeholder={ta("pains.placeholder")} addLabel={t("business.offerings.add")} removeLabel={(v) => t("business.offerings.remove", { name: v })} />
          </QuestionRow>
          <QuestionRow label={ta("triggers.q")} done={Boolean(au.buyingTriggers?.length)} htmlFor={ids.trig}>
            <TagInput id={ids.trig} values={au.buyingTriggers ?? []} max={8} onChange={(v) => s.update("audience", { buyingTriggers: v }, { immediate: true })} placeholder={ta("triggers.placeholder")} addLabel={t("business.offerings.add")} removeLabel={(v) => t("business.offerings.remove", { name: v })} />
          </QuestionRow>
          <AudienceSuggestions />
        </div>
      )}

      {level < 3 && (
        <button type="button" onClick={() => setLevel(level + 1)} className="inline-flex items-center gap-2 rounded-full border border-dashed border-nova-blue-line px-4 py-2 text-sm font-semibold text-nova-blue transition hover:bg-nova-blue-soft">
          <ChevronDown className="size-4" /> {ta("more")}
        </button>
      )}
    </StepCard>
  );
}

/** Optional AI help: nothing is stored until the owner adds a suggestion. Hidden without a provider. */
function AudienceSuggestions() {
  const t = useTranslations("onboarding.setup");
  const te = useTranslations("errors");
  const s = useSetup();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ painPoints: string[]; buyingTriggers: string[]; decisionMaker: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const au = s.answers.audience ?? {};
  if (!s.aiConfigured) return <p className="rounded-2xl bg-sunken px-4 py-3 text-sm text-ink-3">{t("aiOptional")}</p>;
  const add = (field: "painPoints" | "buyingTriggers", v: string) => {
    const cur = au[field] ?? [];
    if (!cur.includes(v) && cur.length < 8) s.update("audience", { [field]: [...cur, v] }, { immediate: true });
  };
  return (
    <div className="space-y-3 rounded-2xl border border-accent/20 bg-accent-soft/50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              await s.flush();
              const r = await suggestAudienceAction();
              if (r.ok) setRes(r.data);
              else setError(r.error ?? "unexpected");
            })
          }
          className="inline-flex h-10 items-center gap-2 rounded-2xl bg-ink px-4 text-sm font-semibold text-ink-inverse disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4 text-accent" />}
          {t("audience.suggest.cta")}
        </button>
        <span className="text-xs text-ink-3">{t("audience.suggest.hint")}</span>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{te(error as "unexpected")}</p>}
      {res && (
        <div className="space-y-2">
          {!res.painPoints.length && !res.buyingTriggers.length && !res.decisionMaker && <p className="text-sm text-ink-3">{t("audience.suggest.none")}</p>}
          <div className="flex flex-wrap gap-2">
            {res.painPoints.map((p) => (
              <SuggestChip key={`p${p}`} onAdd={() => add("painPoints", p)} added={Boolean(au.painPoints?.includes(p))}>{p}</SuggestChip>
            ))}
            {res.buyingTriggers.map((p) => (
              <SuggestChip key={`b${p}`} onAdd={() => add("buyingTriggers", p)} added={Boolean(au.buyingTriggers?.includes(p))}>{p}</SuggestChip>
            ))}
          </div>
          {res.decisionMaker && (
            <SuggestChip onAdd={() => s.update("audience", { decisionMaker: res.decisionMaker }, { immediate: true })} added={au.decisionMaker === res.decisionMaker}>
              {t("audience.suggest.decisionMaker", { value: res.decisionMaker })}
            </SuggestChip>
          )}
        </div>
      )}
    </div>
  );
}

function SuggestChip({ children, onAdd, added }: { children: React.ReactNode; onAdd: () => void; added: boolean }) {
  return (
    <button type="button" onClick={onAdd} disabled={added} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-start text-sm transition", added ? "border-success/30 bg-success-soft text-success" : "border-line bg-surface text-ink hover:border-accent/40")}>
      {!added && <Plus className="size-3.5" />}
      {children}
    </button>
  );
}
