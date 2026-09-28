import { z } from "zod";
import { aiStructured, contentAiConfigured } from "../ai";
import { tenantDb, type TenantScope } from "../db/tenant";
import { UserFacingError } from "../errors";
import { normalizeUrl } from "../net/safe-fetch";
import { extractPage } from "../knowledge/extract";
import { compactContext, retrieveCompanyContext } from "../knowledge/company-context";
import { recordRevision } from "./core";
import { structuredSignals } from "./extract";
import { publicFetch } from "./imports";

/**
 * Competitors: manual, or prefilled from ONE public page (title, description, headings, public prices,
 * social links). No crawling behind logins, no bulk scraping. The owner edits and confirms.
 */

type Actor = { userId: string | null };
let fetchPage: (url: string) => Promise<{ url: string; status: number; contentType: string; body: string }> = (url) => publicFetch(url);
/** Test hook: fixture pages instead of the network. */
export function setCompetitorFetcher(f: typeof fetchPage | null) {
  if (f) fetchPage = f;
}

export async function importCompetitor(scope: TenantScope, actor: Actor, rawUrl: string) {
  let url: string;
  try {
    url = normalizeUrl(rawUrl).toString();
  } catch {
    throw new UserFacingError("website_unreachable");
  }
  const res = await fetchPage(url);
  if (res.status >= 400 || !res.contentType.includes("html")) throw new UserFacingError("website_unreachable");
  const page = extractPage(res.body, res.url);
  const sig = structuredSignals(res.body);
  const prices = sig.products.map((p) => p.price).filter((x): x is number => x != null);
  const t = tenantDb(scope);
  const name = (sig.organization?.name ?? page.title.split(/[|\-–—]/)[0] ?? new URL(url).hostname).trim().slice(0, 160) || new URL(url).hostname;
  const c = await t.competitor.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      name,
      website: url,
      positioning: (sig.organization?.description ?? page.description)?.slice(0, 1000) ?? null,
      services: page.headings.slice(1, 9).map((h) => h.slice(0, 120)),
      pricing: prices.length ? `${Math.min(...prices)} – ${Math.max(...prices)} ${sig.products.find((p) => p.currency)?.currency ?? ""}`.trim() : null,
      channels: Object.keys(page.social),
      sourceKind: "public_web",
      lastVerifiedAt: new Date(),
      updatedById: actor.userId,
    },
  });
  await recordRevision(scope, { entityType: "competitor", entityId: c.id, action: "create", after: { name: c.name, website: url }, sourceKind: "public_web", actorId: actor.userId });
  return c;
}

const analysisSchema = z.object({
  summary: z.string(),
  positioning: z.array(z.string()).max(6),
  offers: z.array(z.string()).max(6),
  messaging: z.array(z.string()).max(6),
  contentGaps: z.array(z.string()).max(6),
});

/**
 * Comparison of the company vs. the competitors the owner added. The label is part of the result:
 * it's based on the added sources only — never a claim about the whole market.
 */
export async function analyzeCompetitors(scope: TenantScope, locale: "ar" | "en") {
  const t = tenantDb(scope);
  const competitors = await t.competitor.findMany({ orderBy: { updatedAt: "desc" }, take: 6 });
  if (!competitors.length) throw new UserFacingError("no_competitors");
  const table = competitors.map((c) => ({ name: c.name, positioning: c.positioning, services: c.services.length, pricing: c.pricing, channels: c.channels, themes: c.contentThemes }));
  if (!contentAiConfigured()) return { basis: "added_sources" as const, ai: false, table, analysis: null };
  const ours = await retrieveCompanyContext(scope, { purpose: "content", budget: "small" });
  const res = await aiStructured(
    { organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "PERFORMANCE_ANALYST" },
    {
      task: "ANALYSIS",
      realOnly: true,
      maxTokens: 800,
      schemaName: "competitor_analysis",
      schema: analysisSchema,
      system: `Compare the company with ONLY the competitors listed (positioning, offer structure, messaging, content themes). Do not claim anything about the wider market. Write in ${locale === "ar" ? "Arabic" : "English"}.\n\n${compactContext(ours)}`,
      prompt: JSON.stringify(competitors.map((c) => ({ name: c.name, positioning: c.positioning, services: c.services, pricing: c.pricing, strengths: c.strengths, weaknesses: c.weaknesses, themes: c.contentThemes, channels: c.channels }))),
    },
  );
  return { basis: "added_sources" as const, ai: true, table, analysis: res.data };
}
