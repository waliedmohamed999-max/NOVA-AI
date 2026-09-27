import type { TenantContext } from "../context";
import type { LeadCard } from "@/features/sales/board";

export async function loadLeadCards(ctx: TenantContext, where: Record<string, unknown> = {}): Promise<LeadCard[]> {
  const leads = await ctx.db.lead.findMany({ where, orderBy: [{ score: "desc" }, { createdAt: "desc" }], take: 300 });
  return leads.map((l) => ({
    id: l.id,
    name: l.name,
    company: l.company,
    email: l.email,
    stage: l.stage,
    temperature: l.temperature,
    score: l.score,
    valueCents: l.estimatedValueCents,
    currency: l.currency,
    source: l.source,
    lastContactAt: l.lastContactAt?.toISOString() ?? null,
    nextAction: l.nextAction,
    aiInsight: l.aiInsight,
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function stageLabels(ctx: TenantContext): Promise<Record<string, string>> {
  const stages = await ctx.db.pipelineStage.findMany({ orderBy: { position: "asc" } });
  return Object.fromEntries(stages.map((s) => [s.stage, s.label]));
}
