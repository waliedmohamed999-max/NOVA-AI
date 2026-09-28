import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import type { TenantContext } from "../context";
import { audit } from "../audit";
import { logger } from "../logger";
import { aiAvailability } from "../ai";
import { UserFacingError, NotFoundError } from "../errors";
import { ForbiddenError } from "../rbac";
import { redact } from "../security/redact";
import { localParts } from "../reports/service";
import { detectIntent, intentDef, type IntentDef, type IntentKey } from "./registry";
import { extractEntities, normalize } from "./parse";
import { aiRouterAvailable, routeWithAi } from "./ai-router";
import { HANDLERS, localDay, type HandlerInput, type Outcome } from "./handlers";
import type { CommandResponse, CommandStatus, Params, Plan } from "./types";

/**
 * NOVA Command Center pipeline:
 * Input → Normalize → Intent (local first, AI fallback) → Entities → Permission → Action resolution →
 * Approval check → Execute → Result → Activity log (command_executions + audit for real mutations).
 */

export const commandInput = z.object({
  text: z.string().trim().min(2).max(2000),
  locale: z.enum(["ar", "en"]).default("en"),
  idempotencyKey: z.string().trim().min(8).max(80),
  fileIds: z.array(z.string().max(40)).max(5).default([]),
});
export type CommandInput = z.input<typeof commandInput>;

export const commandReply = z.object({
  executionId: z.string().max(40),
  choice: z.number().int().min(0).max(10).optional(),
  confirm: z.boolean().optional(),
  cancel: z.boolean().optional(),
});

type Execution = NonNullable<Awaited<ReturnType<TenantContext["db"]["commandExecution"]["findFirst"]>>>;

const scopeOf = (ctx: TenantContext) => ({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });

function base(ex: Pick<Execution, "id" | "intent" | "kind" | "aiUsed">): Pick<CommandResponse, "executionId" | "intent" | "type" | "aiUsed"> {
  return { executionId: ex.id, intent: (ex.intent as IntentKey | null) ?? null, type: (ex.kind as CommandResponse["type"]) ?? "unknown", aiUsed: ex.aiUsed };
}

const stored = (ex: Execution) => ex.response as unknown as CommandResponse;

async function loadExecution(ctx: TenantContext, id: string) {
  // tenantDb scopes by organization + workspace; the user check keeps one member's pending plans private.
  const ex = await ctx.db.commandExecution.findFirst({ where: { id, userId: ctx.user.id } });
  if (!ex) throw new NotFoundError("command");
  return ex;
}

function paramsOf(ex: Execution): Params {
  return { ...(ex.entities as unknown as Params), input: ex.text };
}

// ── 1. Understand: normalize → intent → entities → permission ──

