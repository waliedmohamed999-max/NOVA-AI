import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { UserFacingError } from "../errors";
import { logger } from "../logger";
import { normalizeUrl } from "../net/safe-fetch";
import { aiAvailability, aiStructured } from "../ai";
import { saveUpload, signedFileUrl, detectType } from "../storage";
import { addKnowledgeSource } from "../knowledge/service";
import { deleteEntity, recordRevision, saveContentKnowledge, saveEntity, saveProfile, upsertFact } from "../brain/core";
import { draftStrategy, saveAnswer } from "../brain/strategy";
import { applyImport, createUrlImport } from "../brain/imports";
import type { Candidate } from "../brain/extract";
import { beginAnalysis, mergeAnswers } from "./service";
import {
  BUDGETS,
  BUSINESS_TYPES,
  CHANNEL_LABELS,
  COMPANY_SIZES,
  CONTENT_STYLES,
  CTA_STYLES,
  CUSTOMER_TYPES,
  GOALS,
  INDUSTRIES,
  SETUP_STEPS,
  TONES,
  VISUAL_STYLES,
  audienceSchema,
  brandSchema,
  businessSchema,
  countryName,
  goalsSchema,
  label,
  suggestCustomerType,
  suggestIndustry,
  type Lang,
  type SetupAnswers,
  type SetupStep,
} from "@/lib/onboarding-setup";

/**
 * Guided setup → Company Brain, live. Every section is written to the structured brain the moment it is
 * saved (profile, ICP, brand kit, offerings, facts, strategy draft) — nothing waits for the end of the
 * setup. Everything is the owner's own input (source "manual"); website findings go through the import
 * review and critical ones (pricing / policy) stay pending until approved. No AI call is needed anywhere;
 * AI is used only for the optional audience suggestion and the strategy draft when a provider exists.
 */

type Actor = { userId: string | null };

async function scopeFor(organizationId: string): Promise<TenantScope> {
  const ws = await db.workspace.findFirstOrThrow({ where: { organizationId, isDefault: true } });
  return { organizationId, workspaceId: ws.id };
}

async function orgLang(organizationId: string): Promise<Lang> {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { locale: true } });
  return org.locale === "ar" ? "ar" : "en";
}

async function answersOf(organizationId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return { org, answers: (org.onboardingData ?? {}) as SetupAnswers };
}

async function touch(organizationId: string, patch: Partial<SetupAnswers>) {
  const { answers } = await answersOf(organizationId);
  return mergeAnswers(organizationId, { ...patch, setup: { ...answers.setup, ...(patch.setup ?? {}), updatedAt: new Date().toISOString() } });
}

const fact = (scope: TenantScope, actor: Actor, key: string, value: string | null | undefined, category = "profile") =>
  value?.trim() ? upsertFact(scope, { key, value, category, sourceKind: "manual" }, actor) : Promise.resolve(null);

// ── Step 1: business ──

