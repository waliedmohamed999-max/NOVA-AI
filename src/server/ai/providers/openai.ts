import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { AiError, type GenerateRequest, type StructuredResult } from "../types";
import { BaseProvider } from "./base";

export class OpenAIProvider extends BaseProvider {
  readonly name = "openai" as const;
  private client?: OpenAI;

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  private sdk() {
    this.client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 120_000 });
    return this.client;
  }

  private input(req: GenerateRequest): OpenAI.Responses.ResponseInput {
    return req.messages.map((m, i) => {
      const isLastUser = m.role === "user" && i === req.messages.map((x) => x.role).lastIndexOf("user");
      if (isLastUser && req.images?.length) {
        return {
          role: "user" as const,
          content: [
            ...req.images.map((img) => ({ type: "input_image" as const, image_url: `data:${img.mediaType};base64,${img.base64}`, detail: "auto" as const })),
            { type: "input_text" as const, text: m.content },
          ],
        };
      }
      return { role: m.role, content: m.content };
    });
  }

  private params(req: GenerateRequest) {
    const reasoning = process.env.OPENAI_REASONING !== "false";
    return {
      model: req.model,
      instructions: req.system,
      input: this.input(req),
      max_output_tokens: req.maxTokens ?? 16_000,
      ...(reasoning ? { reasoning: { effort: req.effort ?? "medium" } } : {}),
    };
  }

  async generateText(req: GenerateRequest) {
    const res = await this.sdk().responses.create(this.params(req), { signal: req.signal });
    if (res.status === "incomplete") throw new AiError("ai_failed", `OpenAI response incomplete: ${res.incomplete_details?.reason ?? "unknown"}`);
    return { text: res.output_text, usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 }, model: res.model };
  }

  async generateStructured<S extends z.ZodType>(req: GenerateRequest & { schema: S; schemaName: string }): Promise<StructuredResult<z.output<S>>> {
    const res = await this.sdk().responses.parse({ ...this.params(req), text: { format: zodTextFormat(req.schema, req.schemaName) } }, { signal: req.signal });
    if (res.output_parsed == null) throw new AiError("ai_invalid_output", "Structured output did not match schema");
    return { data: res.output_parsed as z.output<S>, usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 }, model: res.model };
  }

  async *stream(req: GenerateRequest): AsyncIterable<string> {
    const stream = await this.sdk().responses.create({ ...this.params(req), stream: true }, { signal: req.signal });
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") yield event.delta;
    }
  }

  async embed(texts: string[]) {
    const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
    const res = await this.sdk().embeddings.create({ model, input: texts, dimensions: 1536 });
    return { vectors: res.data.map((d) => d.embedding), model, usage: { inputTokens: res.usage.prompt_tokens, outputTokens: 0 } };
  }
}
