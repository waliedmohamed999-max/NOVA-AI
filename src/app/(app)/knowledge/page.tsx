import type { Metadata } from "next";
import { getFormatter } from "next-intl/server";
import { requireTenant, type TenantContext } from "@/server/context";
import { brainHealth, loadBrainState, nextQuestion, questionStates } from "@/server/brain/health";
import { customerInsights, customerOverview } from "@/server/brain/customers";
import { listSources } from "@/server/brain/sources";
import { BRAIN_ENTITIES, CONTENT_FIELDS, PROFILE_FIELDS, SALES_FIELDS, type BrainEntityType } from "@/lib/brain-fields";
import { BrainShell, BRAIN_TABS, type BrainTab } from "@/features/brain/shell";
import { BrainOverview } from "@/features/brain/overview";
import { HealthTab } from "@/features/brain/health-tab";
import { ContentTab, FaqTab, ProductsTab, ProfileTab, SalesTab } from "@/features/brain/tabs-knowledge";
import { CustomersTab, MarketTab, SourcesTab, StrategyTab } from "@/features/brain/tabs-intel";
import { ImportsTab } from "@/features/brain/imports-tab";
import type { EntityRow } from "@/features/brain/ui";

export const metadata: Metadata = { title: "Company Brain" };

const pick = (row: Record<string, unknown>, names: string[]) => Object.fromEntries(names.map((n) => [n, row[n] ?? null]));

function rowsOf(type: BrainEntityType, rows: Record<string, unknown>[]): EntityRow[] {
  const names = BRAIN_ENTITIES[type].fields.map((f) => f.name);
  return rows.map((r) => ({ id: String(r.id), values: pick(r, names), status: (r.status as string) ?? null, sourceKind: (r.sourceKind as string) ?? (r.source as string) ?? null }));
}

/**
 * Company Brain — "everything NOVA knows about your company". One workspace, twelve sections; each
 * section loads only its own data (no chunk dumps, paginated sources).
 */
export default async function KnowledgePage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const sp = await props.searchParams;
  const tab = (BRAIN_TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as BrainTab) : "overview";
  const canManage = ctx.can("knowledge:manage");
  const canApprove = ctx.can("content:approve");
  const content = await renderTab(tab, ctx, sp, canManage, canApprove);
  const pendingFacts = await ctx.db.brainFact.count({ where: { status: "pending" } });
  const pendingImports = await ctx.db.brainImport.count({ where: { status: "REVIEW" } });
  return (
    <BrainShell tab={tab} badges={{ profile: pendingFacts, imports: pendingImports }}>
      {content}
    </BrainShell>
  );
}