export async function saveBusiness(organizationId: string, actor: Actor, input: z.input<typeof businessSchema>) {
  const p = businessSchema.parse(input);
  const scope = await scopeFor(organizationId);
  const lang = await orgLang(organizationId);
  const { answers } = await answersOf(organizationId);
  const t = tenantDb(scope);
  const profile: Record<string, unknown> = {};

  if (p.companyName !== undefined) {
    await db.organization.update({ where: { id: organizationId }, data: { name: p.companyName } });
    profile.name = p.companyName;
    await fact(scope, actor, "company.name", p.companyName);
  }
  if (p.website !== undefined) {
    let url: string | null = null;
    if (p.website) {
      try {
        url = normalizeUrl(p.website).toString();
      } catch {
        throw new UserFacingError("website_unreachable");
      }
    }
    await db.organization.update({ where: { id: organizationId }, data: { website: url } });
    profile.website = url;
  }
  if (p.industry !== undefined) {
    await db.organization.update({ where: { id: organizationId }, data: { industry: p.industry || null } });
    profile.industry = p.industry;
  }
  if (p.description !== undefined) profile.description = p.description;
  if (p.country !== undefined) profile.countries = p.country ? [countryName(p.country, lang)] : [];
  if (p.markets !== undefined) profile.markets = p.markets ? [p.markets] : [];
  const businessType = p.businessType ?? answers.businessType;
  const customerType = p.customerType ?? answers.customerType;
  if (p.businessType !== undefined || p.customerType !== undefined) {
    profile.businessModel = [businessType && label(BUSINESS_TYPES[businessType], lang), customerType && label(CUSTOMER_TYPES[customerType], lang)].filter(Boolean).join(" · ");
    if (p.businessType) await fact(scope, actor, "business.type", label(BUSINESS_TYPES[p.businessType], lang));
    if (p.customerType) await fact(scope, actor, "audience.customer_type", label(CUSTOMER_TYPES[p.customerType], lang), "audience");
  }
  if (Object.keys(profile).length) await saveProfile(scope, profile, actor);

  // Offerings: add what's new, remove only what this setup added and the owner removed (by name).
  if (p.offerings) {
    const existing = await t.offering.findMany({ select: { id: true, name: true, sourceKind: true } });
    const have = new Map(existing.map((o) => [o.name.trim().toLowerCase(), o]));
    const type = businessType === "PRODUCTS" ? "PRODUCT" : "SERVICE";
    for (const name of p.offerings) if (!have.has(name.toLowerCase())) await saveEntity(scope, "offering", { data: { name, type, status: "active" } }, actor);
    const keep = new Set(p.offerings.map((n) => n.toLowerCase()));
    for (const prev of answers.offerings ?? []) {
      const row = have.get(prev.toLowerCase());
      if (row && !keep.has(prev.toLowerCase()) && row.sourceKind === "manual") await deleteEntity(scope, "offering", row.id, actor);
    }
  }
  if (customerType && p.customerType !== undefined) await syncIcp(organizationId, scope, actor, lang, { customerType });

  const sells = businessType ? label(BUSINESS_TYPES[businessType], lang) : answers.sells;
  await touch(organizationId, {
    ...(p.website !== undefined ? { website: profile.website as string | null } : {}),
    ...(p.noWebsite !== undefined ? { noWebsite: p.noWebsite } : {}),
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.offerings ? { offerings: p.offerings } : {}),
    ...(p.industry !== undefined ? { industry: p.industry } : {}),
    ...(p.businessType ? { businessType: p.businessType, sells } : {}),
    ...(p.country !== undefined ? { country: p.country ?? undefined } : {}),
    ...(p.markets !== undefined ? { markets: p.markets } : {}),
    ...(p.customerType ? { customerType: p.customerType } : {}),
  });
  return { saved: true as const };
}

// ── Step 2: audience → profile audience + one ideal customer profile (never duplicated) ──

async function syncIcp(organizationId: string, scope: TenantScope, actor: Actor, lang: Lang, a: SetupAnswers & { customerType?: SetupAnswers["customerType"] }) {
  const { answers } = await answersOf(organizationId);
  const merged = { ...answers.audience, ...a.audience };
  const customerType = a.customerType ?? answers.customerType;
  const data: Record<string, unknown> = {
    kind: customerType === "B2C" ? "B2C" : "B2B",
    name: lang === "ar" ? "العميل المثالي" : "Ideal customer",
    industry: merged.industries?.join(", ") || null,
    companySize: merged.companySize ? label(COMPANY_SIZES[merged.companySize], lang) : null,
    location: merged.locations || answers.markets || null,
    budget: merged.budget ? label(BUDGETS[merged.budget], lang) : null,
    painPoints: merged.painPoints ?? [],
    buyingTriggers: merged.buyingTriggers ?? [],
    decisionMaker: merged.decisionMaker || null,
  };
  const id = answers.setup?.icpId;
  const exists = id ? await tenantDb(scope).idealCustomerProfile.findUnique({ where: { id } }) : null;
  if (exists) await saveEntity(scope, "icp", { id: exists.id, data }, actor);
  else {
    const row = await saveEntity(scope, "icp", { data }, actor);
    await touch(organizationId, { setup: { icpId: String(row.id) } });
  }
}

