import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AiError, type GenerateRequest, type StructuredResult } from "../types";
import { BaseProvider } from "./base";

/** Models where adaptive thinking + effort are supported. Haiku 4.5 predates both. */
const SUPPORTS_EFFORT = new Set(["claude-opus-5", "claude-sonnet-5"]);

export class AnthropicProvider extends BaseProvider {
  readonly name = "anthropic" as const;
  private client?: Anthropic;

  isConfigured() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  private sdk() {
    this.client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
    return this.client;
  }

  private messages(req: GenerateRequest): Anthropic.Beta.BetaMessageParam[] {
    const out: Anthropic.Beta.BetaMessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
    if (req.images?.length) {
      const lastUser = [...out].reverse().find((m) => m.role === "user");
      if (lastUser) {
        lastUser.content = [
          ...req.images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 } })),
          { type: "text" as const, text: String(lastUser.content) },
        ];
      }
    }
    return out;
  }

  /** Shared request params: adaptive thinking, effort and server-side refusal fallbacks where supported. */
  private params(req: GenerateRequest) {
    const modern = SUPPORTS_EFFORT.has(req.model);
    return {
      model: req.model,
      max_tokens: req.maxTokens ?? 16_000,
      ...(req.system ? { system: req.system } : {}),
      messages: this.messages(req),
      ...(modern ? { thinking: { type: "adaptive" as const }, output_config: { effort: req.effort ?? "medium" } } : {}),
      ...(req.model === "claude-opus-5" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };
  }

  private check(res: Anthropic.Beta.BetaMessage) {
    if (res.stop_reason === "refusal") throw new AiError("ai_refused", `Model declined (${res.stop_details?.category ?? "unspecified"})`);
    if (res.stop_reason === "max_tokens") throw new AiError("ai_failed", "Response hit max_tokens");
  }

  async generateText(req: GenerateRequest) {
    const res = await this.sdk().beta.messages.create(this.params(req), { signal: req.signal });
    this.check(res);
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { text, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }, model: res.model };
  }

  async generateStructured<S extends z.ZodType>(req: GenerateRequest & { schema: S; schemaName: string }): Promise<StructuredResult<z.output<S>>> {
    const base = this.params(req);
    const res = await this.sdk().beta.messages.parse(
      {
        ...base,
        output_config: { ...("output_config" in base ? base.output_config : {}), format: betaZodOutputFormat(req.schema) },
      },
      { signal: req.signal },
    );
    this.check(res);
    if (res.parsed_output == null) throw new AiError("ai_invalid_output", "Structured output did not match schema");
    return { data: res.parsed_output as z.output<S>, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens }, model: res.model };
  }

  async *stream(req: GenerateRequest): AsyncIterable<string> {
    const stream = this.sdk().beta.messages.stream(this.params(req), { signal: req.signal });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
    }
    this.check(await stream.finalMessage());
  }
}
