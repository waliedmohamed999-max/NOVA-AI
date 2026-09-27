import { z } from "zod";
import type { GenerateRequest, GenerateResult, LLMProvider, ProviderName, StructuredResult } from "../types";

/** Shared implementations of the task-shaped helpers on top of the two primitives. */
export abstract class BaseProvider implements LLMProvider {
  abstract readonly name: ProviderName;
  abstract isConfigured(): boolean;
  abstract generateText(req: GenerateRequest): Promise<GenerateResult>;
  abstract generateStructured<S extends z.ZodType>(req: GenerateRequest & { schema: S; schemaName: string }): Promise<StructuredResult<z.output<S>>>;
  abstract stream(req: GenerateRequest): AsyncIterable<string>;

  analyze(req: GenerateRequest) {
    return this.generateText({
      ...req,
      effort: req.effort ?? "high",
      system: [req.system, "Base every conclusion only on the data provided. If the data is insufficient, say so plainly."].filter(Boolean).join("\n\n"),
    });
  }

  summarize(req: GenerateRequest & { text: string }) {
    return this.generateText({
      ...req,
      effort: "low",
      system: [req.system, "Summarize faithfully and concisely. Do not add facts that are not in the text."].filter(Boolean).join("\n\n"),
      messages: [...req.messages, { role: "user", content: req.text }],
    });
  }

  async classify<L extends string>(req: GenerateRequest & { labels: readonly [L, ...L[]] }) {
    const schema = z.object({ label: z.enum(req.labels), confidence: z.number().min(0).max(1) });
    const res = await this.generateStructured({
      ...req,
      effort: "low",
      schema,
      schemaName: "classification",
      system: [req.system, `Classify the input into exactly one of: ${req.labels.join(", ")}.`].filter(Boolean).join("\n\n"),
    });
    return res as StructuredResult<{ label: L; confidence: number }>;
  }
}