export async function saveAudience(organizationId: string, actor: Actor, input: z.input<typeof audienceSchema>) {
  const p = audienceSchema.parse(input);
  const scope = await scopeFor(organizationId);
  const lang = await orgLang(organizationId);
  const { answers } = await answersOf(organizationId);
  const { customers, ...rest } = p;
  const audience = { ...answers.audience, ...rest };

  if (customers !== undefined) {
    const t = tenantDb(scope);
    const profile = await t.companyProfile.findFirst({ select: { audience: true } });
    const others = ((profile?.audience ?? []) as { name: string; source?: string }[]).filter((x) => x.source !== "owner");
    const primary = customers ? [{ name: lang === "ar" ? "العملاء الأساسيون" : "Core customers", description: customers, pains: audience.painPoints ?? [], motivations: audience.buyingTriggers ?? [], source: "owner" }] : [];
    await saveProfileAudience(scope, [...primary, ...others].slice(0, 5));
    // The strategy engine reads this answer.
    if (customers) await saveAnswer(scope, "best_customer", customers, actor);
  }
  if (rest.ageMin !== undefined || rest.ageMax !== undefined) {
    const range = audience.ageMin != null && audience.ageMax != null ? `${audience.ageMin}–${audience.ageMax}` : null;
    if (range) await fact(scope, actor, "audience.age_range", range, "audience");
  }
  await touch(organizationId, { ...(customers !== undefined ? { customers } : {}), audience });
  if (Object.keys(rest).length) await syncIcp(organizationId, scope, actor, lang, { audience: rest });
  return { saved: true as const };
}

async function saveProfileAudience(scope: TenantScope, audience: unknown[]) {
  const t = tenantDb(scope);
  const before = await t.companyProfile.findFirst();
  if (!before) return;
  await t.companyProfile.update({ where: { id: before.id }, data: { audience: audience as Prisma.InputJsonValue } });
  await recordRevision(scope, { entityType: "profile", entityId: before.id, action: "update", before: { audience: before.audience }, after: { audience }, sourceKind: "manual", actorId: null });
}

// ── Step 3: brand → brand kit ──

export async function saveBrand(organizationId: string, actor: Actor, input: z.input<typeof brandSchema>) {
  const p = brandSchema.parse(input);
  const scope = await scopeFor(organizationId);
  const lang = await orgLang(organizationId);
  const { answers } = await answersOf(organizationId);
  const content: Record<string, unknown> = {};
  let toneLabels: string[] | undefined;
  if (p.tones) {
    toneLabels = p.tones.map((k) => label(TONES[k], lang));
    content.tone = toneLabels.join(lang === "ar" ? "، " : ", ");
    content.voiceTraits = toneLabels;
  }
  if (p.visualStyle !== undefined) content.imageStyle = p.visualStyle ? label(VISUAL_STYLES[p.visualStyle], lang) : null;
  if (p.ctaStyle !== undefined) content.ctaStyle = p.ctaStyle ? label(CTA_STYLES[p.ctaStyle], lang) : null;
  if (Object.keys(content).length) await saveContentKnowledge(scope, content, actor);
  if (p.colors) await tenantDb(scope).brandKit.updateMany({ data: { primaryColors: p.colors } });
  if (p.contentStyles) await fact(scope, actor, "brand.content_style", p.contentStyles.map((k) => label(CONTENT_STYLES[k], lang)).join(", "), "brand");
  const brand = { ...answers.brand, ...(p.tones ? { tones: p.tones } : {}), ...(p.visualStyle !== undefined ? { visualStyle: p.visualStyle ?? undefined } : {}), ...(p.contentStyles ? { contentStyles: p.contentStyles } : {}), ...(p.ctaStyle !== undefined ? { ctaStyle: p.ctaStyle ?? undefined } : {}) };
  await touch(organizationId, { brand, ...(toneLabels ? { tone: toneLabels } : {}), ...(p.colors ? { colors: p.colors } : {}) });
  return { saved: true as const };
}

const LOGO_MAX = 2 * 1024 * 1024;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Logo → StorageProvider (never the database); the brand kit keeps only the file id. */
export async function saveLogo(organizationId: string, actor: Actor, file: File) {
  if (file.size > LOGO_MAX) throw new UserFacingError("file_too_large");
  const data = Buffer.from(await file.arrayBuffer());
  const type = detectType(data, file.name);
  if (!type || !LOGO_TYPES.has(type.mime)) throw new UserFacingError("file_type");
  const scope = await scopeFor(organizationId);
  const saved = await saveUpload({ organizationId, workspaceId: scope.workspaceId, userId: actor.userId, fileName: file.name, data, purpose: "brand_logo" });
  await tenantDb(scope).brandKit.updateMany({ data: { logoAssetId: saved.id } });
  const { answers } = await answersOf(organizationId);
  await touch(organizationId, { brand: { ...answers.brand, logoFileId: saved.id } });
  return { url: signedFileUrl(saved.id) };
}

