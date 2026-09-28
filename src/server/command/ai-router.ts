import { z } from "zod";
import { aiStructured, contentAiConfigured } from "../ai";
import type { TenantScope } from "../db/tenant";
import { INTENTS, type IntentKey } from "./registry";

/**
 * AI fallback for commands the local parser doesn't know. The model only translates text into a
 * structured command from the allowlist — it never executes anything. The caller re-validates
 * intent, permission, tenant, parameters and approval rules.
 */
const ALLOWED = INTENTS.map((i) => i.key).filter((k) => k !== "delete_anything") as [IntentKey, ...IntentKey[]];

export const routedCommandSchema = z.object({
  intent: z.enum([...ALLOWED, "unknown"] as [string, ...string[]]),
  entities: z.object({
    name: z.string().max(120).nullable(),
    count: z.number().int().min(1).max(50).nullable(),
    date: z.enum(["today", "tomorrow", "next_week"]).nullable(),
    platform: z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "TIKTOK"]).nullable(),
    topic: z.string().max(200).nullable(),
    body: z.string().max(1000).nullable(),
  }),
  confidence: z.number().min(0).max(1),
});
export type RoutedCommand = z.infer<typeof routedCommandSchema>;

export function aiRouterAvailable() {
  // The offline development provider can't understand free text — it would only pretend to.
  return contentAiConfigured();
}

const DESCRIPTIONS: Partial<Record<IntentKey, string>> = {
  ask_question: "a question answerable from the company's own knowledge (products, prices, policies, FAQs)",
  followups_today: "which customers need a follow-up today",
  sales_summary: "summary of sales / pipeline / deals",
  prepare_week_content: "write N social posts / a week of content",
  create_followup: "schedule a follow-up with a named customer",
  create_lead: "add a new customer / lead",
  open_entity: "open a specific customer or company by name",
};

export async function routeWithAi(scope: TenantScope, text: string): Promise<RoutedCommand> {
  const res = await aiStructured(
    { organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "SOCIAL_MANAGER" },
    {
      task: "CLASSIFICATION",
      realOnly: true,
      schemaName: "command_route",
      schema: routedCommandSchema,
      system: [
        "Translate a business owner's command (Arabic or English, any dialect) into ONE structured command for a business app.",
        "Pick the intent only from the allowed list; use \"unknown\" when none fits or the request is ambiguous. Never invent intents.",
        "Extract only entities that are literally present in the text. Do not guess names, dates or numbers.",
        `Allowed intents: ${ALLOWED.map((k) => (DESCRIPTIONS[k] ? `${k} (${DESCRIPTIONS[k]})` : k)).join(", ")}.`,
        "confidence: how sure you are that the intent is right (0..1).",
      ].join("\n"),
      prompt: text.slice(0, 1000),
      maxTokens: 300,
    },
  );
  return res.data;
}