export async function understandCommand(ctx: TenantContext, raw: CommandInput): Promise<CommandResponse> {
  const input = commandInput.parse(raw);
  const existing = await ctx.db.commandExecution.findFirst({ where: { userId: ctx.user.id, idempotencyKey: input.idempotencyKey } });
  if (existing) return { ...stored(existing), ...base(existing) };

  const t0 = Date.now();
  const text = redact(input.text, 2000)!;
  // Intent comes from the command part only — never from a message body after "…: ".
  const colon = text.search(/(?<!\d):(?!\d)/);
  const n = normalize(colon > 0 ? text.slice(0, colon) : text);
  const weekday = localParts(ctx.organization.timezone).weekday;
  const entities: Params = { ...extractEntities(text, weekday), fileIds: input.fileIds };
  let def: IntentDef | null = detectIntent(n, input.fileIds.length > 0);
  let aiUsed = false;
  let early: Omit<CommandResponse, "executionId" | "intent" | "type" | "aiUsed"> | null = null;
  let errorDetail: string | null = null;

  if (!def) {
    if (!aiRouterAvailable()) {
      early = { status: "ai_unavailable", message: { key: "aiRequired" }, reason: "ai_not_configured", actions: [{ label: "openAiSettings", href: "/settings/ai" }] };
    } else {
      aiUsed = true;
      try {
        const r = await routeWithAi(scopeOf(ctx), text);
        const routed = r.intent !== "unknown" && r.confidence >= 0.55 ? intentDef(r.intent) : null;
        if (!routed) early = { status: "needs_input", message: { key: "notUnderstood" } };
        else {
          def = routed;
          // Only fill what the local parser didn't find; the server still validates everything below.
          entities.name ??= r.entities.name;
          entities.count ??= r.entities.count;
          entities.platform ??= r.entities.platform;
          entities.topic ??= r.entities.topic;
          entities.body ??= r.entities.body;
          entities.date ??= r.entities.date ? { label: r.entities.date, offsetDays: r.entities.date === "today" ? 0 : r.entities.date === "tomorrow" ? 1 : ((8 - weekday) % 7) || 7 } : null;
        }
      } catch (err) {
        errorDetail = redact(err instanceof Error ? err.message : String(err));
        logger.error({ err }, "command ai routing failed");
        early = { status: "failed", message: { key: "failed" }, reason: "ai_failed" };
      }
    }
  }
  if (def && !ctx.can(def.permission)) early = { status: "denied", message: { key: "denied" }, reason: "forbidden" };

  const status: CommandStatus = early?.status ?? "understood";
  const data = {
    organizationId: ctx.organization.id,
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    idempotencyKey: input.idempotencyKey,
    text,
    locale: input.locale,
    intent: def?.key ?? null,
    kind: def?.kind ?? "unknown",
    entities: entities as unknown as Prisma.InputJsonValue,
    action: def?.key ?? null,
    status,
    response: {} as Prisma.InputJsonValue,
    aiUsed,
    approvalRequired: def ? def.approval !== "never" : false,
    errorCode: early && ["failed", "denied", "ai_unavailable"].includes(early.status) ? (early.reason ?? null) : null,
    errorDetail,
    latencyMs: Date.now() - t0,
  };
  let ex: Execution;
  try {
    ex = await ctx.db.commandExecution.create({ data });
  } catch (err) {
    // Double submit with the same idempotency key: return the first one.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const first = await ctx.db.commandExecution.findFirstOrThrow({ where: { userId: ctx.user.id, idempotencyKey: input.idempotencyKey } });
      return { ...stored(first), ...base(first) };
    }
    throw err;
  }
  const response: CommandResponse = { ...base(ex), ...(early ?? { status: "understood", message: { key: "understood" } }) };
  await ctx.db.commandExecution.update({ where: { id: ex.id }, data: { response: response as unknown as Prisma.InputJsonValue } });
  return response;
}

// ── 2. Execute ──

async function handle(ctx: TenantContext, ex: Execution, h: Omit<HandlerInput, "ctx" | "scope" | "def" | "locale">): Promise<{ outcome: Outcome; errorDetail: string | null }> {
  const def = intentDef(ex.intent ?? "");
  if (!def) return { outcome: { status: "failed", message: { key: "failed" }, reason: "unexpected" }, errorDetail: "unknown intent" };
  // Permission is re-checked at execution time (a role may have changed since the command was understood).
  if (!ctx.can(def.permission)) return { outcome: { status: "denied", message: { key: "denied" }, reason: "forbidden" }, errorDetail: null };
  try {
    const outcome = await HANDLERS[def.key as IntentKey]({ ctx, scope: scopeOf(ctx), def, locale: ex.locale === "ar" ? "ar" : "en", ...h });
    return { outcome, errorDetail: null };
  } catch (err) {
    if (err instanceof UserFacingError) return { outcome: { status: "failed", message: { key: "failed" }, reason: err.code }, errorDetail: redact(err.message) };
    if (err instanceof NotFoundError) return { outcome: { status: "failed", message: { key: "failed" }, reason: "item_not_found" }, errorDetail: null };
    if (err instanceof ForbiddenError) return { outcome: { status: "denied", message: { key: "denied" }, reason: "forbidden" }, errorDetail: null };
    if (err instanceof z.ZodError) return { outcome: { status: "failed", message: { key: "failed" }, reason: "validation" }, errorDetail: redact(err.message) };
    logger.error({ err, intent: def.key, executionId: ex.id }, "command failed");
    return { outcome: { status: "failed", message: { key: "failed" }, reason: "unexpected" }, errorDetail: redact(err instanceof Error ? `${err.name}: ${err.message}` : String(err)) };
  }
}

