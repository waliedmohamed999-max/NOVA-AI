import { db } from "../db/client";
import { imagePricing } from "../design/image-cost";

/**
 * Platform-admin view of image generation cost this month: priced from provider usage vs estimated,
 * with token totals and the active pricing table. Never shown to customers.
 */
export async function imageCostSummary() {
  const d = new Date();
  const since = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const rows = await db.aiRun.groupBy({
    by: ["task", "costBasis"],
    where: { task: { in: ["IMAGE_GENERATION", "IMAGE_EDIT"] }, status: "SUCCESS", createdAt: { gte: since } },
    _count: true,
    _sum: { costMicro: true, inputTokens: true, outputTokens: true },
  });
  return {
    pricing: imagePricing(),
    rows: rows.map((r) => ({
      task: r.task,
      basis: r.costBasis ?? "unknown",
      runs: r._count,
      costUsd: Number(r._sum.costMicro ?? 0n) / 1_000_000,
      inputTokens: r._sum.inputTokens ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
    })),
  };
}
