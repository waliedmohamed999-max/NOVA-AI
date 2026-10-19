import { db } from "../db/client";
import { notify } from "../notifications/service";
import { logger } from "../logger";

export const currentPeriod = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * AI usage limit per organization, in tokens (input + output):
 *  - the plan's monthly tokens reset every calendar month (UTC);
 *  - extra tokens (purchased packs, admin grants) never expire and are only used once the monthly tokens are gone;
 *  - when both are used up, AI calls are refused (`ai_budget_exceeded`) until next month or a top-up.
 * Cost (micro-USD) is still recorded for internal tracking but is not the customer-facing limit.
 */
export type BudgetStatus = {
  period: string;
  usedTokens: bigint;
  monthlyTokens: bigint;
  /** Monthly tokens left this period. */
  remainingMonthly: bigint;
  /** Purchased / granted tokens left. */
  extraTokens: bigint;
  /** Everything still usable (remaining monthly + extra). */
  availableTokens: bigint;
  /** Share of the monthly tokens used (can exceed 100 while extra tokens are being used). */
  percent: number;
  softLimitPercent: number;
  /** ok → soft (warning threshold reached) → extra (monthly gone, using extra tokens) → exhausted. */
  state: "ok" | "soft" | "extra" | "exhausted";
  spentMicro: bigint;
};

export async function getBudgetStatus(organizationId: string): Promise<BudgetStatus> {
  const period = currentPeriod();
  const [budget, agg] = await Promise.all([
    db.aiBudget.findUnique({ where: { organizationId } }),
    db.aiUsage.aggregate({ where: { organizationId, period }, _sum: { inputTokens: true, outputTokens: true, costMicro: true } }),
  ]);
  const monthlyTokens = budget?.monthlyTokens ?? 2_000_000n;
  const extraTokens = budget?.extraTokens && budget.extraTokens > 0n ? budget.extraTokens : 0n;
  const usedTokens = (agg._sum.inputTokens ?? 0n) + (agg._sum.outputTokens ?? 0n);
  const remainingMonthly = usedTokens >= monthlyTokens ? 0n : monthlyTokens - usedTokens;
  const availableTokens = remainingMonthly + extraTokens;
  const percent = monthlyTokens > 0n ? Number((usedTokens * 10000n) / monthlyTokens) / 100 : 100;
  const softLimitPercent = budget?.softLimitPercent ?? 80;
  const state = availableTokens <= 0n ? "exhausted" : remainingMonthly <= 0n ? "extra" : percent >= softLimitPercent ? "soft" : "ok";
  return { period, usedTokens, monthlyTokens, remainingMonthly, extraTokens, availableTokens, percent, softLimitPercent, state, spentMicro: agg._sum.costMicro ?? 0n };
}

/**
 * Records a call in the monthly rollup. Tokens beyond the monthly allowance are taken from the extra tokens.
 * Fires one warning notification per period at the soft limit, and one when everything is used up.
 */
export async function recordUsage(input: {
  organizationId: string;
  agentKey?: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicro: bigint;
}) {
  const period = currentPeriod();
  const agentKey = input.agentKey ?? "none";
  const tokens = BigInt(Math.max(0, input.inputTokens) + Math.max(0, input.outputTokens));
  const before = await getBudgetStatus(input.organizationId);

  await db.aiUsage.upsert({
    where: { organizationId_period_agentKey: { organizationId: input.organizationId, period, agentKey } },
    create: { organizationId: input.organizationId, period, agentKey, requests: 1, inputTokens: BigInt(input.inputTokens), outputTokens: BigInt(input.outputTokens), costMicro: input.costMicro },
    update: { requests: { increment: 1 }, inputTokens: { increment: BigInt(input.inputTokens) }, outputTokens: { increment: BigInt(input.outputTokens) }, costMicro: { increment: input.costMicro } },
  });

  // The part of this call that didn't fit in what was left of the monthly allowance comes out of the extra tokens.
  const overflow = tokens > before.remainingMonthly ? tokens - before.remainingMonthly : 0n;
  if (overflow > 0n && before.extraTokens > 0n) {
    await db.$executeRaw`UPDATE "ai_budgets" SET "extraTokens" = GREATEST("extraTokens" - ${overflow}, 0), "updatedAt" = NOW() WHERE "organizationId" = ${input.organizationId}`;
  }

  const status = await getBudgetStatus(input.organizationId);
  if (status.state === "ok") return;
  const level = status.state === "exhausted" ? "exhausted" : status.state === "soft" ? "soft" : null;
  if (!level) return;
  const claimed = await db.aiBudget.updateMany({
    where: { organizationId: input.organizationId, ...(level === "soft" ? { OR: [{ softLimitNotifiedFor: null }, { softLimitNotifiedFor: { not: period } }] } : { OR: [{ exhaustedNotifiedFor: null }, { exhaustedNotifiedFor: { not: period } }] }) },
    data: level === "soft" ? { softLimitNotifiedFor: period } : { exhaustedNotifiedFor: period },
  });
  if (claimed.count !== 1) return;
  const org = await db.organization.findUnique({ where: { id: input.organizationId }, select: { locale: true } });
  const ar = org?.locale === "ar";
  await notify({
    organizationId: input.organizationId,
    type: "USAGE_LIMIT",
    title:
      level === "soft"
        ? ar
          ? `استُخدم ${Math.round(status.percent)}% من رصيد الذكاء الاصطناعي لهذا الشهر`
          : `You've used ${Math.round(status.percent)}% of this month's AI tokens`
        : ar
          ? "نفد رصيد الذكاء الاصطناعي"
          : "Your AI tokens are used up",
    body:
      level === "soft"
        ? ar
          ? "عند نفاد الرصيد تتوقف مهام الذكاء الاصطناعي حتى الشهر القادم، أو اشترِ رصيدًا إضافيًا."
          : "When they run out, AI tasks pause until next month — or buy extra tokens."
        : ar
          ? "مهام الذكاء الاصطناعي متوقفة حتى الشهر القادم. اشترِ رصيدًا إضافيًا للمتابعة الآن."
          : "AI tasks are paused until next month. Buy extra tokens to continue now.",
    link: "/settings/billing",
    roles: ["OWNER", "ADMIN"],
  }).catch((err) => logger.error({ err }, "usage notification failed"));
}
