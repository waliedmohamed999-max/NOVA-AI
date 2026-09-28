import type { KnowledgeSourceType } from "@/generated/prisma/enums";
import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { aiEmbed } from "../ai";
import { redact } from "../security/redact";
import { LOCKED_SALES_TOPICS } from "../approvals/policies";
import { similarity } from "../studio/context";

/**
 * Company Brain retrieval for the Command Center and the agents — selective by purpose, bounded by a
 * token budget, tenant-scoped. It never returns the whole brain: each purpose reads only the sections it
 * needs, and knowledge chunks are keyword-first (semantic search only when asked for and needed).
 * Nothing from integrations, credentials or CRM records ever enters this context.
 */

export type BrainPurpose = "sales" | "content" | "support" | "facts" | "brief" | "analytics";
export type BrainSection =
  | "company" | "services" | "products" | "audience" | "valueProps" | "pricing" | "brandVoice" | "contentPillars" | "forbidden" | "salesRules" | "knowledge"
  // Company Intelligence entities (structured, approved only)
  | "facts" | "faqs" | "objections" | "icp" | "segments" | "strategy" | "competitors";
export type SourceKind = "profile" | "offering" | "brand" | "policy" | "website" | "document" | "manual" | "faq" | "pricing" | "case_study" | "fact" | "sales" | "strategy" | "customers";
export type Budget = "small" | "medium" | "large";

/** Context-token ceilings and top-K per budget. Default is small. */
export const TOKEN_BUDGETS: Record<Budget, number> = { small: 1000, medium: 3000, large: 6000 };
export const TOP_K: Record<Budget, number> = { small: 3, medium: 5, large: 8 };

export const PURPOSE_SECTIONS: Record<BrainPurpose, BrainSection[]> = {
  sales: ["facts", "company", "services", "products", "audience", "icp", "segments", "pricing", "salesRules", "objections", "strategy", "knowledge"],
  content: ["facts", "company", "brandVoice", "services", "products", "audience", "icp", "segments", "contentPillars", "forbidden", "strategy", "competitors", "knowledge"],
  support: ["facts", "company", "services", "products", "faqs", "knowledge"],
  facts: ["company", "services", "products", "audience", "valueProps", "pricing", "brandVoice", "contentPillars"],
  // Daily brief: priorities come from the brief's own data; the brain adds only a short summary + approved strategy.
  brief: ["company", "strategy"],
  // Analytics: approved strategy and only the products relevant to what is being analysed.
  analytics: ["company", "strategy", "services", "products"],
};

/** Fact categories each purpose may read (approved facts only). */
const PURPOSE_FACTS: Record<BrainPurpose, string[]> = {
  sales: ["pricing", "discount", "policy", "proof", "positioning", "catalog", "reputation", "strategy", "question"],
  content: ["positioning", "proof", "customer_language", "catalog", "reputation", "strategy"],
  support: ["policy", "pricing", "catalog", "general"],
  facts: [],
  brief: [],
  analytics: ["positioning"],
};

/** Knowledge types each purpose may read (metadata filter on the chunk search). */
const PURPOSE_KNOWLEDGE: Record<BrainPurpose, KnowledgeSourceType[]> = {
  sales: ["PRICING", "POLICY", "SERVICE", "PRODUCT", "FAQ", "CASE_STUDY"],
  content: ["SERVICE", "PRODUCT", "CASE_STUDY", "WEBSITE", "MANUAL", "DOCUMENT"],
  support: ["FAQ", "POLICY", "PRODUCT", "SERVICE", "PRICING", "WEBSITE", "DOCUMENT", "MANUAL"],
  facts: ["FAQ", "POLICY", "PRODUCT", "SERVICE", "PRICING", "WEBSITE", "DOCUMENT", "MANUAL", "CASE_STUDY"],
  brief: [],
  analytics: [],
};