async function finish(ctx: TenantContext, ex: Execution, outcome: Outcome, t0: number, errorDetail: string | null): Promise<CommandResponse> {
  const { plan, receipt, approvalRequired, action, ...rest } = outcome;
  const response: CommandResponse = { ...base(ex), ...rest };
  const def = intentDef(ex.intent ?? "");
  const failed = ["failed", "denied", "ai_unavailable"].includes(outcome.status);
  await ctx.db.commandExecution.update({
    where: { id: ex.id },
    data: {
      status: outcome.status,
      response: response as unknown as Prisma.InputJsonValue,
      plan: plan ? (plan as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      receipt: receipt ? (receipt as unknown as Prisma.InputJsonValue) : undefined,
      runId: outcome.runId ?? ex.runId,
      action: action ?? ex.action,
      approvalRequired: Boolean(approvalRequired) || (def ? def.approval === "always" : false),
      errorCode: failed ? (outcome.reason ?? "unexpected") : null,
      errorDetail,
      latencyMs: (ex.latencyMs ?? 0) + (Date.now() - t0),
    },
  });
  if (receipt) {
    await audit({
      organizationId: ctx.organization.id,
      workspaceId: ctx.workspace.id,
      actorType: "USER",
      actorId: ctx.user.id,
      actorLabel: ctx.user.name ?? ctx.user.email,
      action: `command.${ex.intent}`,
      entityType: receipt.entity,
      entityId: receipt.entityId,
      summary: `Command Center: ${receipt.action} (${receipt.status})`,
      metadata: { executionId: ex.id, receipt },
    });
  }
  return response;
}

/** Claims the execution (so a double click can't run it twice) and runs its handler. */
export async function runCommand(ctx: TenantContext, executionId: string): Promise<CommandResponse> {
  const ex = await loadExecution(ctx, executionId);
  const claimed = await ctx.db.commandExecution.updateMany({ where: { id: ex.id, userId: ctx.user.id, status: "understood" }, data: { status: "processing" } });
  if (!claimed.count) return { ...stored(await loadExecution(ctx, executionId)), ...base(ex), ...(ex.status === "processing" ? { status: "processing" as const } : {}) };
  const t0 = Date.now();
  const { outcome, errorDetail } = await handle(ctx, ex, { params: paramsOf(ex), plan: null, confirmed: false });
  return finish(ctx, ex, outcome, t0, errorDetail);
}

/** A choice (index into the server-stored candidates), a confirmation, or a cancel. */
export async function replyToCommand(ctx: TenantContext, raw: z.input<typeof commandReply>): Promise<CommandResponse> {
  const r = commandReply.parse(raw);
  const ex = await loadExecution(ctx, r.executionId);
  if (ex.status !== "needs_choice" && ex.status !== "needs_confirmation") return { ...stored(ex), ...base(ex) };
  const claimed = await ctx.db.commandExecution.updateMany({ where: { id: ex.id, userId: ctx.user.id, status: ex.status }, data: { status: "processing" } });
  if (!claimed.count) return { ...stored(await loadExecution(ctx, r.executionId)), ...base(ex) };
  const t0 = Date.now();
  const plan = ex.plan as unknown as Plan | null;
  if (r.cancel || !plan) return finish(ctx, ex, { status: "cancelled", message: { key: "cancelled" } }, t0, null);
  if (plan.step === "choice") {
    const leadId = r.choice != null ? plan.candidates?.[r.choice] : undefined;
    if (!leadId) return finish(ctx, ex, { status: "failed", message: { key: "failed" }, reason: "validation" }, t0, "invalid choice");
    const { outcome, errorDetail } = await handle(ctx, ex, { params: { ...plan.params, leadId }, plan: null, confirmed: false });
    return finish(ctx, ex, outcome, t0, errorDetail);
  }
  if (!r.confirm) return finish(ctx, ex, { status: "failed", message: { key: "failed" }, reason: "validation" }, t0, "confirmation expected");
  const { outcome, errorDetail } = await handle(ctx, ex, { params: plan.params, plan, confirmed: true });
  return finish(ctx, ex, outcome, t0, errorDetail);
}

/** One call: understand + run (API / tests). The Home UI calls the two steps separately to show real progress. */
export async function executeCommand(ctx: TenantContext, raw: CommandInput): Promise<CommandResponse> {
  const understood = await understandCommand(ctx, raw);
  if (understood.status !== "understood") return understood;
  return runCommand(ctx, understood.executionId);
}

// ── 3. Jobs: live status of a queued command (Started → Processing → Completed / Partial / Failed) ──

type RunRow = { status: string; steps: unknown; result: unknown; error: string | null };

async function outcomeFromRun(ctx: TenantContext, ex: Execution, run: RunRow): Promise<Outcome> {
  if (run.status === "FAILED" || run.status === "CANCELLED") return { status: "failed", message: { key: "runFailed" }, reason: run.error ?? "unexpected" };
  const r = (run.result ?? {}) as { type?: string; title?: string; summary?: string; items?: { title: string; subtitle?: string; href?: string; badge?: string }[]; entity?: { type: string; id: string }; params?: { requested?: number; count?: number } };
  if (r.entity?.type === "ContentBatch") {
    const ids = r.entity.id ? r.entity.id.split(",").filter(Boolean) : [];
    const requested = Number(r.params?.requested ?? r.params?.count ?? ids.length);
    const byPlatform = ids.length ? await ctx.db.contentItem.groupBy({ by: ["platform"], where: { id: { in: ids } }, _count: true }) : [];
    const created = byPlatform.reduce((a, g) => a + g._count, 0);
    return {
      status: created === 0 ? "failed" : created < requested ? "partial" : "completed",
      message: created === 0 ? { key: "runFailed" } : created < requested ? { key: "contentPartial", values: { created, requested } } : { key: "contentCreated", values: { count: created } },
      reason: created === 0 ? "ai_failed" : null,
      stats: byPlatform.map((g) => ({ key: `platform_${g.platform}`, value: g._count })),
      items: (r.items ?? []).slice(0, 5).map((i) => ({ title: i.title, subtitle: i.subtitle ?? null, href: i.href ?? null, badge: i.badge ?? null })),
      actions: [{ label: "openContentApproval", href: "/content?view=approval", primary: true }, { label: "openCalendar", href: "/calendar" }],
    };
  }
  if (r.entity?.type === "Campaign") {
    return { status: "needs_approval", message: { key: "campaignReady", values: { name: r.title ?? "" } }, text: r.summary ?? null, approvalRequired: true, actions: [{ label: "openCampaign", href: `/campaigns/${r.entity.id}`, primary: true }, { label: "openApprovals", href: "/approvals" }] };
  }
  if (r.entity?.type === "ContentItem") {
    return { status: "completed", message: { key: "carouselReady", values: { count: r.items?.length ?? 0 } }, items: (r.items ?? []).slice(0, 5), actions: [{ label: "openPost", href: `/content/${r.entity.id}`, primary: true }] };
  }
  if (r.type === "leads") {
    const drafted = r.items ?? [];
    const approvals = drafted.filter((i) => i.subtitle === "approval").length;
    return {
      status: approvals ? "needs_approval" : "completed",
      message: { key: approvals ? "followupsForApproval" : "followupsPrepared", values: { count: drafted.length, approvals } },
      items: drafted.slice(0, 5).map((i) => ({ title: i.title, href: i.href ?? null, badge: i.subtitle ?? null })),
      actions: [{ label: "openApprovals", href: "/approvals?tab=SALES", primary: true }, { label: "openFollowups", href: "/sales?view=followups&tab=today" }],
      approvalRequired: approvals > 0,
    };
  }
  if (r.type === "answer") return { status: "completed", message: { key: "answerReady" }, text: r.summary ?? "", items: (r.items ?? []).slice(0, 4) };
  return { status: "completed", message: { key: "done" }, text: r.summary ?? r.title ?? null, items: (r.items ?? []).slice(0, 5) };
}

export async function commandStatus(ctx: TenantContext, executionId: string): Promise<CommandResponse> {
  const ex = await loadExecution(ctx, executionId);
  const current = { ...stored(ex), ...base(ex) };
  if (ex.status !== "queued" || !ex.runId) return current;
  const run = await ctx.db.agentRun.findUnique({ where: { id: ex.runId }, select: { status: true, steps: true, result: true, error: true } });
  if (!run) return current;
  const steps = (run.steps as { status: string }[]) ?? [];
  const progress = { done: steps.filter((s) => s.status === "done" || s.status === "skipped").length, total: steps.length };
  if (run.status === "QUEUED" || run.status === "RUNNING") {
    return { ...current, status: "queued", message: { key: run.status === "RUNNING" ? "processing" : "started" }, progress };
  }
  const outcome = await outcomeFromRun(ctx, ex, run);
  const t0 = Date.now();
  const res = await finish(ctx, ex, { ...outcome, runId: ex.runId, progress: { done: progress.total, total: progress.total } }, t0, run.status === "FAILED" ? run.error : null);
  return res;
}

// ── 4. History & suggestions ──

export async function commandHistory(ctx: TenantContext, limit = 8) {
  const rows = await ctx.db.commandExecution.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, text: true, status: true, intent: true, createdAt: true } });
  const seen = new Set<string>();
  const out: { id: string; text: string; status: string; intent: string | null; at: string }[] = [];
  for (const r of rows) {
    const key = normalize(r.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: r.id, text: r.text, status: r.status, intent: r.intent, at: r.createdAt.toISOString() });
    if (out.length >= limit) break;
  }
  return out;
}

