"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale } from "next-intl";
import { SETUP_STEPS, setupProgress, stepReady, WEBSITE_RE, type Lang, type SetupAnswers, type SetupStep } from "@/lib/onboarding-setup";
import type { StrategyPreview, WebsiteFindings } from "@/server/onboarding/setup";
import {
  analyzeWebsiteAction,
  applyWebsiteAction,
  buildStrategyAction,
  saveAudienceAction,
  saveBrandAction,
  saveBusinessAction,
  saveGoalsAction,
  setStepAction,
  websiteFindingsAction,
} from "../actions";

/**
 * Setup state: one source of truth for the answers. Every change updates the UI immediately and is
 * queued for the server (debounced per section, saves run one at a time so the stored answers never
 * race). The server writes each save straight into the Company Brain.
 */

export type Section = "business" | "audience" | "brand" | "goals";
export type SaveState = "idle" | "saving" | "saved" | "error";
type Patch = Record<string, unknown>;

export type SiteState =
  | { phase: "idle" }
  | { phase: "running"; importId: string; findings: WebsiteFindings | null }
  | { phase: "review"; importId: string; findings: WebsiteFindings }
  | { phase: "applied"; importId: string; findings: WebsiteFindings | null }
  | { phase: "failed"; importId: string | null; error: string };

export type SetupInit = {
  userName: string;
  hasOrg: boolean;
  companyName: string;
  answers: SetupAnswers;
  logoUrl: string | null;
  strategy: StrategyPreview | null;
  websiteImport: { id: string; status: string } | null;
  websiteSource: string | null;
  brandPrefilled: boolean;
  aiConfigured: boolean;
  channels: {
    instagram: boolean;
    facebook: boolean;
    linkedin: boolean;
    email: boolean;
    whatsapp: { connected: boolean; display: string | null };
    whatsappGoals: string[];
    signup: import("@/features/whatsapp/connect-button").SignupConfig;
  };
};

function applyPatch(a: SetupAnswers, section: Section, p: Patch): SetupAnswers {
  if (section === "business") {
    const { companyName: _n, ...rest } = p;
    void _n;
    return { ...a, ...(rest as SetupAnswers) };
  }
  if (section === "audience") {
    const { customers, ...rest } = p;
    return { ...a, ...(customers !== undefined ? { customers: customers as string } : {}), audience: { ...a.audience, ...(rest as SetupAnswers["audience"]) } };
  }
  if (section === "brand") {
    const { colors, ...rest } = p;
    return { ...a, ...(colors ? { colors: colors as string[] } : {}), brand: { ...a.brand, ...(rest as SetupAnswers["brand"]) } };
  }
  const { goals, ...rest } = p;
  return { ...a, ...(goals ? { goalKeys: goals as SetupAnswers["goalKeys"] } : {}), ...(rest as SetupAnswers) };
}

const SAVERS: Record<Section, (p: Patch) => Promise<{ ok: boolean; error?: string }>> = {
  business: (p) => saveBusinessAction(p, Intl.DateTimeFormat().resolvedOptions().timeZone),
  audience: (p) => saveAudienceAction(p),
  brand: (p) => saveBrandAction(p),
  goals: (p) => saveGoalsAction(p),
};

