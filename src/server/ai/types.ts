import type { z } from "zod";
import type { AiTaskType } from "@/generated/prisma/enums";

export type ProviderName = "anthropic" | "openai" | "offline";
export type QualityTier = "fast" | "balanced" | "best";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ImageInput = { mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; base64: string };

export type GenerateRequest = {
  model: string;
  system?: string;
  messages: ChatMessage[];
  images?: ImageInput[];
  maxTokens?: number;
  /** Reasoning depth for providers that support it. */
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
  /**
   * Deterministic output used ONLY by the offline development provider
   * (AI_OFFLINE_MODE, never in production). Real providers ignore it.
   */
  offline?: () => unknown;
};

export type Usage = { inputTokens: number; outputTokens: number };

export type GenerateResult = { text: string; usage: Usage; model: string };

export type StructuredResult<T> = { data: T; usage: Usage; model: string };

/**
 * Provider abstraction. Business logic never talks to a vendor SDK directly —
 * it goes through the router (./router) which picks a provider + model.
 * `analyze`, `summarize` and `classify` are task-shaped conveniences built on
 * the two primitives, so every provider supports them uniformly.
 */
export interface LLMProvider {
  readonly name: ProviderName;
  isConfigured(): boolean;
  generateText(req: GenerateRequest): Promise<GenerateResult>;
  generateStructured<S extends z.ZodType>(req: GenerateRequest & { schema: S; schemaName: string }): Promise<StructuredResult<z.output<S>>>;
  stream(req: GenerateRequest): AsyncIterable<string>;
  analyze(req: GenerateRequest): Promise<GenerateResult>;
  summarize(req: GenerateRequest & { text: string }): Promise<GenerateResult>;
  classify<L extends string>(req: GenerateRequest & { labels: readonly [L, ...L[]] }): Promise<StructuredResult<{ label: L; confidence: number }>>;
  embed?(texts: string[]): Promise<{ vectors: number[][]; model: string; usage: Usage }>;
}

export type ModelSpec = {
  provider: ProviderName;
  model: string;
  tier: QualityTier;
  contextTokens: number;
  /** micro-USD per 1M tokens (i.e. USD × 1e6 per 1M tokens). */
  inputMicroPerMTok: number;
  outputMicroPerMTok: number;
  vision: boolean;
};

export type RouteRequest = {
  task: AiTaskType;
  quality?: QualityTier;
  /** Rough prompt size; filters out models whose context is too small. */
  contextTokens?: number;
  needsVision?: boolean;
};

export class AiError extends Error {
  constructor(
    public code: "ai_not_configured" | "ai_budget_exceeded" | "ai_failed" | "ai_invalid_output" | "ai_refused",
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
    this.name = "AiError";
  }
}