// ── Step 4: goals ──

export async function saveGoals(organizationId: string, actor: Actor, input: z.input<typeof goalsSchema>) {
  const p = goalsSchema.parse(input);
  const scope = await scopeFor(organizationId);
  const lang = await orgLang(organizationId);
  let labels: string[] | undefined;
  if (p.goals) {
    labels = p.goals.map((k) => label(GOALS[k], lang));
    const t = tenantDb(scope);
    const prof = await t.companyProfile.findFirst();
    if (prof) {
      await t.companyProfile.update({ where: { id: prof.id }, data: { goals: labels, primaryGoal: labels[0] ?? null } });
      await recordRevision(scope, { entityType: "profile", entityId: prof.id, action: "update", before: { goals: prof.goals }, after: { goals: labels }, sourceKind: "manual", actorId: actor.userId });
    }
  }
  if (p.goal90) await saveAnswer(scope, "goal_90d", p.goal90, actor);
  if (p.channels?.length) await saveAnswer(scope, "current_channels", p.channels.map((c) => label(CHANNEL_LABELS[c], lang)).join(", "), actor);
  if (p.focusOffering) await saveAnswer(scope, "focus_product", p.focusOffering, actor);
  await touch(organizationId, {
    ...(p.goals ? { goalKeys: p.goals, goals: labels } : {}),
    ...(p.goal90 !== undefined ? { goal90: p.goal90 } : {}),
    ...(p.channels ? { channels: p.channels } : {}),
    ...(p.focusOffering !== undefined ? { focusOffering: p.focusOffering } : {}),
  });
  return { saved: true as const };
}

// ── Navigation / resume ──

export async function setStep(organizationId: string, current: SetupStep, completed?: SetupStep) {
  const { answers } = await answersOf(organizationId);
  const done = new Set(answers.setup?.completed ?? []);
  if (completed) done.add(completed);
  await touch(organizationId, { setup: { currentStep: current, completed: SETUP_STEPS.filter((s) => done.has(s)) } });
}

// ── Website analysis: the Company Brain import job (safe fetch → local extraction → review) ──

export async function analyzeWebsite(organizationId: string, actor: Actor, rawUrl: string) {
  await saveBusiness(organizationId, actor, { website: rawUrl, noWebsite: false });
  const scope = await scopeFor(organizationId);
  const { org } = await answersOf(organizationId);
  const imp = await createUrlImport(scope, actor, "website", org.website ?? rawUrl);
  await touch(organizationId, { setup: { importId: imp.id } });
  return { importId: imp.id };
}

export type WebsiteFindings = {
  status: string;
  error: string | null;
  title: string | null;
  description: string | null;
  pages: number;
  platform: string | null;
  offerings: { id: string; name: string; selected: boolean }[];
  critical: number;
  faqs: number;
  industry: string | null;
  customerType: string | null;
  imported: boolean;
};

export async function websiteFindings(organizationId: string, importId: string): Promise<WebsiteFindings> {
  const scope = await scopeFor(organizationId);
  const lang = await orgLang(organizationId);
  const imp = await tenantDb(scope).brainImport.findUnique({ where: { id: importId } });
  if (!imp) throw new UserFacingError("item_not_found");
  const preview = (imp.preview ?? {}) as { title?: string; description?: string | null; pages?: unknown[]; platform?: string };
  const candidates = ((imp.candidates ?? []) as unknown as Candidate[]) ?? [];
  const offerings = candidates.filter((c) => c.type === "offering").map((c) => ({ id: c.id, name: String(c.data.name ?? ""), selected: c.selected })).filter((o) => o.name);
  const text = [preview.title, preview.description, ...offerings.map((o) => o.name)].filter(Boolean).join(" \n ");
  const industry = text ? suggestIndustry(text) : null;
  return {
    status: imp.status,
    error: imp.error,
    title: preview.title ?? null,
    description: preview.description ?? null,
    pages: Array.isArray(preview.pages) ? preview.pages.length : 0,
    platform: preview.platform ?? null,
    offerings: offerings.slice(0, 12),
    critical: candidates.filter((c) => c.critical).length,
    faqs: candidates.filter((c) => c.type === "faq").length,
    industry: industry ? label(INDUSTRIES[industry], lang) : null,
    customerType: text ? suggestCustomerType(text) : null,
    imported: imp.status === "IMPORTED",
  };
}

