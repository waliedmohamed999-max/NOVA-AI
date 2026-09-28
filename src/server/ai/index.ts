import type { z } from "zod";
import { currentCommandExecutionId } from "./attribution";
import type { AgentKey, AiTaskType } from "@/generated/prisma/enums";
import { db } from "../db/client";
import { logger } from "../logger";
import { UserFacingError } from "../errors";
import { costMicro } from "./models";
import { getBudgetStatus, recordUsage } from "./budget";
import { configuredProviders, getProvider, reportFailure, reportSuccess, routeModels } from "./router";
import { AiError, type ChatMessage, type GenerateRequest, type ImageInput, type ModelSpec, type ProviderName, type QualityTier, type Usage } from "./types";

export { AiError } from "./types";

export type AiCallContext = {
  organizationId: string;
  workspaceId?: string | null;
  agentKey?: AgentKey | null;
  agentRunId?: string | null;
};

type CommonOptions = {
  task: AiTaskType;
  quality?: QualityTier;
  system?: string;
  prompt?: string;
  messages?: ChatMessage[];
  images?: ImageInput[];
  maxTokens?: number;
  effort?: GenerateRequest["effort"];
  /** Content studio: never fall back to the offline development provider (no fake generation). */
  realOnly?: boolean;
  /** Prompt registry key + version, recorded on the ai_runs row. */
  promptRef?: { key: string; version: string };
  /** Company Brain context sent with this call (audit: size, items, source types, brain version). */
  brain?: BrainMeta;
};

export type BrainMeta = { contextTokens: number; retrievedItems: number; sourceTypes: string[]; brainVersion: string };

export type AiMeta = { provider: ProviderName; model: string; usage: Usage; /** Usage × configured price, micro-USD. */ costMicro?: bigint; generatedBy: string; offline: boolean };

/** Real (non-offline) text AI available — required by the content studio. */
export function contentAiConfigured() {
  return configuredProviders().some((p) => p !== "offline");
}

export function aiAvailability() {
  const providers = configuredProviders();
  return { configured: providers.length > 0, providers, offline: providers.length === 1 && providers[0] === "offline" };
}

function toMessages(o: CommonOptions): ChatMessage[] {
  if (o.messages?.length) return o.messages;
  return [{ role: "user", content: o.prompt ?? "" }];
}

/**
 * Runs `fn` against routed models with budget enforcement, fallbacks,
 * and an ai_runs log row for every attempt (provider, model, tokens, cost,
 * latency, task, organization).
 */
async function execute<T>(
  ctx: AiCallContext,
  o: CommonOptions,
  fn: (spec: ModelSpec, req: GenerateRequest) => Promise<{ usage: Usage; model: string; value: T }>,
  offline?: () => unknown,
): Promise<{ value: T; meta: AiMeta }> {
  const budget = await getBudgetStatus(ctx.organizationId);
  if (budget.state === "exhausted" && budget.hardLimitEnabled) {
    await logRun(ctx, o.task, "none", "none", { inputTokens: 0, outputTokens: 0 }, 0n, 0, "BLOCKED", false, "budget exhausted", o.promptRef);
    throw new AiError("ai_budget_exceeded");
  }

  const promptChars = [o.system ?? "", ...toMessages(o).map((m) => m.content)].join("").length;
  const candidates = routeModels(
    { task: o.task, quality: o.quality, contextTokens: Math.ceil(promptChars / 3), needsVision: Boolean(o.images?.length) },
    { costSaving: budget.state === "soft" },
  ).filter((c) => !o.realOnly || c.provider !== "offline");
  if (candidates.length === 0) throw new AiError("ai_not_configured");

  let lastError: unknown;
  for (const [i, spec] of candidates.slice(0, 3).entries()) {
    const started = Date.now();
    const req: GenerateRequest = {
      model: spec.model,
      system: o.system,
      messages: toMessages(o),
      images: o.images,
      maxTokens: o.maxTokens,
      effort: o.effort,
      offline,
    };
    try {
      const res = await fn(spec, req);
      const cost = costMicro(spec, res.usage.inputTokens, res.usage.outputTokens);
      reportSuccess(spec.provider);
      await logRun(ctx, o.task, spec.provider, res.model, res.usage, cost, Date.now() - started, "SUCCESS", i > 0, undefined, o.promptRef, undefined, o.brain);
      await recordUsage({ organizationId: ctx.organizationId, agentKey: ctx.agentKey, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costMicro: cost });
      return {
        value: res.value,
        meta: { provider: spec.provider, model: res.model, usage: res.usage, costMicro: cost, generatedBy: `ai:${spec.provider}:${res.model}`, offline: spec.provider === "offline" },
      };
    } catch (err) {
      lastError = err;
      reportFailure(spec.provider);
      const message = err instanceof Error ? err.message : String(err);
      await logRun(ctx, o.task, spec.provider, spec.model, { inputTokens: 0, outputTokens: 0 }, 0n, Date.now() - started, "ERROR", i > 0, message.slice(0, 500), o.promptRef, undefined, o.brain);
      logger.warn({ provider: spec.provider, model: spec.model, task: o.task, err: message }, "AI call failed, trying fallback");
      if (err instanceof AiError && err.code === "ai_refused") break; // don't retry refusals elsewhere
    }
  }
  throw lastError instanceof AiError ? lastError : new AiError("ai_failed", "All AI providers failed", { cause: lastError });
}