function useSetupState(init: SetupInit) {
  const lang = (useLocale() === "ar" ? "ar" : "en") as Lang;
  const [answers, setAnswers] = useState<SetupAnswers>(init.answers);
  const [companyName, setCompanyName] = useState(init.companyName);
  const [hasOrg, setHasOrg] = useState(init.hasOrg);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [brainUpdated, setBrainUpdated] = useState(false);
  const firstIncomplete = SETUP_STEPS.find((s) => !(init.answers.setup?.completed ?? []).includes(s)) ?? "review";
  const [step, setStepState] = useState<SetupStep>(init.answers.setup?.currentStep ?? (init.hasOrg ? firstIncomplete : "business"));
  const [strategy, setStrategy] = useState<StrategyPreview | null>(init.strategy);

  const pending = useRef<Partial<Record<Section, Patch>>>({});
  const timers = useRef<Partial<Record<Section, ReturnType<typeof setTimeout>>>>({});
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const orgRef = useRef(init.hasOrg);
  const nameRef = useRef(init.companyName);

  const run = useCallback((section: Section) => {
    chain.current = chain.current.then(async () => {
      const patch = pending.current[section];
      if (!patch || !Object.keys(patch).length) {
        setSaveState((st) => (st === "saving" && !Object.keys(pending.current).length ? "saved" : st));
        return true;
      }
      // Nothing can be stored before the company exists — its name creates it.
      if ((section === "business" && !orgRef.current && !nameRef.current.trim()) || (section !== "business" && !orgRef.current)) {
        setSaveState("idle"); // held until the company exists
        return true;
      }
      delete pending.current[section];
      const body = section === "business" && !orgRef.current ? { ...patch, companyName: nameRef.current } : patch;
      setSaveState("saving");
      const res = await SAVERS[section](body);
      if (!res.ok) {
        pending.current[section] = { ...body, ...pending.current[section] };
        setSaveState("error");
        setSaveError(res.error ?? "unexpected");
        return false;
      }
      if (section === "business" && !orgRef.current) {
        orgRef.current = true;
        setHasOrg(true);
      }
      setSaveState("saved");
      setSaveError(null);
      setBrainUpdated(true);
      return true;
    });
    return chain.current;
  }, []);

  const flush = useCallback(async () => {
    for (const s of Object.keys(timers.current) as Section[]) clearTimeout(timers.current[s]);
    timers.current = {};
    // Business first: it may be the save that creates the organization.
    let ok = true;
    for (const s of ["business", "audience", "brand", "goals"] as Section[]) ok = (await run(s)) && ok;
    return ok;
  }, [run]);

  const update = useCallback(
    (section: Section, patch: Patch, opts: { immediate?: boolean } = {}) => {
      if (section === "business" && typeof patch.companyName === "string") {
        nameRef.current = patch.companyName;
        setCompanyName(patch.companyName);
      }
      setAnswers((a) => applyPatch(a, section, patch));
      pending.current[section] = { ...pending.current[section], ...patch };
      // Unsaved changes are never shown as "Saved".
      setSaveState("saving");
      clearTimeout(timers.current[section]);
      if (opts.immediate) void run(section);
      else timers.current[section] = setTimeout(() => void run(section), 700);
    },
    [run],
  );

  // Leaving a field saves right away (no waiting for the debounce); so does hiding the page.
  useEffect(() => {
    const onHide = () => void flush();
    const onLeaveField = () => {
      if (Object.keys(pending.current).length) void flush();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("focusout", onLeaveField);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("focusout", onLeaveField);
    };
  }, [flush]);

  const goTo = useCallback(
    async (next: SetupStep, completed?: SetupStep) => {
      const ok = await flush();
      if (!ok) return false;
      setStepState(next);
      setAnswers((a) => ({ ...a, setup: { ...a.setup, currentStep: next, completed: completed ? SETUP_STEPS.filter((s) => s === completed || a.setup?.completed?.includes(s)) : a.setup?.completed } }));
      if (orgRef.current) void setStepAction(next, completed);
      return true;
    },
    [flush],
  );

  // ── Website analysis ──
  const initialSite = (): SiteState => {
    const imp = init.websiteImport;
    if (!imp) return { phase: "idle" };
    if (imp.status === "FAILED") return { phase: "idle" };
    if (imp.status === "IMPORTED") return { phase: "applied", importId: imp.id, findings: null };
    return { phase: "running", importId: imp.id, findings: null };
  };
  const [site, setSite] = useState<SiteState>(initialSite);

  useEffect(() => {
    if (site.phase !== "running" || !site.importId) return;
    let alive = true;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const res = await websiteFindingsAction(site.importId);
      if (!alive) return;
      if (res.ok) {
        const f = res.data;
        if (f.status === "REVIEW") return setSite({ phase: "review", importId: site.importId, findings: f });
        if (f.status === "IMPORTED") return setSite({ phase: "applied", importId: site.importId, findings: f });
        if (f.status === "FAILED") return setSite({ phase: "failed", importId: site.importId, error: f.error ?? "website_unreachable" });
        setSite({ phase: "running", importId: site.importId, findings: f });
      }
      if (Date.now() - started > 90_000) return setSite({ phase: "failed", importId: site.importId, error: "website_unreachable" });
      timer = setTimeout(tick, 1200);
    };
    timer = setTimeout(tick, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // Poll per import (the findings object itself changes every tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.phase, site.phase !== "idle" && site.phase !== "failed" ? site.importId : null]);

  const analyze = useCallback(async (raw?: string) => {
    const url = (raw ?? answers.website ?? "").trim();
    if (!WEBSITE_RE.test(url)) return setSite({ phase: "failed", importId: null, error: "invalid" });
    await flush();
    setSite({ phase: "running", importId: "", findings: null });
    const res = await analyzeWebsiteAction(url);
    if (!res.ok) return setSite({ phase: "failed", importId: null, error: res.error ?? "website_unreachable" });
    orgRef.current = true;
    setHasOrg(true);
    setSite({ phase: "running", importId: res.data.importId, findings: null });
  }, [answers.website, flush]);

  const applySite = useCallback(
    async (offeringIds: string[]) => {
      if (site.phase !== "review") return false;
      const res = await applyWebsiteAction(site.importId, offeringIds);
      if (!res.ok) {
        setSaveError(res.error ?? "unexpected");
        setSaveState("error");
        return false;
      }
      setAnswers((a) => ({ ...a, offerings: res.data.offerings }));
      setSite({ phase: "applied", importId: site.importId, findings: site.findings });
      setBrainUpdated(true);
      return true;
    },
    [site],
  );

  const buildStrategy = useCallback(async () => {
    const ok = await flush();
    if (!ok) return { ok: false, error: "unexpected" };
    const res = await buildStrategyAction();
    if (res.ok) setStrategy(res.data);
    return res;
  }, [flush]);

  const progress = useMemo(() => setupProgress(answers, companyName), [answers, companyName]);

  return {
    lang,
    userName: init.userName,
    aiConfigured: init.aiConfigured,
    logoUrl: init.logoUrl,
    websiteSource: init.websiteSource,
    brandPrefilled: init.brandPrefilled,
    channels: init.channels,
    answers,
    companyName,
    hasOrg,
    step,
    progress,
    saveState,
    saveError,
    brainUpdated,
    site,
    strategy,
    update,
    flush,
    retry: flush,
    goTo,
    analyze,
    applySite,
    resetSite: () => setSite({ phase: "idle" }),
    buildStrategy,
    ready: (s: SetupStep) => stepReady(s, answers, companyName),
  };
}

export type Setup = ReturnType<typeof useSetupState>;
const Ctx = createContext<Setup | null>(null);

export function SetupProvider({ init, children }: { init: SetupInit; children: ReactNode }) {
  const value = useSetupState(init);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSetup() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSetup outside SetupProvider");
  return v;
}
