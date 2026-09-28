import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { aiAvailability, aiStructured } from "../ai";
import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { performanceDigest } from "../analytics/digest";
import { compactContext, retrieveCompanyContext } from "../knowledge/company-context";
import { STRATEGY_TYPES } from "@/lib/brain-fields";
import { recordRevision, upsertFact } from "./core";
import { customerOverview } from "./customers";
import { QUESTIONS } from "./health";

/**
 * Strategy builder: answers (questions engine) + structured brain + aggregated data → a DRAFT.
 * Generation uses AI when available; otherwise a transparent template made only from the owner's own
 * answers. Nothing is approved automatically: Draft → Review → Approved.
 */

type Actor = { userId: string | null };
export type StrategyType = (typeof STRATEGY_TYPES)[number];

export async function saveAnswer(scope: TenantScope, key: string, value: string, actor: Actor) {
  if (!QUESTIONS.some((q) => q.key === key)) throw new UserFacingError("validation");
  return upsertFact(scope, { key: `q.${key}`, value: value.slice(0, 2000), category: "question", sourceKind: "manual" }, actor);
}

const strategySchema = z.object({
  title: z.string(),
  objective: z.string(),
  targetAudience: z.string(),
  positioning: z.string(),
  channels: z.array(z.string()).max(8),
  kpis: z.array(z.string()).max(8),
  initiatives: z.array(z.string()).max(10),
  risks: z.array(z.string()).max(6),
  timeline: z.string(),
});
type Draft = z.infer<typeof strategySchema>;

/** Only aggregates and structured facts — never customer rows. */
async function strategyInputs(scope: TenantScope, fromData: boolean) {
  const t = tenantDb(scope);
  const [answers, segments, won, lost, sourcesAgg, digest] = await Promise.all([
    t.brainFact.findMany({ where: { category: "question", status: "approved" }, select: { key: true, value: true } }),
    t.customerSegment.findMany({ where: { status: "approved" }, select: { name: true, definition: true, size: true } }),
    fromData ? t.lead.count({ where: { stage: "WON" } }) : Promise.resolve(null),
    fromData ? t.lead.count({ where: { stage: "LOST" } }) : Promise.resolve(null),
    fromData ? t.lead.groupBy({ by: ["source"], where: { source: { not: null } }, _count: true, orderBy: { _count: { source: "desc" } }, take: 5 }) : Promise.resolve([]),
    fromData ? performanceDigest(scope, 60) : Promise.resolve(null),
  ]);
  const overview = fromData ? await customerOverview(scope) : null;
  return {
    answers: Object.fromEntries(answers.map((a) => [a.key.replace(/^q\./, ""), a.value])),
    segments: segments.map((s) => `${s.name}${s.size != null ? ` (${s.size})` : ""}${s.definition ? ` — ${s.definition}` : ""}`),
    sales: fromData ? { won, lost, topSources: sourcesAgg.map((s) => `${s.source} (${s._count})`) } : null,
    content: digest?.hasData ? digest.text : null,
    customers: overview ? { total: overview.total, repeat: overview.repeat, topCities: overview.topCities.map((c) => c.key), topCategories: overview.topCategories.map((c) => c.key) } : null,
  };
}

/** A strategy built only from the owner's answers — explicit about being a template. */
function templateDraft(type: StrategyType, inp: Awaited<ReturnType<typeof strategyInputs>>, company: string, locale: "ar" | "en"): Draft {
  const a = inp.answers;
  const ar = locale === "ar";
  const lines = (v?: string) => (v ? v.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean) : []);
  return {
    title: ar ? `استراتيجية ${({ business: "الأعمال", marketing: "التسويق", sales: "المبيعات", content: "المحتوى", retention: "الاحتفاظ بالعملاء" } as const)[type]} — ${company}` : `${type[0].toUpperCase()}${type.slice(1)} strategy — ${company}`,
    objective: a.goal_90d ?? "",
    targetAudience: [a.best_customer, ...inp.segments.slice(0, 3)].filter(Boolean).join(" · "),
    positioning: a.why_choose_us ?? "",
    channels: lines(a.current_channels),
    kpis: [],
    initiatives: [a.focus_product && (ar ? `دفع ${a.focus_product}` : `Push ${a.focus_product}`), a.close_process && (ar ? `توحيد طريقة الإغلاق: ${a.close_process}` : `Standardize closing: ${a.close_process}`)].filter(Boolean) as string[],
    risks: lines(a.biggest_challenge),
    timeline: ar ? "90 يومًا" : "90 days",
  };
}

export async function draftStrategy(scope: TenantScope, actor: Actor, opts: { type: StrategyType; fromData?: boolean; locale: "ar" | "en" }) {
  const t = tenantDb(scope);
  const inputs = await strategyInputs(scope, Boolean(opts.fromData));
  if (!Object.keys(inputs.answers).length && !opts.fromData) throw new UserFacingError("strategy_needs_answers");
  const org = await t.companyProfile.findFirst({ select: { name: true } });
  const company = org?.name ?? "";
  let draft: Draft;
  let generatedBy = "template";
  if (aiAvailability().configured) {
    const brain = await retrieveCompanyContext(scope, { purpose: opts.type === "content" ? "content" : "sales", budget: "medium" });
    const res = await aiStructured(
      { organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "CONTENT_STRATEGIST" },
      {
        task: "ANALYSIS",
        schemaName: "strategy_draft",
        schema: strategySchema,
        maxTokens: 1200,
        system: [
          `Draft a ${opts.type} strategy for the company below. Use only the facts, answers and aggregates given — no invented numbers, market sizes or competitors.`,
          "KPIs must be measurable. Initiatives are concrete actions for the next 90 days.",
          `Write in ${opts.locale === "ar" ? "Arabic" : "English"}.`,
          "",
          compactContext(brain),
        ].join("\n"),
        prompt: JSON.stringify(inputs),
        offline: () => templateDraft(opts.type, inputs, company, opts.locale),
      },
    );
    draft = res.data;
    generatedBy = res.offline ? "offline" : "ai";
  } else draft = templateDraft(opts.type, inputs, company, opts.locale);

  const s = await t.strategy.create({
    data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, type: opts.type, ...draft, status: "DRAFT", generatedBy, inputs: inputs as unknown as Prisma.InputJsonValue, updatedById: actor.userId },
  });
  await recordRevision(scope, { entityType: "strategy", entityId: s.id, action: "create", after: { title: s.title, generatedBy }, sourceKind: generatedBy === "ai" ? "ai" : "manual", actorId: actor.userId });
  return s;
}

const NEXT: Record<string, string[]> = { DRAFT: ["REVIEW", "ARCHIVED"], REVIEW: ["APPROVED", "DRAFT", "ARCHIVED"], APPROVED: ["ARCHIVED", "REVIEW"], ARCHIVED: ["DRAFT"] };

export async function setStrategyStatus(scope: TenantScope, id: string, status: "DRAFT" | "REVIEW" | "APPROVED" | "ARCHIVED", actor: Actor) {
  const t = tenantDb(scope);
  const s = await t.strategy.findUnique({ where: { id } });
  if (!s) throw new NotFoundError("item");
  if (!NEXT[s.status]?.includes(status)) throw new UserFacingError("invalid_transition");
  await t.strategy.update({ where: { id }, data: { status, ...(status === "APPROVED" ? { approvedById: actor.userId, approvedAt: new Date() } : {}) } });
  await recordRevision(scope, { entityType: "strategy", entityId: id, action: status === "APPROVED" ? "approve" : "update", before: { status: s.status }, after: { status }, actorId: actor.userId });
}
