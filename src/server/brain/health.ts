import { tenantDb, type TenantScope } from "../db/tenant";

/**
 * Brain health & the questions engine — deterministic completeness rules over structured data.
 * No numeric "score": each area is Ready / Needs info / Outdated / Empty with the concrete reasons.
 */

export const STALE_DAYS = { sources: 90, competitors: 180, answers: 180 } as const;
const DAY = 86_400_000;

export type AreaKey = "profile" | "products" | "customers" | "sales" | "content" | "faqs" | "strategy" | "competitors";
export type AreaStatus = "ready" | "needs_info" | "outdated" | "empty";
export type Area = { key: AreaKey; status: AreaStatus; count: number; missing: string[] };
export type Overall = "complete" | "ready" | "needs_info" | "weak";

export async function loadBrainState(scope: TenantScope) {
  const t = tenantDb(scope);
  const staleSources = new Date(Date.now() - STALE_DAYS.sources * DAY);
  const staleCompetitors = new Date(Date.now() - STALE_DAYS.competitors * DAY);
  const [profile, brand, sales, offerings, offeringsThin, faqs, faqsPending, objections, segments, segmentsSuggested, icps, strategies, strategyDrafts, competitors, competitorsStale, sources, sourcesStale, sourcesFailed, documents, websitePages, customers, facts, factsPending, answers, lastSource] = await Promise.all([
    t.companyProfile.findFirst(),
    t.brandKit.findFirst(),
    t.salesKnowledge.findFirst(),
    t.offering.count({ where: { isActive: true } }),
    t.offering.count({ where: { isActive: true, OR: [{ description: null }, { targetCustomer: null }, { benefits: { isEmpty: true } }] } }),
    t.brainFaq.count({ where: { status: "approved" } }),
    t.brainFaq.count({ where: { status: "pending" } }),
    t.brainObjection.count({ where: { status: "approved" } }),
    t.customerSegment.count({ where: { status: "approved" } }),
    t.customerSegment.count({ where: { status: "suggested" } }),
    t.idealCustomerProfile.count(),
    t.strategy.count({ where: { status: "APPROVED" } }),
    t.strategy.count({ where: { status: { in: ["DRAFT", "REVIEW"] } } }),
    t.competitor.count(),
    t.competitor.count({ where: { OR: [{ lastVerifiedAt: { lt: staleCompetitors } }, { lastVerifiedAt: null, updatedAt: { lt: staleCompetitors } }] } }),
    t.knowledgeSource.count({ where: { pausedAt: null } }),
    t.knowledgeSource.count({ where: { pausedAt: null, OR: [{ lastSyncedAt: { lt: staleSources } }, { lastSyncedAt: null, createdAt: { lt: staleSources } }] } }),
    t.knowledgeSource.count({ where: { status: "FAILED" } }),
    t.knowledgeDocument.count({ where: { source: { type: { not: "WEBSITE" } } } }),
    t.knowledgeDocument.count({ where: { source: { type: "WEBSITE" } } }),
    t.lead.count(),
    t.brainFact.count({ where: { status: "approved" } }),
    t.brainFact.count({ where: { status: "pending" } }),
    t.brainFact.findMany({ where: { category: "question" }, select: { key: true, value: true, status: true, updatedAt: true } }),
    t.knowledgeSource.findFirst({ where: { lastSyncedAt: { not: null } }, orderBy: { lastSyncedAt: "desc" }, select: { lastSyncedAt: true } }),
  ]);
  return {
    profile,
    brand,
    sales,
    counts: { offerings, offeringsThin, faqs, faqsPending, objections, segments, segmentsSuggested, icps, strategies, strategyDrafts, competitors, competitorsStale, sources, sourcesStale, sourcesFailed, documents, websitePages, customers, facts, factsPending },
    answers,
    lastRefresh: lastSource?.lastSyncedAt ?? null,
  };
}
export type BrainState = Awaited<ReturnType<typeof loadBrainState>>;

const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim().length > 0 : v != null);

