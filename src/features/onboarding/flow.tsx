"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, Check, Globe, Plus, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Progress } from "@/components/ui/misc";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { useRun, RunSteps } from "@/features/agents/run-view";
import type { OnboardingSnapshot } from "@/server/onboarding/service";
import { saveAnswers, saveCompanyName, saveWebsite, startOnboardingAnalysis } from "./actions";

type ProviderTile = { provider: string; oauth: string; configured: boolean };

const TONES = ["friendly", "professional", "bold", "luxury", "playful", "warm", "expert", "calm"] as const;
const GOALS = ["customers", "content", "awareness", "leads", "sales", "everything"] as const;
const STEPS = 8;

function Bubble({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="flex items-start gap-3">
      <span className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-2xl bg-ink text-accent shadow-sm">
        <Sparkles className="size-4" />
      </span>
      <div className="space-y-2 pt-1">{children}</div>
    </motion.div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition",
        active ? "border-ink bg-ink text-ink-inverse" : "border-line bg-surface text-ink-2 hover:border-line-strong",
      )}
    >
      {active && <Check className="size-3.5" />}
      {children}
    </button>
  );
}

export function OnboardingFlow({ userName, initial, providers }: { userName: string; initial: OnboardingSnapshot; providers: ProviderTile[] }) {
  const t = useTranslations("onboarding");
  const te = useTranslations("errors");
  const tc = useTranslations("common");
  const router = useRouter();
  const a = initial.answers;
  const [step, setStep] = useState<number>(initial.status === "ANALYZING" && a.runId ? 8 : initial.organizationId ? Math.max(2, a.step ?? 2) : 0);
  const [runId, setRunId] = useState<string | null>(a.runId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [company, setCompany] = useState(initial.companyName ?? "");
  const [website, setWebsite] = useState(a.website ?? "");
  const [sells, setSells] = useState(a.sells ?? "");
  const [description, setDescription] = useState(a.description ?? "");
  const [offerings, setOfferings] = useState<string[]>(a.offerings ?? []);
  const [offeringDraft, setOfferingDraft] = useState("");
  const [customerType, setCustomerType] = useState<"B2B" | "B2C" | "BOTH" | undefined>(a.customerType);
  const [customers, setCustomers] = useState(a.customers ?? "");
  const [markets, setMarkets] = useState(a.markets ?? "");
  const [tone, setTone] = useState<string[]>(a.tone ?? []);
  const [colors, setColors] = useState<string[]>(a.colors?.length ? a.colors : initial.signals?.themeColor ? [initial.signals.themeColor] : ["#17161c"]);
  const [goals, setGoals] = useState<string[]>(a.goals ?? []);

  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [step]);

  const go = (fn: () => Promise<{ ok: boolean; error?: string }>, next: number) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "unexpected");
      setStep(next);
    });

  const toggle = (list: string[], v: string, set: (x: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const run = useRun(step === 8 ? runId : null);
  useEffect(() => {
    if (run?.status === "COMPLETED") {
      const id = setTimeout(() => router.push("/onboarding/ready"), 900);
      return () => clearTimeout(id);
    }
  }, [run?.status, router]);

  if (step === 8) {
    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-canvas px-5" data-theme="dark">
        <div className="absolute inset-0 ai-aura" aria-hidden />
        <motion.div className="absolute size-[560px] rounded-full border border-white/5" animate={{ rotate: 360 }} transition={{ duration: 40, repeat: Infinity, ease: "linear" }} aria-hidden />
        <motion.div className="absolute size-[380px] rounded-full border border-accent/20" animate={{ scale: [1, 1.04, 1] }} transition={{ duration: 4, repeat: Infinity }} aria-hidden />
        <div className="relative w-full max-w-md space-y-10 text-center">
          <motion.div className="mx-auto flex size-20 items-center justify-center rounded-[28px] bg-accent text-white shadow-[0_0_80px_var(--accent-glow)]" animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 2.4, repeat: Infinity }}>
            <Sparkles className="size-9" />
          </motion.div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">{run?.status === "COMPLETED" ? t("analysis.done") : t("analysis.title")}</h1>
            <p className="text-ink-3">{t("analysis.subtitle")}</p>
          </div>
          <div className="text-start">
            <RunSteps run={run} />
          </div>
          {run?.status === "FAILED" && (
            <div className="space-y-3">
              <p className="text-sm text-danger">{te((run.error ?? "ai_failed") as "ai_failed")}</p>
              <Button variant="secondary" onClick={() => go(async () => {
                const r = await startOnboardingAnalysis();
                if (r.ok) setRunId(r.data.runId);
                return r;
              }, 8)}>
                {tc("actions.retry")}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const progress = Math.min(100, (step / STEPS) * 100);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line/70 bg-canvas/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between gap-4 px-5">
          <Logo />
          <div className="hidden flex-1 px-6 sm:block">
            <Progress value={progress} label={t("progress")} />
          </div>
          <LocaleSwitch compact />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-10 px-5 pb-40 pt-10">
        <Bubble>
          <p className="text-2xl font-semibold tracking-tight">{t("welcome.title", { name: userName.split(" ")[0] })}</p>
          <p className="text-ink-3">{t("welcome.body")}</p>
          {step === 0 && (
            <Button className="mt-3" size="lg" onClick={() => setStep(1)} iconEnd={<ArrowRight className="size-4 flip-rtl" />}>
              {t("welcome.cta")}
            </Button>
          )}
        </Bubble>

        {step >= 1 && (
          <Bubble>
            <p className="text-xl font-semibold tracking-tight">{t("company.q")}</p>
            {step === 1 ? (
              <form className="flex gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); go(() => saveCompanyName(company, Intl.DateTimeFormat().resolvedOptions().timeZone), 2); }}>
                <Input autoFocus value={company} onChange={(e) => setCompany(e.target.value)} placeholder={t("company.placeholder")} maxLength={120} aria-label={t("company.q")} />
                <Button type="submit" loading={pending} disabled={!company.trim()}>{tc("actions.continue")}</Button>
              </form>
            ) : (
              <Answer onEdit={() => setStep(1)}>{company}</Answer>
            )}
          </Bubble>
        )}

        {step >= 2 && (
          <Bubble>
            <p className="text-xl font-semibold tracking-tight">{t("website.q")}</p>
            <p className="text-sm text-ink-3">{t("website.hint")}</p>
            {step === 2 ? (
              <form className="space-y-3 pt-2" onSubmit={(e) => { e.preventDefault(); go(() => saveWebsite(website || null), 3); }}>
                <div className="relative">
                  <Globe className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
                  <Input autoFocus dir="ltr" className="ps-10" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="yourcompany.com" inputMode="url" aria-label={t("website.q")} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" loading={pending} disabled={!website.trim()}>{t("website.cta")}</Button>
                  <Button type="button" variant="ghost" onClick={() => go(() => saveWebsite(null), 3)}>{t("website.none")}</Button>
                </div>
              </form>
            ) : (
              <Answer onEdit={() => setStep(2)}>{website || t("website.none")}</Answer>
            )}
          </Bubble>
        )}

        {step >= 3 && (
          <Bubble>
            <p className="text-xl font-semibold tracking-tight">{t("sells.q")}</p>
            {step === 3 ? (
              <div className="space-y-3 pt-2">
                <Textarea autoFocus value={sells} onChange={(e) => setSells(e.target.value)} placeholder={t("sells.placeholder")} rows={2} aria-label={t("sells.q")} />
                <div className="flex flex-wrap gap-2">
                  {offerings.map((o) => (
                    <span key={o} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-sunken ps-3 pe-1.5 text-sm">
                      {o}
                      <button type="button" onClick={() => setOfferings(offerings.filter((x) => x !== o))} className="rounded-full p-0.5 hover:bg-line" aria-label={`${tc("actions.remove")} ${o}`}>
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (offeringDraft.trim()) { setOfferings([...offerings, offeringDraft.trim()].slice(0, 12)); setOfferingDraft(""); } }}>
                  <Input value={offeringDraft} onChange={(e) => setOfferingDraft(e.target.value)} placeholder={t("sells.offeringPlaceholder")} aria-label={t("sells.offeringPlaceholder")} />
                  <Button type="submit" variant="secondary" icon={<Plus className="size-4" />}>{tc("actions.add")}</Button>
                </form>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("sells.descriptionPlaceholder")} rows={3} aria-label={t("sells.descriptionPlaceholder")} />
                <Button loading={pending} disabled={!sells.trim()} onClick={() => go(() => saveAnswers({ sells, offerings, description, step: 4 }), 4)}>{tc("actions.continue")}</Button>
              </div>
            ) : (
              <Answer onEdit={() => setStep(3)}>{[sells, offerings.join(" · ")].filter(Boolean).join(" — ")}</Answer>
            )}
          </Bubble>
        )}

        {step >= 4 && (
          <Bubble>
            <p className="text-xl font-semibold tracking-tight">{t("customers.q")}</p>
            {step === 4 ? (
              <div className="space-y-3 pt-2">
                <div className="flex flex-wrap gap-2">
                  {(["B2B", "B2C", "BOTH"] as const).map((k) => (
                    <Chip key={k} active={customerType === k} onClick={() => setCustomerType(k)}>{t(`customers.types.${k}`)}</Chip>
                  ))}
                </div>
                <Textarea value={customers} onChange={(e) => setCustomers(e.target.value)} placeholder={t("customers.placeholder")} rows={2} aria-label={t("customers.q")} />
                <Input value={markets} onChange={(e) => setMarkets(e.target.value)} placeholder={t("customers.markets")} aria-label={t("customers.markets")} />
                <Button loading={pending} disabled={!customers.trim() && !customerType} onClick={() => go(() => saveAnswers({ customers, customerType, markets, step: 5 }), 5)}>{tc("actions.continue")}</Button>
              </div>
            ) : (
              <Answer onEdit={() => setStep(4)}>{[customerType && t(`customers.types.${customerType}`), customers].filter(Boolean).join(" — ")}</Answer>
            )}
          </Bubble>
        )}

        {step >= 5 && (
          <Bubble>
            <p className="text-xl font-semibold tracking-tight">{t("connect.q")}</p>
            <p className="text-sm text-ink-3">{t("connect.hint")}</p>
            {step === 5 ? (
              <div className="space-y-3 pt-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  {providers.map((p) => (
                    <div key={p.provider} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
                      <span className="text-sm font-medium">{tc(`platforms.${p.provider}` as "platforms.INSTAGRAM")}</span>
                      {p.configured ? (
                        <a href={`/api/integrations/${p.oauth}/connect?return=/onboarding`} className="text-sm font-semibold text-accent-ink hover:underline">{tc("actions.connect")}</a>
                      ) : (
                        <span className="text-xs text-ink-4">{t("connect.unavailable")}</span>
                      )}
                    </div>
                  ))}
                </div>
                <Button loading={pending} onClick={() => go(() => saveAnswers({ step: 6 }), 6)}>{t("connect.later")}</Button>
              </div>
            ) : (
              <Answer onEdit={() => setStep(5)}>{t("connect.done")}</Answer>
            )}
          </Bubble>
        )}

        {step >= 6 && (
          <Bubble>
            <p className="text-xl font-semibold tracking-tight">{t("brand.q")}</p>
            {step === 6 ? (
              <div className="space-y-4 pt-2">
                <div className="flex flex-wrap gap-2">
                  {TONES.map((k) => (
                    <Chip key={k} active={tone.includes(t(`brand.tones.${k}`))} onClick={() => toggle(tone, t(`brand.tones.${k}`), setTone)}>{t(`brand.tones.${k}`)}</Chip>
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-ink-2">{t("brand.colors")}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {colors.map((c, i) => (
                      <label key={i} className="relative size-11 cursor-pointer overflow-hidden rounded-xl border border-line shadow-xs" style={{ background: c }}>
                        <input type="color" value={c.length === 7 ? c : "#17161c"} onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value : x)))} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`${t("brand.colors")} ${i + 1}`} />
                      </label>
                    ))}
                    {colors.length < 4 && (
                      <button type="button" onClick={() => setColors([...colors, "#ef5a2a"])} className="flex size-11 items-center justify-center rounded-xl border border-dashed border-line-strong text-ink-3 hover:text-ink" aria-label={tc("actions.add")}>
                        <Plus className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
                <Button loading={pending} disabled={tone.length === 0} onClick={() => go(() => saveAnswers({ tone, colors, step: 7 }), 7)}>{tc("actions.continue")}</Button>
              </div>
            ) : (
              <Answer onEdit={() => setStep(6)}>{tone.join(" · ")}</Answer>
            )}
          </Bubble>
        )}

        {step >= 7 && (
          <Bubble>
            <p className="text-xl font-semibold tracking-tight">{t("goals.q")}</p>
            <div className="flex flex-wrap gap-2 pt-2">
              {GOALS.map((k) => (
                <Chip key={k} active={goals.includes(t(`goals.options.${k}`))} onClick={() => toggle(goals, t(`goals.options.${k}`), setGoals)}>{t(`goals.options.${k}`)}</Chip>
              ))}
            </div>
            <Button
              className="mt-4"
              size="lg"
              loading={pending}
              disabled={goals.length === 0}
              icon={<Sparkles className="size-4" />}
              onClick={() =>
                go(async () => {
                  const saved = await saveAnswers({ goals, step: 8 });
                  if (!saved.ok) return saved;
                  const r = await startOnboardingAnalysis();
                  if (r.ok) setRunId(r.data.runId);
                  return r;
                }, 8)
              }
            >
              {t("goals.cta")}
            </Button>
          </Bubble>
        )}

        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
              {te(error as "unexpected")}
            </motion.p>
          )}
        </AnimatePresence>
        <div ref={bottom} />
      </main>
    </div>
  );
}

function Answer({ children, onEdit }: { children: ReactNode; onEdit: () => void }) {
  const tc = useTranslations("common.actions");
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="rounded-2xl rounded-ss-md bg-surface px-4 py-2.5 text-[15px] shadow-xs ring-1 ring-line">{children}</span>
      <button type="button" onClick={onEdit} className="text-xs font-medium text-ink-4 hover:text-ink">{tc("edit")}</button>
    </div>
  );
}