/** The owner approves what was found. Non-critical items only are pre-selected; pricing/policy stay pending. */
export async function applyWebsite(organizationId: string, actor: Actor, importId: string, selectedOfferingIds: string[]) {
  const scope = await scopeFor(organizationId);
  const lang = await orgLang(organizationId);
  const imp = await tenantDb(scope).brainImport.findUnique({ where: { id: importId } });
  if (!imp) throw new UserFacingError("item_not_found");
  const candidates = (imp.candidates ?? []) as unknown as Candidate[];
  const chosen = candidates.filter((c) => (c.type === "offering" ? selectedOfferingIds.includes(c.id) : c.selected)).map((c) => c.id);
  const res = await applyImport(scope, actor, importId, { selectedIds: chosen, locale: lang });
  const names = (await tenantDb(scope).offering.findMany({ select: { name: true }, take: 12, orderBy: { createdAt: "asc" } })).map((o) => o.name);
  await touch(organizationId, { offerings: names });
  return { imported: res.imported ?? {}, offerings: names };
}

// ── Optional AI: audience suggestions (only when a provider is configured; the owner adds what they want) ──

const audienceSuggestion = z.object({ painPoints: z.array(z.string().max(160)).max(5), buyingTriggers: z.array(z.string().max(160)).max(5), decisionMaker: z.string().max(120) });

export async function suggestAudience(organizationId: string) {
  if (!aiAvailability().configured) throw new UserFacingError("ai_not_configured");
  const scope = await scopeFor(organizationId);
  const lang = await orgLang(organizationId);
  const { org, answers } = await answersOf(organizationId);
  // Only the owner's own short answers — no brain dump, no customer data.
  const prompt = [
    `Company: ${org.name}`,
    answers.industry && `Industry: ${answers.industry}`,
    answers.businessType && `Sells: ${label(BUSINESS_TYPES[answers.businessType], "en")}`,
    answers.offerings?.length && `Offerings: ${answers.offerings.slice(0, 8).join(", ")}`,
    answers.customerType && `Customer type: ${answers.customerType}`,
    answers.customers && `Customers (owner's words): ${answers.customers}`,
    answers.audience?.locations && `Locations: ${answers.audience.locations}`,
  ]
    .filter(Boolean)
    .join("\n");
  const res = await aiStructured(
    { organizationId, workspaceId: scope.workspaceId, agentKey: "SALES_AGENT" },
    {
      task: "ANALYSIS",
      schemaName: "audience_suggestion",
      schema: audienceSuggestion,
      maxTokens: 400,
      system: `Suggest likely customer pain points, buying triggers and the usual decision maker for this company, based only on what is given. Short phrases. Write in ${lang === "ar" ? "Arabic" : "English"}.`,
      prompt,
      offline: () => ({ painPoints: [], buyingTriggers: [], decisionMaker: "" }),
    },
  );
  return { ...res.data, generatedBy: res.offline ? "offline" : "ai" };
}

// ── Strategy preview: a DRAFT strategy in the brain — never approved automatically ──

export type StrategyPreview = { id: string; title: string; target: string | null; channels: string[]; positioning: string | null; objective: string | null; initiatives: string[]; kpis: string[]; generatedBy: string; status: string };

const toPreview = (s: { id: string; title: string; targetAudience: string | null; channels: string[]; positioning: string | null; objective: string | null; initiatives: string[]; kpis: string[]; generatedBy: string; status: string }): StrategyPreview => ({
  id: s.id,
  title: s.title,
  target: s.targetAudience,
  channels: s.channels,
  positioning: s.positioning,
  objective: s.objective,
  initiatives: s.initiatives,
  kpis: s.kpis,
  generatedBy: s.generatedBy,
  status: s.status,
});

