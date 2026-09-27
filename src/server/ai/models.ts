import type { AiTaskType } from "@/generated/prisma/enums";
import type { ModelSpec, QualityTier } from "./types";

const M = 1_000_000;

/**
 * Model catalog used by the router for selection and cost accounting.
 * Anthropic prices are list prices per 1M tokens. OpenAI model IDs and prices
 * are configurable via env because they change frequently.
 */
export function modelCatalog(): ModelSpec[] {
  const env = process.env;
  const openaiPrice = (key: string, fallback: number) => Math.round(Number(env[key] ?? fallback) * M);
  return [
    { provider: "anthropic", model: "claude-opus-5", tier: "best", contextTokens: 1_000_000, inputMicroPerMTok: 5 * M, outputMicroPerMTok: 25 * M, vision: true },
    { provider: "anthropic", model: "claude-sonnet-5", tier: "balanced", contextTokens: 1_000_000, inputMicroPerMTok: 2 * M, outputMicroPerMTok: 10 * M, vision: true },
    { provider: "anthropic", model: "claude-haiku-4-5", tier: "fast", contextTokens: 200_000, inputMicroPerMTok: 1 * M, outputMicroPerMTok: 5 * M, vision: true },
    {
      provider: "openai",
      model: env.OPENAI_MODEL_BEST ?? "gpt-5",
      tier: "best",
      contextTokens: 400_000,
      inputMicroPerMTok: openaiPrice("OPENAI_PRICE_BEST_INPUT", 1.25),
      outputMicroPerMTok: openaiPrice("OPENAI_PRICE_BEST_OUTPUT", 10),
      vision: true,
    },
    {
      provider: "openai",
      model: env.OPENAI_MODEL_FAST ?? "gpt-5-mini",
      tier: "fast",
      contextTokens: 400_000,
      inputMicroPerMTok: openaiPrice("OPENAI_PRICE_FAST_INPUT", 0.25),
      outputMicroPerMTok: openaiPrice("OPENAI_PRICE_FAST_OUTPUT", 2),
      vision: true,
    },
    { provider: "offline", model: "nova-offline-1", tier: "fast", contextTokens: 1_000_000, inputMicroPerMTok: 0, outputMicroPerMTok: 0, vision: true },
  ];
}

/** Default quality requirement per task type. */
export const TASK_QUALITY: Record<AiTaskType, QualityTier> = {
  STRATEGY: "best",
  COPYWRITING: "best",
  SALES: "best",
  ANALYSIS: "balanced",
  STRUCTURED: "balanced",
  VISION: "balanced",
  SUMMARIZATION: "fast",
  CLASSIFICATION: "fast",
  EXTRACTION: "fast",
  EMBEDDING: "fast",
};

export function costMicro(spec: Pick<ModelSpec, "inputMicroPerMTok" | "outputMicroPerMTok">, inputTokens: number, outputTokens: number): bigint {
  return BigInt(Math.ceil((inputTokens * spec.inputMicroPerMTok + outputTokens * spec.outputMicroPerMTok) / M));
}