/** Which approved strategies each purpose reads. */
const PURPOSE_STRATEGY: Record<BrainPurpose, string[]> = {
  sales: ["sales", "business"],
  content: ["content", "marketing"],
  support: [],
  facts: [],
  brief: ["business", "marketing"],
  analytics: ["marketing", "content"],
};

/** Offerings relevant to a text (name/category/description terms) — never the whole catalogue when a filter is asked for. */
export function relevantOfferings<T extends { name: string; category?: string | null; description?: string | null }>(rows: T[], relevantTo: string): T[] {
  const text = relevantTo.toLowerCase();
  return rows.filter((o) => text.includes(o.name.toLowerCase()) || termCoverage(`${o.name} ${o.category ?? ""}`, relevantTo) > 0 || termCoverage(relevantTo, `${o.name} ${o.category ?? ""} ${o.description ?? ""}`) >= 0.34);
}

export type BrainItem = { name: string; detail?: string | null; price?: string | null; source: SourceKind };
export type BrainChunk = { text: string; title: string; source: SourceKind; score: number };

export type CompanyContext = {
  company: { name: string; industry: string | null; summary: string | null; website: string | null } | null;
  facts: { text: string; source: SourceKind }[];
  services: BrainItem[];
  products: BrainItem[];
  audience: string[];
  valueProps: string[];
  pricing: string[];
  brandRules: string[];
  contentRules: string[];
  salesRules: string[];
  pillars: string[];
  /** Structured layer (read before any chunk): approved facts and entities. */
  approvedFacts: string[];
  faqs: string[];
  /** The best matching approved FAQ for the query (structured answer, no generation needed). */
  faqMatch: { question: string; answer: string; coverage: number } | null;
  /** The best matching approved fact for the query. */
  factMatch: { key: string; value: string; coverage: number } | null;
  objections: string[];
  icps: string[];
  segments: string[];
  strategies: string[];
  competitorThemes: string[];
  chunks: BrainChunk[];
  sources: { kind: SourceKind; count: number }[];
  /** How well the brain answers `query` (only meaningful when a query was given). */
  confidence: "high" | "medium" | "low";
  contextTokens: number;
  retrievedItems: number;
  brainVersion: string;
  semantic: boolean;
};

// ── Brain version: a fingerprint of everything the brain is made of ──

/**
 * Changes whenever the profile, brand kit, offerings, approval policies or knowledge sources/chunks
 * change (edits, additions, deletions, re-ingestion). Used as the cache key, so no explicit invalidation.
 */
export async function brainVersion(scope: TenantScope): Promise<string> {
  const o = scope.organizationId;
  const w = scope.workspaceId;
  const [row] = await db.$queryRaw<{ v: string }[]>`
    SELECT md5(concat_ws('|',
      (SELECT max("updatedAt")::text FROM "company_profiles" WHERE "organizationId" = ${o} AND "workspaceId" = ${w}),
      (SELECT max("updatedAt")::text FROM "brand_kits" WHERE "organizationId" = ${o} AND "workspaceId" = ${w}),
      (SELECT count(*)::text || ':' || coalesce(max("updatedAt")::text, '') FROM "offerings" WHERE "organizationId" = ${o} AND "workspaceId" = ${w}),
      (SELECT count(*)::text || ':' || coalesce(max("updatedAt")::text, '') FROM "approval_policies" WHERE "organizationId" = ${o} AND "workspaceId" = ${w}),
      (SELECT count(*)::text || ':' || coalesce(max(greatest("updatedAt", coalesce("lastSyncedAt", "updatedAt")))::text, '') FROM "knowledge_sources" WHERE "organizationId" = ${o} AND "workspaceId" = ${w}),
      (SELECT count(*)::text FROM "knowledge_chunks" WHERE "organizationId" = ${o} AND "workspaceId" = ${w})
    )) AS v`;
  return row.v;
}

// ── Token estimate & text hygiene ──