export type Suggestion = { key: string };

/** Only suggestions backed by real state — nothing that depends on data the workspace doesn't have. */
export async function commandSuggestions(ctx: TenantContext): Promise<Suggestion[]> {
  const tz = ctx.organization.timezone;
  const start = localDay(tz, 0);
  const end = localDay(tz, 1);
  const [overdue, dueToday, approvals, hot, leads, content, connected, stalled] = await Promise.all([
    ctx.db.salesActivity.count({ where: { completedAt: null, pausedAt: null, dueAt: { lt: start } } }),
    ctx.db.salesActivity.count({ where: { completedAt: null, pausedAt: null, dueAt: { gte: start, lt: end } } }),
    ctx.db.approval.count({ where: { status: "PENDING" } }),
    ctx.db.lead.count({ where: { temperature: "HOT", stage: { notIn: ["WON", "LOST"] } } }),
    ctx.db.lead.count(),
    ctx.db.contentItem.count(),
    ctx.db.integration.count({ where: { status: "CONNECTED" } }),
    ctx.db.lead.count({ where: { stage: { in: ["CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION"] }, stageChangedAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } }),
  ]);
  const ai = aiAvailability().configured;
  const s: Suggestion[] = [];
  if (overdue && ctx.can("leads:read")) s.push({ key: "reviewOverdue" });
  if (dueToday && ctx.can("leads:read")) s.push({ key: "followupsToday" });
  if (approvals) s.push({ key: "openApprovals" });
  if (hot && ctx.can("leads:read")) s.push({ key: "hotLeads" });
  if (stalled && ctx.can("leads:read")) s.push({ key: "stalledDeals" });
  if (leads && ctx.can("leads:read")) s.push({ key: "salesSummary" });
  if (ai && ctx.can("content:create")) s.push({ key: content ? "prepareWeek" : "firstWeek" });
  if (!leads && ctx.can("leads:manage")) s.push({ key: "addFirstCustomer" });
  if (!connected && ctx.can("integrations:manage")) s.push({ key: "connectAccounts" });
  return s.slice(0, 5);
}

