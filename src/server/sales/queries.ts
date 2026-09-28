import type { TenantContext } from "../context";

export async function stageLabels(ctx: TenantContext): Promise<Record<string, string>> {
  const stages = await ctx.db.pipelineStage.findMany({ orderBy: { position: "asc" } });
  return Object.fromEntries(stages.map((s) => [s.stage, s.label]));
}
