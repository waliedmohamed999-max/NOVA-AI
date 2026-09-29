import { z } from "zod";
import { AiError, type GenerateRequest, type StructuredResult } from "../types";
import { BaseProvider } from "./base";

/**
 * Deterministic provider for local development and automated tests.
 *
 * - Enabled when AI_OFFLINE_MODE=true outside production, or — deliberately, until a real key is
 *   added — when AI_DEMO_MODE=true (any environment). The app labels it "Demo AI" everywhere.
 * - Never calls the network and costs nothing.
 * - Callers supply `offline()` builders that assemble output from the
 *   company's own stored data (templates, not invented metrics). Output is
 *   stamped `generatedBy: "offline"` wherever it is persisted so it is never
 *   mistaken for real model output.
 */
export class OfflineProvider extends BaseProvider {
  readonly name = "offline" as const;

  isConfigured() {
    return (process.env.AI_OFFLINE_MODE === "true" && process.env.NODE_ENV !== "production") || process.env.AI_DEMO_MODE === "true";
  }

  private estimate(req: GenerateRequest, out: string) {
    const input = [req.system ?? "", ...req.messages.map((m) => m.content)].join(" ");
    return { inputTokens: Math.ceil(input.length / 4), outputTokens: Math.ceil(out.length / 4) };
  }

  async generateText(req: GenerateRequest) {
    const built = req.offline?.();
    const text = typeof built === "string" ? built : echoSummary(req);
    return { text, usage: this.estimate(req, text), model: "nova-offline-1" };
  }

  async generateStructured<S extends z.ZodType>(req: GenerateRequest & { schema: S; schemaName: string }): Promise<StructuredResult<z.output<S>>> {
    const candidate = req.offline ? req.offline() : sampleFromSchema(z.toJSONSchema(req.schema) as JsonSchema);
    const parsed = req.schema.safeParse(candidate);
    if (!parsed.success) throw new AiError("ai_invalid_output", `Offline builder for ${req.schemaName} does not match schema: ${parsed.error.message}`);
    return { data: parsed.data, usage: this.estimate(req, JSON.stringify(candidate)), model: "nova-offline-1" };
  }

  async *stream(req: GenerateRequest): AsyncIterable<string> {
    const { text } = await this.generateText(req);
    for (const word of text.split(/(\s+)/)) {
      yield word;
      await new Promise((r) => setTimeout(r, 8));
    }
  }
}

function echoSummary(req: GenerateRequest) {
  const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const firstSentence = last.split(/(?<=[.!?؟])\s/)[0]?.slice(0, 280) ?? "";
  return firstSentence || "Done.";
}

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  minimum?: number;
  minItems?: number;
  const?: unknown;
};

/** Minimal valid sample for a JSON schema (fallback when no builder is supplied). */
export function sampleFromSchema(s: JsonSchema): unknown {
  if (s.const !== undefined) return s.const;
  if (s.enum?.length) return s.enum[0];
  if (s.anyOf?.length) return sampleFromSchema(s.anyOf.find((x) => x.type !== "null") ?? s.anyOf[0]);
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  switch (type) {
    case "object":
      return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, sampleFromSchema(v)]));
    case "array":
      return Array.from({ length: s.minItems ?? 0 }, () => sampleFromSchema(s.items ?? {}));
    case "number":
    case "integer":
      return s.minimum ?? 0;
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return "";
  }
}