async function renderTab(tab: BrainTab, ctx: TenantContext, sp: Record<string, string | string[] | undefined>, canManage: boolean, canApprove: boolean) {
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  switch (tab) {
    case "overview":
    case "health": {
      const state = await loadBrainState(scope);
      const h = brainHealth(state);
      return tab === "overview" ? <BrainOverview state={state} areas={h.areas} overall={h.overall} missing={h.missing} canManage={canManage} /> : <HealthTab areas={h.areas} state={state} />;
    }
    case "profile": {
      const [profile, facts] = await Promise.all([ctx.db.companyProfile.findFirst(), ctx.db.brainFact.findMany({ where: { category: { not: "question" }, status: { not: "rejected" } }, orderBy: { updatedAt: "desc" }, take: 100 })]);
      const values = pick((profile ?? {}) as Record<string, unknown>, PROFILE_FIELDS.map((f) => f.name));
      if (!values.description && profile?.summary) values.description = profile.summary;
      return (
        <ProfileTab
          values={values}
          provenance={(profile?.fieldSources ?? {}) as Record<string, { source?: string; at?: string }>}
          facts={facts.map((f) => ({ id: f.id, key: f.key, value: f.value, category: f.category, sourceKind: f.sourceKind, status: f.status, critical: f.critical, confidence: f.confidence }))}
          canManage={canManage}
          canApprove={canApprove}
        />
      );
    }
    case "products": {
      const rows = await ctx.db.offering.findMany({ orderBy: { createdAt: "asc" }, take: 200 });
      return <ProductsTab rows={rowsOf("offering", rows as unknown as Record<string, unknown>[]).map((r, i) => ({ ...r, status: rows[i].status, badges: [rows[i].category, rows[i].priceText].filter(Boolean) as string[] }))} canManage={canManage} />;
    }
    case "customers": {
      const [overview, insights, segments, icps] = await Promise.all([customerOverview(scope), customerInsights(scope), ctx.db.customerSegment.findMany({ where: { status: { not: "rejected" } }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 50 }), ctx.db.idealCustomerProfile.findMany({ orderBy: { updatedAt: "desc" }, take: 20 })]);
      const format = await getFormatter();
      return (
        <CustomersTab
          stats={{ ...overview, avgSpend: overview.avgSpendCents != null ? format.number(overview.avgSpendCents / 100, overview.currency ? { style: "currency", currency: overview.currency } : undefined) : null }}
          insights={insights}
          segments={rowsOf("segment", segments as unknown as Record<string, unknown>[]).map((r, i) => ({ ...r, sourceKind: segments[i].source === "manual" ? "manual" : segments[i].source === "ai" ? "ai" : "crm", criteria: (segments[i].criteria ?? {}) as Record<string, unknown>, size: segments[i].size }))}
          icps={rowsOf("icp", icps as unknown as Record<string, unknown>[]).map((r, i) => ({ ...r, badges: [icps[i].kind] }))}
          canManage={canManage}
          canApprove={canApprove}
        />
      );
    }
    case "strategy": {
      const [state, strategies] = await Promise.all([loadBrainState(scope), ctx.db.strategy.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { updatedAt: "desc" }, take: 30 })]);
      const questions = questionStates(state, state.answers);
      return (
        <StrategyTab
          questions={questions.map((q) => ({ ...q, value: q.value ?? null }))}
          next={nextQuestion(questions) ? { ...nextQuestion(questions)!, value: nextQuestion(questions)!.value ?? null } : null}
          strategies={rowsOf("strategy", strategies as unknown as Record<string, unknown>[]).map((r, i) => ({ ...r, status: strategies[i].status, sourceKind: strategies[i].generatedBy === "manual" ? "manual" : strategies[i].generatedBy === "template" ? "template" : "ai", badges: [strategies[i].type, ...strategies[i].kpis.slice(0, 2)] }))}
          canManage={canManage}
          canApprove={canApprove}
        />
      );
    }
    case "market": {
      const rows = await ctx.db.competitor.findMany({ orderBy: { updatedAt: "desc" }, take: 50 });
      return <MarketTab competitors={rowsOf("competitor", rows as unknown as Record<string, unknown>[]).map((r, i) => ({ ...r, badges: [...rows[i].channels, ...(rows[i].website ? [new URL(rows[i].website!).hostname] : [])] }))} canManage={canManage} />;
    }
    case "sales": {
      const [sales, objections, stages] = await Promise.all([ctx.db.salesKnowledge.findFirst(), ctx.db.brainObjection.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 100 }), ctx.db.pipelineStage.findMany({ orderBy: { position: "asc" } })]);
      return (
        <SalesTab
          values={pick((sales ?? {}) as Record<string, unknown>, SALES_FIELDS.map((f) => f.name))}
          objections={rowsOf("objection", objections as unknown as Record<string, unknown>[]).map((r, i) => ({ ...r, badges: [objections[i].automation === "auto_allowed" ? "auto" : "draft"] }))}
          stages={stages.map((s) => ({ label: s.label, probability: s.probability }))}
          canManage={canManage}
          canApprove={canApprove}
        />
      );
    }
    case "content": {
      const [kit, profile, competitors] = await Promise.all([ctx.db.brandKit.findFirst(), ctx.db.companyProfile.findFirst({ select: { contentPillars: true } }), ctx.db.competitor.findMany({ select: { name: true, contentThemes: true }, take: 10 })]);
      const values = { ...pick((kit ?? {}) as Record<string, unknown>, CONTENT_FIELDS.map((f) => f.name)), contentPillars: profile?.contentPillars ?? [] };
      return <ContentTab values={values} competitorThemes={competitors.flatMap((c) => c.contentThemes.map((x) => `${x} — ${c.name}`)).slice(0, 20)} canManage={canManage} />;
    }
    case "faq": {
      const rows = await ctx.db.brainFaq.findMany({ where: { status: { not: "rejected" } }, orderBy: [{ status: "desc" }, { updatedAt: "desc" }], take: 200 });
      return <FaqTab rows={rowsOf("faq", rows as unknown as Record<string, unknown>[]).map((r, i) => ({ ...r, badges: [rows[i].category, rows[i].channel].filter(Boolean) as string[] }))} canManage={canManage} canApprove={canApprove} />;
    }
    case "sources": {
      const page = Math.max(1, Number(sp.page ?? 1) || 1);
      const s = await listSources(scope, page);
      return <SourcesTab rows={s.rows} total={s.total} page={page} canManage={canManage} />;
    }
    case "imports": {
      const rows = await ctx.db.brainImport.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { id: true, kind: true, status: true, title: true, error: true, createdAt: true } });
      return <ImportsTab rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} canManage={canManage} openId={typeof sp.review === "string" ? sp.review : null} />;
    }
  }
}