export async function buildStrategyPreview(organizationId: string, actor: Actor) {
  const scope = await scopeFor(organizationId);
  const lang = await orgLang(organizationId);
  const { answers } = await answersOf(organizationId);
  const t = tenantDb(scope);
  // Regenerating replaces this setup's previous draft (drafts only — a reviewed/approved one is kept).
  const prev = answers.setup?.strategyId ? await t.strategy.findUnique({ where: { id: answers.setup.strategyId } }) : null;
  const s = await draftStrategy(scope, actor, { type: "marketing", locale: lang });
  if (prev && prev.status === "DRAFT") {
    await t.strategy.delete({ where: { id: prev.id } });
    await recordRevision(scope, { entityType: "strategy", entityId: prev.id, action: "delete", before: { title: prev.title, status: prev.status }, actorId: actor.userId });
  }
  await touch(organizationId, { setup: { strategyId: s.id } });
  return toPreview(s);
}

// ── Snapshot for the UI (only what the setup needs — never the whole brain) ──

export async function loadSetup(organizationId: string) {
  const scope = await scopeFor(organizationId);
  const t = tenantDb(scope);
  const { org, answers } = await answersOf(organizationId);
  const [kit, offerings, strategy, imp, site] = await Promise.all([
    t.brandKit.findFirst({ select: { logoAssetId: true, primaryColors: true, voiceTraits: true } }),
    t.offering.findMany({ select: { name: true }, take: 12, orderBy: { createdAt: "asc" } }),
    answers.setup?.strategyId ? t.strategy.findUnique({ where: { id: answers.setup.strategyId } }) : Promise.resolve(null),
    answers.setup?.importId ? t.brainImport.findUnique({ where: { id: answers.setup.importId }, select: { id: true, status: true } }) : Promise.resolve(null),
    t.knowledgeSource.findFirst({ where: { type: "WEBSITE" }, orderBy: { createdAt: "desc" }, select: { status: true } }),
  ]);
  // An existing brand kit pre-fills the brand step (its traits map back to the tone options when they match).
  const kitTones = (kit?.voiceTraits ?? []).map((v) => (Object.keys(TONES) as (keyof typeof TONES)[]).find((k) => TONES[k].en === v || TONES[k].ar === v)).filter((k): k is keyof typeof TONES => Boolean(k));
  const brandPrefilled = !answers.brand?.tones?.length && (kitTones.length > 0 || (!answers.colors?.length && Boolean(kit?.primaryColors.length)));
  return {
    companyName: org.name,
    status: org.onboardingStatus,
    brandPrefilled,
    answers: {
      ...answers,
      offerings: offerings.length ? offerings.map((o) => o.name) : (answers.offerings ?? []),
      colors: answers.colors?.length ? answers.colors : (kit?.primaryColors ?? []),
      brand: { ...answers.brand, tones: answers.brand?.tones?.length ? answers.brand.tones : kitTones },
    },
    logoUrl: kit?.logoAssetId ? signedFileUrl(kit.logoAssetId) : null,
    strategy: strategy ? toPreview(strategy) : null,
    websiteImport: imp,
    websiteSource: site?.status ?? null,
  };
}
export type SetupSnapshot = Awaited<ReturnType<typeof loadSetup>>;

// ── Finish: the website source (if not imported yet) + the team analysis run (works with or without AI) ──

export async function finishSetup(organizationId: string, actor: Actor & { userId: string }) {
  const scope = await scopeFor(organizationId);
  const { org, answers } = await answersOf(organizationId);
  if (!answers.businessType || !answers.customerType || !(answers.goalKeys?.length) || !(answers.brand?.tones?.length)) throw new UserFacingError("validation");
  if (org.website) {
    const t = tenantDb(scope);
    const site = await t.knowledgeSource.findFirst({ where: { type: "WEBSITE" } });
    if (!site) await addKnowledgeSource(scope, { type: "WEBSITE", title: new URL(org.website).hostname, url: org.website }).catch((err) => logger.warn({ err }, "website source not added"));
  }
  await setStep(organizationId, "review", "review");
  return { runId: await beginAnalysis(organizationId, actor.userId) };
}