export async function logRun(
  ctx: AiCallContext,
  task: AiTaskType,
  provider: string,
  model: string,
  usage: Usage,
  cost: bigint,
  latencyMs: number,
  status: "SUCCESS" | "ERROR" | "BLOCKED",
  fallbackUsed: boolean,
  error?: string,
  promptRef?: { key: string; version: string },
  costMeta?: { basis: "actual_usage" | "estimated"; pricingVersion: string },
  brain?: BrainMeta,
) {
  await db.aiRun
    .create({
      data: {
        organizationId: ctx.organizationId,
        workspaceId: ctx.workspaceId ?? null,
        agentKey: ctx.agentKey ?? null,
        agentRunId: ctx.agentRunId ?? null,
        commandExecutionId: currentCommandExecutionId(),
        ...(brain ? { contextTokens: brain.contextTokens, retrievedItems: brain.retrievedItems, sourceTypes: brain.sourceTypes, brainVersion: brain.brainVersion } : {}),
        task,
        provider,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costMicro: cost,
        latencyMs,
        status,
        fallbackUsed,
        error,
        promptKey: promptRef?.key ?? null,
        promptVersion: promptRef?.version ?? null,
        costBasis: costMeta?.basis ?? null,
        pricingVersion: costMeta?.pricingVersion ?? null,
      },
    })
    .catch((err) => logger.error({ err }, "failed to log AI run"));
}

export async function aiText(ctx: AiCallContext, o: CommonOptions & { offline?: () => string }) {
  const { value, meta } = await execute(
    ctx,
    o,
    async (spec, req) => {
      const r = await getProvider(spec.provider).generateText(req);
      return { usage: r.usage, model: r.model, value: r.text };
    },
    o.offline,
  );
  return { text: value, ...meta };
}

export async function aiStructured<S extends z.ZodType>(
  ctx: AiCallContext,
  o: CommonOptions & { schema: S; schemaName: string; offline?: () => z.input<S> },
) {
  const { value, meta } = await execute(
    ctx,
    { ...o, task: o.task },
    async (spec, req) => {
      const r = await getProvider(spec.provider).generateStructured({ ...req, schema: o.schema, schemaName: o.schemaName });
      return { usage: r.usage, model: r.model, value: r.data as z.output<S> };
    },
    o.offline,
  );
  return { data: value, ...meta };
}

export async function aiClassify<L extends string>(ctx: AiCallContext, o: CommonOptions & { labels: readonly [L, ...L[]]; offline?: () => { label: L; confidence: number } }) {
  const { value, meta } = await execute(
    ctx,
    { ...o, task: "CLASSIFICATION" },
    async (spec, req) => {
      const r = await getProvider(spec.provider).classify({ ...req, labels: o.labels });
      return { usage: r.usage, model: r.model, value: r.data };
    },
    o.offline,
  );
  return { ...value, ...meta };
}

/** Embeddings (OpenAI only today). Returns null when no embedding provider is configured — callers fall back to keyword search. */
export async function aiEmbed(ctx: AiCallContext, texts: string[]) {
  const provider = getProvider("openai");
  if (!provider.isConfigured() || !provider.embed || texts.length === 0) return null;
  const started = Date.now();
  const res = await provider.embed(texts);
  const cost = BigInt(Math.ceil((res.usage.inputTokens * 20_000) / 1_000_000)); // ~$0.02 / 1M tokens
  await logRun(ctx, "EMBEDDING", "openai", res.model, res.usage, cost, Date.now() - started, "SUCCESS", false);
  await recordUsage({ organizationId: ctx.organizationId, agentKey: ctx.agentKey, inputTokens: res.usage.inputTokens, outputTokens: 0, costMicro: cost });
  return res;
}

/** Maps AI errors to customer-safe error codes. */
export function toUserFacing(err: unknown): UserFacingError {
  if (err instanceof AiError) {
    const code = err.code === "ai_invalid_output" || err.code === "ai_refused" ? "ai_failed" : err.code;
    return new UserFacingError(code, { cause: err });
  }
  return new UserFacingError("ai_failed", { cause: err });
}