export function brainHealth(s: BrainState): { areas: Area[]; overall: Overall; missing: { area: AreaKey; key: string }[] } {
  const p = s.profile;
  const c = s.counts;
  const area = (key: AreaKey, count: number, missing: string[], empty: boolean, outdated = false): Area => ({ key, count, missing, status: empty ? "empty" : outdated ? "outdated" : missing.length ? "needs_info" : "ready" });

  const profileMissing = [
    !filled(p?.industry) && "industry",
    !filled(p?.description) && !filled(p?.summary) && "description",
    !filled(p?.markets) && !filled(p?.countries) && "market",
    !filled(p?.valueProps) && !filled(p?.whyChooseUs) && "value_proposition",
    !filled(p?.differentiators) && "differentiators",
  ].filter(Boolean) as string[];
  const salesMissing = [
    !filled(s.sales?.qualificationQuestions) && "qualification_questions",
    !filled(s.sales?.pricingRules) && "pricing_rules",
    !filled(s.sales?.discountRules) && "discount_rules",
    !c.objections && "objections",
  ].filter(Boolean) as string[];
  const contentMissing = [
    !filled(s.brand?.tone) && "tone",
    !filled(p?.contentPillars) && "pillars",
    !filled(s.brand?.forbiddenClaims) && !filled(s.brand?.dontSay) && "forbidden_claims",
    !filled(s.brand?.ctaStyle) && "cta_style",
  ].filter(Boolean) as string[];
  const customersMissing = [!c.segments && "segments", !c.icps && "icp", !c.customers && "customer_data"].filter(Boolean) as string[];
  const strategyMissing = [!c.strategies && (c.strategyDrafts ? "strategy_needs_approval" : "no_strategy")].filter(Boolean) as string[];

  const areas: Area[] = [
    area("profile", 5 - profileMissing.length, profileMissing, !p || profileMissing.length >= 5),
    area("products", c.offerings, c.offeringsThin ? ["product_details"] : [], c.offerings === 0),
    area("customers", c.segments + c.icps, customersMissing, customersMissing.length === 3),
    area("sales", c.objections, salesMissing, salesMissing.length === 4),
    area("content", 4 - contentMissing.length, contentMissing, contentMissing.length === 4),
    area("faqs", c.faqs, c.faqs < 3 ? ["more_faqs"] : [], c.faqs === 0),
    area("strategy", c.strategies, strategyMissing, !c.strategies && !c.strategyDrafts),
    area("competitors", c.competitors, [], c.competitors === 0, c.competitorsStale > 0),
  ];
  const empty = areas.filter((a) => a.status === "empty").length;
  const core = areas.filter((a) => ["profile", "products", "content"].includes(a.key)).every((a) => a.status === "ready");
  const overall: Overall = areas.every((a) => a.status === "ready") ? "complete" : empty >= 4 ? "weak" : core ? "ready" : "needs_info";
  return { areas, overall, missing: areas.flatMap((a) => a.missing.map((key) => ({ area: a.key, key }))) };
}

// ── Questions engine ──

export type QuestionGroup = "business" | "customers" | "sales" | "marketing" | "content" | "operations";
type Question = { key: string; group: QuestionGroup; strategy?: boolean; answeredBy?: (s: BrainState) => boolean };

/** Asked only when the answer isn't already in the structured brain. */
export const QUESTIONS: Question[] = [
  { key: "goal_90d", group: "business", strategy: true, answeredBy: (s) => filled(s.profile?.primaryGoal) },
  { key: "focus_product", group: "business", strategy: true },
  { key: "biggest_challenge", group: "business", strategy: true },
  { key: "business_model", group: "business", answeredBy: (s) => filled(s.profile?.businessModel) },
  { key: "best_customer", group: "customers", strategy: true, answeredBy: (s) => s.counts.icps > 0 },
  { key: "customer_value", group: "customers", strategy: true },
  { key: "why_choose_us", group: "customers", answeredBy: (s) => filled(s.profile?.whyChooseUs) || filled(s.profile?.valueProps) },
  { key: "close_process", group: "sales", strategy: true, answeredBy: (s) => filled(s.sales?.playbook) },
  { key: "sales_cycle", group: "sales" },
  { key: "discount_policy", group: "sales", answeredBy: (s) => filled(s.sales?.discountRules) },
  { key: "marketing_budget", group: "marketing", strategy: true },
  { key: "current_channels", group: "marketing", strategy: true },
  { key: "competitors", group: "marketing", answeredBy: (s) => s.counts.competitors > 0 },
  { key: "content_goal", group: "content" },
  { key: "tone", group: "content", answeredBy: (s) => filled(s.brand?.tone) },
  { key: "team_capacity", group: "operations" },
  { key: "delivery_time", group: "operations" },
];

export type QuestionState = { key: string; group: QuestionGroup; status: "answered" | "missing" | "needs_review"; value?: string | null; strategy: boolean };

export function questionStates(s: BrainState, answers: { key: string; value: string; status: string; updatedAt: Date }[]): QuestionState[] {
  const stale = Date.now() - STALE_DAYS.answers * DAY;
  return QUESTIONS.map((q) => {
    const a = answers.find((x) => x.key === `q.${q.key}`);
    const structured = q.answeredBy?.(s) ?? false;
    const status: QuestionState["status"] = a ? (a.status === "pending" || a.updatedAt.getTime() < stale ? "needs_review" : "answered") : structured ? "answered" : "missing";
    return { key: q.key, group: q.group, status, value: a?.value ?? null, strategy: Boolean(q.strategy) };
  });
}

/** The next question NOVA should ask: strategy-critical gaps first, then by group order. */
export function nextQuestion(states: QuestionState[]) {
  return states.find((q) => q.status === "missing" && q.strategy) ?? states.find((q) => q.status === "missing") ?? states.find((q) => q.status === "needs_review") ?? null;
}
