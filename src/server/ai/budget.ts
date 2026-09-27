import { db } from "../db/client";
import { notify } from "../notifications/service";
import { logger } from "../logger";

export const currentPeriod = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export type BudgetStatus = {
  period: string;
  spentMicro: bigint;
  allowanceMicro: bigint;
  percent: number;
  softLimitPercent: number;
  hardLimitEnabled: boolean;
  state: "ok" | "soft" | "exhausted";
};

export async function getBudgetStatus(organizationId: string): Promise<BudgetStatus> {
  const period = currentPeriod();
  const [budget, agg] = await Promise.all([
    db.aiBudget.findUnique({ where: { organizationId } }),
    db.aiUsage.aggregate({ where: { organizationId, period }, _sum: { costMicro: true } }),
  ]);
  const allowanceMicro = budget?.monthlyAllowanceMicro ?? 20_000_000n;
  const spentMicro = agg._sum.costMicro ?? 0n;
  const percent = allowanceMicro > 0n ? Number((spentMicro * 10000n) / allowanceMicro) / 100 : 100;
  const softLimitPercent = budget?.softLimitPercent ?? 80;
  const hardLimitEnabled = budget?.hardLimitEnabled ?? true;
  const state = percent >= 100 ? "exhausted" : percent >= softLimitPercent ? "soft" : "ok";
  return { period, spentMicro, allowanceMicro, percent, softLimitPercent, hardLimitEnabled, state };
}

/** Records spend in the monthly rollup and fires a one-time soft-limit notification per period. */
export async function recordUsage(input: {
  organizationId: string;
  agentKey?: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicro: bigint;
}) {
  const period = currentPeriod();
  const agentKey = input.agentKey ?? "none";
  await db.aiUsage.upsert({
    where: { organizationId_period_agentKey: { organizationId: input.organizationId, period, agentKey } },
    create: {
      organizationId: input.organizationId,
      period,
      agentKey,
      requests: 1,
      inputTokens: BigInt(input.inputTokens),
      outputTokens: BigInt(input.outputTokens),
      costMicro: input.costMicro,
    },
    update: {
      requests: { increment: 1 },
      inputTokens: { increment: BigInt(input.inputTokens) },
      outputTokens: { increment: BigInt(input.outputTokens) },
      costMicro: { increment: input.costMicro },
    },
  });

  const status = await getBudgetStatus(input.organizationId);
  if (status.state === "ok") return;
  const claimed = await db.aiBudget.updateMany({
    where: { organizationId: input.organizationId, OR: [{ softLimitNotifiedFor: null }, { softLimitNotifiedFor: { not: period } }] },
    data: { softLimitNotifiedFor: period },
  });
  if (claimed.count === 1) {
    await notify({
      organizationId: input.organizationId,
      type: "USAGE_LIMIT",
      title: `AI usage has reached ${Math.round(status.percent)}% of this month's allowance`,
      body: status.hardLimitEnabled ? "When the allowance is used up, AI tasks pause until next month or until you raise the limit." : undefined,
      link: "/settings/billing",
      roles: ["OWNER", "ADMIN"],
    }).catch((err) => logger.error({ err }, "usage notification failed"));
  }
}
