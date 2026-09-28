import type { TenantScope } from "../db/tenant";
import { retrieveCompanyContext } from "./company-context";

/**
 * One selective Company Brain context per AI use case — the only way agents get company context.
 * Each reads just its sections, with its own token ceiling. Nothing here loads CRM records, content
 * history or the full knowledge base: callers add only the task's own data (the lead, the post, the metrics).
 */

export const USE_CASE_BUDGETS = {
  brief: 300,
  analytics: 600,
  sales: 1000,
  content: 1000,
  support: 1000,
  onboarding: 3000,
} as const;

/** Daily brief: short company summary + approved business/marketing priorities. */
export const briefContext = (scope: TenantScope) => retrieveCompanyContext(scope, { purpose: "brief", maxTokens: USE_CASE_BUDGETS.brief });

/** Analytics: approved marketing/content strategy + only the products relevant to what is analysed. */
export const analyticsContext = (scope: TenantScope, relevantTo = "") => retrieveCompanyContext(scope, { purpose: "analytics", relevantTo, maxTokens: USE_CASE_BUDGETS.analytics });

/** Sales: relevant products, pricing/discount/proposal rules, approved objections (+ knowledge only when a question needs it). */
export const salesContext = (scope: TenantScope, opts: { query?: string; relevantTo?: string } = {}) =>
  retrieveCompanyContext(scope, { purpose: "sales", query: opts.query, relevantTo: opts.relevantTo, topK: 3, semantic: true, maxTokens: USE_CASE_BUDGETS.sales });

/** Content: the relevant product/service, audience, brand voice and content rules. */
export const contentContext = (scope: TenantScope, opts: { query?: string; relevantTo?: string; maxTokens?: number } = {}) =>
  retrieveCompanyContext(scope, { purpose: "content", query: opts.query, relevantTo: opts.relevantTo, semantic: true, maxTokens: opts.maxTokens ?? USE_CASE_BUDGETS.content });

/** Onboarding analysis of the owner's own website: the only use case that reads many page chunks (bounded). */
export const onboardingContext = (scope: TenantScope, query: string) =>
  retrieveCompanyContext(scope, { purpose: "support", sections: ["knowledge"], query, topK: 8, budget: "large", maxTokens: USE_CASE_BUDGETS.onboarding });