/** Conservative estimate: ~4 chars/token for Latin text, ~2.5 for Arabic and other scripts. */
export function estimateTokens(text: string) {
  let latin = 0;
  let other = 0;
  for (const ch of text) if (ch.charCodeAt(0) < 0x0250) latin++;
  else other++;
  return Math.ceil(latin / 4 + other / 2.5);
}

const BOILERPLATE = [
  /(all rights reserved|copyright|©|جميع الحقوق محفوظة)/i,
  /(cookie|cookies|privacy policy|terms (of|and) (use|service)|سياسة الخصوصية|الشروط والأحكام)/i,
  /^(home|about|contact|services|blog|menu|login|sign in|register|الرئيسية|من نحن|اتصل بنا|خدماتنا|تسجيل الدخول)(\s*[|•·/]\s*[^|•·/]{1,30}){1,8}$/i, // a bar of links (a lone "Services" heading is content, not navigation)
  /(follow us|subscribe|newsletter|تابعنا|اشترك)/i,
];

/** Drops navigation/footer/cookie lines and very short fragments; keeps real sentences. */
export function stripBoilerplate(text: string, minLength = 25) {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= minLength && !BOILERPLATE.some((re) => re.test(l)))
    .join("\n")
    .trim();
}

/** Removes near-duplicate chunks and merges overlapping neighbours from the same document. */
export function dedupeChunks<T extends { text: string; score: number; documentId?: string; index?: number }>(chunks: T[]): T[] {
  const sorted = [...chunks].sort((a, b) => (a.documentId ?? "").localeCompare(b.documentId ?? "") || (a.index ?? 0) - (b.index ?? 0));
  const merged: T[] = [];
  for (const c of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && prev.documentId && prev.documentId === c.documentId && c.index === (prev.index ?? -2) + 1) {
      // chunkText() overlaps neighbours by ~60 tokens: join on the longest shared boundary.
      let cut = 0;
      for (let n = Math.min(600, prev.text.length, c.text.length); n >= 20; n--) {
        if (prev.text.endsWith(c.text.slice(0, n))) {
          cut = n;
          break;
        }
      }
      prev.text = `${prev.text}${cut ? "" : "\n"}${c.text.slice(cut)}`;
      prev.score = Math.max(prev.score, c.score);
      prev.index = c.index;
      continue;
    }
    merged.push({ ...c });
  }
  const out: T[] = [];
  for (const c of merged.sort((a, b) => b.score - a.score)) if (!out.some((o) => similarity(o.text, c.text) > 0.8)) out.push(c);
  return out;
}

// ── Chunk search: tenant-scoped, type-filtered, keyword first ──

const SOURCE_OF: Record<string, SourceKind> = { WEBSITE: "website", DOCUMENT: "document", MANUAL: "manual", FAQ: "faq", PRODUCT: "document", SERVICE: "document", PRICING: "pricing", POLICY: "policy", CASE_STUDY: "case_study" };

type ChunkRow = { id: string; content: string; documentId: string; index: number; title: string | null; type: string; score: number };

// Function words carry no meaning for matching (they'd only dilute coverage / widen the keyword search).
const STOPWORDS = new Set(
  (
    "the and for are you your our with what which who how does did can will this that from have has was were about into they them there here when where why " +
    "هل ما ماذا ايه ايش اي مين كيف ازاي ليه لماذا متى فين اين كم هو هي هم انت انتم عندكم عندنا لديكم لدينا في من على الى عن مع التي الذي اللي هذا هذه ذلك تلك او ثم كل بعض"
  ).split(" "),
);

function queryTerms(q: string) {
  return [...new Set(q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)))].slice(0, 10);
}

export async function searchBrainChunks(scope: TenantScope, query: string, opts: { types: KnowledgeSourceType[]; k: number; semantic?: boolean }) {
  const q = query.trim().slice(0, 500);
  const k = Math.max(1, Math.min(8, opts.k));
  if (!q) return { rows: [] as ChunkRow[], semantic: false };
  const terms = queryTerms(q);
  const rows = new Map<string, ChunkRow>();
  if (terms.length) {
    // Any-term full-text match, ranked; restricted to this tenant and to the purpose's knowledge types.
    const tsq = terms.map((t) => t.replace(/[':&|!()]/g, "")).filter(Boolean).join(" | ");
    const kw = await db.$queryRaw<ChunkRow[]>`
      SELECT c."id", c."content", c."documentId", c."index", c."metadata"->>'title' AS "title", s."type"::text AS "type",
             ts_rank(to_tsvector('simple', c."content"), to_tsquery('simple', ${tsq})) AS "score"
      FROM "knowledge_chunks" c JOIN "knowledge_sources" s ON s."id" = c."sourceId"
      WHERE c."organizationId" = ${scope.organizationId} AND c."workspaceId" = ${scope.workspaceId}
        AND s."organizationId" = ${scope.organizationId} AND s."pausedAt" IS NULL AND s."type"::text = ANY(${opts.types as string[]})
        AND to_tsvector('simple', c."content") @@ to_tsquery('simple', ${tsq})
      ORDER BY "score" DESC LIMIT ${k}`.catch(() => [] as ChunkRow[]);
    for (const r of kw) rows.set(r.id, r);
  }
  let semantic = false;
  // Semantic search costs an embedding call: only when explicitly allowed and keyword recall is poor.
  if (opts.semantic && rows.size < 2) {
    const has = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "knowledge_chunks" WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} AND "embedding" IS NOT NULL`;
    if (has[0]?.n) {
      const e = await aiEmbed({ organizationId: scope.organizationId, workspaceId: scope.workspaceId }, [q]).catch(() => null);
      if (e) {
        semantic = true;
        const vector = `[${e.vectors[0].join(",")}]`;
        const vs = await db.$queryRaw<ChunkRow[]>`
          SELECT c."id", c."content", c."documentId", c."index", c."metadata"->>'title' AS "title", s."type"::text AS "type",
                 1 - (c."embedding" <=> ${vector}::vector) AS "score"
          FROM "knowledge_chunks" c JOIN "knowledge_sources" s ON s."id" = c."sourceId"
          WHERE c."organizationId" = ${scope.organizationId} AND c."workspaceId" = ${scope.workspaceId} AND c."embedding" IS NOT NULL
            AND s."pausedAt" IS NULL AND s."type"::text = ANY(${opts.types as string[]})
          ORDER BY c."embedding" <=> ${vector}::vector LIMIT ${k}`;
        for (const r of vs) if (!rows.has(r.id)) rows.set(r.id, r);
      }
    }
  }
  return { rows: [...rows.values()].sort((a, b) => Number(b.score) - Number(a.score)).slice(0, k), semantic };
}

/** Share of the query's meaningful terms that appear in `text` (0–1). */
export function termCoverage(query: string, text: string) {
  const terms = queryTerms(query);
  if (!terms.length) return 0;
  const t = text.toLowerCase();
  return terms.filter((w) => t.includes(w)).length / terms.length;
}

// ── The service ──

export type RetrieveOptions = {
  purpose: BrainPurpose;
  query?: string;
  /** Narrow the sections further (e.g. a brain question about services only). */
  sections?: BrainSection[];
  budget?: Budget;
  /** Allow an embedding call when keyword search finds too little. Never for brain-only answers. */
  semantic?: boolean;
  /** Only offerings relevant to this text (sales: the customer's interests; content: the post; analytics: the metric subject). */
  relevantTo?: string;
  /** Hard context ceiling for a use case (overrides the budget's token limit, never raises it above "large"). */
  maxTokens?: number;
  /** Override top-K (clamped to 1–8). */
  topK?: number;
};

export async function retrieveCompanyContext(scope: TenantScope, opts: RetrieveOptions): Promise<CompanyContext> {
  const budget = opts.budget ?? "small";
  const sections = new Set(opts.sections ?? PURPOSE_SECTIONS[opts.purpose]);
  const where = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const needProfile = ["company", "audience", "valueProps", "contentPillars"].some((s) => sections.has(s as BrainSection));
  const needBrand = sections.has("brandVoice") || sections.has("forbidden");
  const needOfferings = sections.has("services") || sections.has("products") || sections.has("pricing");

  const [version, org, profile, brand, offerings, policies] = await Promise.all([
    brainVersion(scope),
    db.organization.findUniqueOrThrow({ where: { id: scope.organizationId }, select: { name: true } }),
    needProfile ? db.companyProfile.findFirst({ where, select: { name: true, industry: true, summary: true, description: true, website: true, audience: true, valueProps: true, differentiators: true, contentPillars: true } }) : null,
    needBrand ? db.brandKit.findFirst({ where, select: { tone: true, voiceTraits: true, doSay: true, dontSay: true, forbiddenStyles: true, forbiddenClaims: true, ctaStyle: true, hashtagRules: true, topics: true, seasonalThemes: true } }) : null,
    needOfferings ? db.offering.findMany({ where: { ...where, isActive: true }, orderBy: { createdAt: "asc" }, take: 20, select: { type: true, name: true, description: true, priceText: true, targetCustomer: true, category: true } }) : [],
    sections.has("salesRules") ? db.approvalPolicy.findMany({ where, select: { action: true, requiresApproval: true } }) : [],
  ]);
  // 1. Structured layer — approved only (pending/critical-unapproved/rejected are never used by agents).
  const factCats = PURPOSE_FACTS[opts.purpose];
  const [factRows, faqRows, objectionRows, icpRows, segmentRows, strategyRows, competitorRows, salesK] = await Promise.all([
    sections.has("facts") && factCats.length ? db.brainFact.findMany({ where: { ...where, status: "approved", category: { in: factCats } }, orderBy: { updatedAt: "desc" }, take: 25, select: { key: true, value: true } }) : [],
    sections.has("faqs") ? db.brainFaq.findMany({ where: { ...where, status: "approved" }, orderBy: { updatedAt: "desc" }, take: 60, select: { question: true, answer: true } }) : [],
    sections.has("objections") ? db.brainObjection.findMany({ where: { ...where, status: "approved" }, take: 8, select: { objection: true, response: true } }) : [],
    sections.has("icp") ? db.idealCustomerProfile.findMany({ where: { ...where, status: "approved" }, take: 3 }) : [],
    sections.has("segments") ? db.customerSegment.findMany({ where: { ...where, status: "approved" }, take: 6, select: { name: true, definition: true, size: true } }) : [],
    sections.has("strategy") ? db.strategy.findMany({ where: { ...where, status: "APPROVED", type: { in: PURPOSE_STRATEGY[opts.purpose].length ? PURPOSE_STRATEGY[opts.purpose] : ["business"] } }, orderBy: { approvedAt: "desc" }, take: 2 }) : [],
    sections.has("competitors") ? db.competitor.findMany({ where, take: 5, select: { name: true, contentThemes: true } }) : [],
    sections.has("salesRules") ? db.salesKnowledge.findFirst({ where }) : null,
  ]);
  // FAQs: the few that match the question (structured answers beat chunks), else the latest.
  const rankedFaqs = opts.query ? faqRows.map((f) => ({ ...f, c: termCoverage(opts.query!, `${f.question} ${f.answer}`) })).filter((f) => f.c > 0).sort((a, b) => b.c - a.c) : faqRows.map((f) => ({ ...f, c: 0 }));

  const pool = opts.relevantTo !== undefined ? relevantOfferings(offerings, opts.relevantTo) : offerings;
  const item = (o: { name: string; description: string | null; priceText: string | null }): BrainItem => ({ name: o.name, detail: o.description?.slice(0, 160) ?? null, price: o.priceText, source: "offering" });
  const services = sections.has("services") ? pool.filter((o) => o.type === "SERVICE").map(item) : [];
  const products = sections.has("products") ? pool.filter((o) => o.type === "PRODUCT").map(item) : [];
  const audience = sections.has("audience") && Array.isArray(profile?.audience) ? (profile!.audience as { name?: string; description?: string }[]).map((a) => [a.name, a.description].filter(Boolean).join(" — ")).filter(Boolean) : [];
  const valueProps = sections.has("valueProps") ? [...(profile?.valueProps ?? []), ...(profile?.differentiators ?? [])] : [];
  const pricing = sections.has("pricing") ? pool.filter((o) => o.priceText).map((o) => `${o.name}: ${o.priceText}`) : [];
  const brandRules = sections.has("brandVoice") && brand ? [brand.tone && `Tone: ${brand.tone}`, brand.voiceTraits.length && `Voice: ${brand.voiceTraits.join(", ")}`, brand.doSay.length && `Always: ${brand.doSay.join("; ")}`].filter(Boolean) as string[] : [];
  const contentRules = sections.has("forbidden")
    ? [
        ...(brand?.forbiddenClaims.length ? [`Forbidden claims: ${brand.forbiddenClaims.join("; ")}`] : []),
        ...(brand?.dontSay.length ? [`Never say: ${brand.dontSay.join("; ")}`] : []),
        ...(brand?.forbiddenStyles.length ? [`Forbidden visual styles: ${brand.forbiddenStyles.join(", ")}`] : []),
        ...(brand?.ctaStyle ? [`CTA style: ${brand.ctaStyle}`] : []),
        ...(brand?.hashtagRules.length ? [`Hashtags: ${brand.hashtagRules.join("; ")}`] : []),
        "No invented statistics, testimonials, prices or offers that are not listed here.",
      ]
    : [];
  const salesRules = sections.has("salesRules")
    ? [
        `Always needs human approval: ${[...new Set([...LOCKED_SALES_TOPICS, ...policies.filter((p) => p.requiresApproval).map((p) => p.action)])].join(", ")}.`,
        "Only quote prices listed here; never promise discounts, refunds, contract terms or delivery dates.",
        ...(salesK?.pricingRules.length ? [`Pricing rules: ${salesK.pricingRules.join("; ")}`] : []),
        ...(salesK?.discountRules.length ? [`Discount rules: ${salesK.discountRules.join("; ")}`] : []),
        ...(salesK?.proposalRules.length ? [`Proposal rules: ${salesK.proposalRules.join("; ")}`] : []),
        ...(salesK?.redFlags.length ? [`Red flags: ${salesK.redFlags.join("; ")}`] : []),
        ...(salesK?.escalationRules.length ? [`Escalate when: ${salesK.escalationRules.join("; ")}`] : []),
      ]
    : [];
  const pillars = sections.has("contentPillars") ? [...(profile?.contentPillars ?? []), ...(brand?.topics ?? []).map((x) => `topic: ${x}`), ...(brand?.seasonalThemes ?? []).map((x) => `seasonal: ${x}`)] : [];
  let summary = (profile?.summary ?? profile?.description)?.slice(0, 400) ?? null;
  if (sections.has("company") && !summary) {
    // Summary-first: the compact summary saved at ingestion, before any chunk-level retrieval.
    const src = await db.knowledgeSource.findFirst({ where: { ...where, status: "READY" }, orderBy: { lastSyncedAt: "desc" }, select: { metadata: true } });
    summary = ((src?.metadata as { summary?: string } | null)?.summary ?? "").slice(0, 400) || null;
  }
  const company = sections.has("company") ? { name: profile?.name || org.name, industry: profile?.industry ?? null, summary, website: profile?.website ?? null } : null;

  // 4. Knowledge chunks — last, only for purposes that read them, only with a query, and not when a
  //    structured FAQ already answers it.
  let chunks: BrainChunk[] = [];
  let semantic = false;
  // A structured answer (approved FAQ or approved fact) makes the vector/keyword chunk search unnecessary.
  const rankedFacts = opts.query ? factRows.map((f) => ({ ...f, c: termCoverage(opts.query!, `${f.key.replace(/[._:-]/g, " ")} ${f.value}`) })).sort((a, b) => b.c - a.c) : [];
  const factMatch = rankedFacts[0] && rankedFacts[0].c >= 0.6 ? { key: rankedFacts[0].key, value: rankedFacts[0].value, coverage: rankedFacts[0].c } : null;
  const faqAnswers = (rankedFaqs[0] && rankedFaqs[0].c >= 0.6) || Boolean(factMatch);
  if (sections.has("knowledge") && opts.query && !faqAnswers) {
    const res = await searchBrainChunks(scope, opts.query, { types: PURPOSE_KNOWLEDGE[opts.purpose], k: opts.topK ?? TOP_K[budget], semantic: opts.semantic });
    semantic = res.semantic;
    chunks = dedupeChunks(res.rows.map((r) => ({ text: redact(stripBoilerplate(r.content), 4000) ?? "", score: Number(r.score), documentId: r.documentId, index: r.index, title: r.title ?? "", type: r.type })))
      .filter((c) => c.text.length > 0)
      .map((c) => ({ text: c.text, title: c.title, source: SOURCE_OF[c.type] ?? "document", score: c.score }));
  }

  const ctx: CompanyContext = {
    company,
    facts: [],
    services,
    products,
    audience,
    valueProps,
    pricing,
    brandRules,
    contentRules,
    salesRules,
    pillars,
    approvedFacts: factRows.map((f) => `${f.key}: ${f.value}`),
    factMatch,
    faqs: rankedFaqs.slice(0, opts.query ? 3 : 5).map((f) => `Q: ${f.question}\nA: ${f.answer}`),
    faqMatch: rankedFaqs[0] ? { question: rankedFaqs[0].question, answer: rankedFaqs[0].answer, coverage: rankedFaqs[0].c } : null,
    objections: objectionRows.map((o) => `${o.objection} → ${o.response}`),
    icps: icpRows.map((i) => [i.name, i.industry, i.location, i.companySize, i.painPoints.length && `pains: ${i.painPoints.join(", ")}`, i.buyingTriggers.length && `triggers: ${i.buyingTriggers.join(", ")}`].filter(Boolean).join(" · ")),
    segments: segmentRows.map((s) => `${s.name}${s.size != null ? ` (${s.size})` : ""}${s.definition ? ` — ${s.definition}` : ""}`),
    strategies: strategyRows.map((s) => [s.title, s.objective, s.positioning && `positioning: ${s.positioning}`, s.channels.length && `channels: ${s.channels.join(", ")}`].filter(Boolean).join(" · ")),
    competitorThemes: competitorRows.filter((c) => c.contentThemes.length).map((c) => `${c.name}: ${c.contentThemes.join(", ")}`),
    chunks,
    sources: [],
    confidence: "low",
    contextTokens: 0,
    retrievedItems: 0,
    brainVersion: version,
    semantic,
  };
  fitBudget(ctx, Math.min(TOKEN_BUDGETS.large, opts.maxTokens ?? TOKEN_BUDGETS[budget]));

  const kinds = new Map<SourceKind, number>();
  const add = (k: SourceKind, n = 1) => n > 0 && kinds.set(k, (kinds.get(k) ?? 0) + n);
  if (ctx.company?.summary || ctx.audience.length || ctx.valueProps.length || ctx.pillars.length) add("profile");
  add("offering", ctx.services.length + ctx.products.length ? 1 : 0);
  add("brand", ctx.brandRules.length || brand?.dontSay.length ? 1 : 0);
  add("policy", ctx.salesRules.length ? 1 : 0);
  add("fact", ctx.approvedFacts.length ? 1 : 0);
  add("faq", ctx.faqs.length ? 1 : 0);
  add("sales", ctx.objections.length ? 1 : 0);
  add("customers", ctx.icps.length + ctx.segments.length ? 1 : 0);
  add("strategy", ctx.strategies.length ? 1 : 0);
  for (const c of ctx.chunks) add(c.source);
  ctx.sources = [...kinds].map(([kind, count]) => ({ kind, count }));
  ctx.retrievedItems = ctx.services.length + ctx.products.length + ctx.audience.length + ctx.valueProps.length + ctx.pricing.length + ctx.approvedFacts.length + ctx.faqs.length + ctx.objections.length + ctx.icps.length + ctx.segments.length + ctx.strategies.length + ctx.chunks.length;
  ctx.facts = [...ctx.chunks.map((c) => ({ text: c.text, source: c.source }))];
  if (opts.query) {
    const best = Math.max(0, ctx.faqMatch?.coverage ?? 0, ...ctx.chunks.map((c) => termCoverage(opts.query!, c.text)));
    ctx.confidence = best >= 0.6 ? "high" : best >= 0.3 ? "medium" : "low";
  }
  ctx.contextTokens = estimateTokens(compactContext(ctx));
  return ctx;
}

/** Trims the context until its compact form fits the budget: lowest-score chunks first, then long lists. */
export function fitBudget(ctx: CompanyContext, maxTokens: number) {
  const size = () => estimateTokens(compactContext(ctx));
  while (size() > maxTokens && ctx.chunks.length) ctx.chunks.pop();
  for (const list of ["competitorThemes", "strategies", "segments", "objections", "faqs", "pricing", "audience", "valueProps", "approvedFacts", "products", "services", "pillars"] as const) {
    while (size() > maxTokens && ctx[list].length > 3) (ctx[list] as unknown[]).pop();
  }
  if (size() > maxTokens && ctx.company?.summary) ctx.company.summary = ctx.company.summary.slice(0, 160);
  return ctx;
}

/** Compact, structured prompt form — never raw JSON or whole pages. */
export function compactContext(ctx: CompanyContext): string {
  const list = (title: string, items: string[]) => (items.length ? `${title}:\n${items.map((x) => `- ${x}`).join("\n")}` : null);
  const offering = (o: BrainItem) => [o.name, o.price && `(${o.price})`, o.detail && `— ${o.detail}`].filter(Boolean).join(" ");
  // Order = trust/structure: approved facts → entities → summaries → chunks.
  return [
    list("Facts", ctx.approvedFacts),
    ctx.company && `Company: ${ctx.company.name}${ctx.company.industry ? ` (${ctx.company.industry})` : ""}`,
    ctx.company?.summary && `About: ${ctx.company.summary}`,
    list("Services", ctx.services.map(offering)),
    list("Products", ctx.products.map(offering)),
    list("Audience", ctx.audience),
    list("Strengths", ctx.valueProps),
    list("Prices", ctx.pricing),
    list("Brand voice", ctx.brandRules),
    list("Content pillars", ctx.pillars),
    list("Content rules", ctx.contentRules),
    list("Sales rules", ctx.salesRules),
    list("Ideal customers", ctx.icps),
    list("Customer segments", ctx.segments),
    list("Objections and approved responses", ctx.objections),
    list("Approved strategy", ctx.strategies),
    list("Competitor content themes", ctx.competitorThemes),
    ctx.faqs.length ? `Approved FAQs:\n${ctx.faqs.join("\n")}` : null,
    ctx.chunks.length ? `Knowledge:\n${ctx.chunks.map((c, i) => `[${i + 1}] ${c.title ? `${c.title}: ` : ""}${c.text}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Audit metadata for an AI call made with this context (stored on ai_runs). */
export function brainMeta(ctx: CompanyContext) {
  return { contextTokens: ctx.contextTokens, retrievedItems: ctx.retrievedItems, sourceTypes: ctx.sources.map((x) => x.kind), brainVersion: ctx.brainVersion };
}
