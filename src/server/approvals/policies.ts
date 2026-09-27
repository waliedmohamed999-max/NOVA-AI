import { z } from "zod";
import type { ContentFormat } from "@/generated/prisma/enums";
import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";

/**
 * Human approval policies in business language (Settings → Approval rules), stored in
 * WorkspaceSettings.policies. They sit on top of the per-topic ApprovalPolicy rows:
 *
 *  - Content:  "always ask me" or "auto-publish these post types".
 *  - Sales:    "AI may reply automatically" (the send_message ApprovalPolicy row), but pricing, discounts, proposals and contract language
 *              ALWAYS need approval (locked — not configurable).
 *  - Messages: automatic replies only for safe FAQ intents (opening hours, location, services…).
 */
export const SAFE_FAQ_INTENTS = ["greeting", "opening_hours", "location", "services_info", "contact_details", "booking_info"] as const;
export const REPLY_INTENTS = [...SAFE_FAQ_INTENTS, "pricing", "proposal", "complaint", "other"] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

/** Topics that always need a human, whatever the settings say. */
export const LOCKED_SALES_TOPICS = ["discount", "custom_pricing", "proposal", "contract_promise"] as const;

export const AUTO_FORMATS = ["POST", "CAROUSEL", "STORY", "REEL", "SHORT_VIDEO", "LINKEDIN_POST"] as const satisfies readonly ContentFormat[];

export const policiesSchema = z.object({
  content: z.object({ mode: z.enum(["always", "auto_selected"]), autoFormats: z.array(z.enum(AUTO_FORMATS)).max(6) }),
  messages: z.object({ autoReplyFaq: z.boolean(), safeIntents: z.array(z.enum(SAFE_FAQ_INTENTS)).max(SAFE_FAQ_INTENTS.length) }),
});
export type Policies = z.infer<typeof policiesSchema>;

export const DEFAULT_POLICIES: Policies = {
  content: { mode: "always", autoFormats: [] },
  messages: { autoReplyFaq: false, safeIntents: ["greeting", "opening_hours", "location", "contact_details"] },
};

/** Stored JSON may be partial or from an older version — fall back per section, never throw. */
export function parsePolicies(raw: unknown): Policies {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pick = <K extends keyof Policies>(k: K): Policies[K] => {
    const s = policiesSchema.shape[k].safeParse(r[k]);
    return (s.success ? s.data : DEFAULT_POLICIES[k]) as Policies[K];
  };
  return { content: pick("content"), messages: pick("messages") };
}

export async function loadPolicies(scope: TenantScope) {
  const s = await db.workspaceSettings.findFirst({ where: scope, select: { policies: true, requireContentApproval: true } });
  const p = parsePolicies(s?.policies);
  // Older workspaces only had the on/off switch: "off" meant everything auto-publishes.
  if (s && !s.requireContentApproval && p.content.mode === "always" && !(s.policies as { content?: unknown } | null)?.content) {
    return { ...p, content: { mode: "auto_selected" as const, autoFormats: [...AUTO_FORMATS] } };
  }
  return p;
}

export function contentNeedsApproval(p: Policies, format: ContentFormat | string) {
  return p.content.mode === "always" || !p.content.autoFormats.includes(format as (typeof AUTO_FORMATS)[number]);
}

/**
 * What may happen to an AI-drafted sales reply under the policies (before autonomy level / channel checks):
 * "approval" = a human must approve; "auto" = may go out automatically.
 */
export function salesReplyPolicy(p: Policies & { salesAutoReply: boolean }, draft: { sensitiveTopics: string[]; intent?: ReplyIntent | null; inbound?: boolean }): { decision: "approval" | "auto"; reason: string } {
  const locked = draft.sensitiveTopics.filter((t) => (LOCKED_SALES_TOPICS as readonly string[]).includes(t));
  if (locked.length) return { decision: "approval", reason: `locked:${locked.join(",")}` };
  if (draft.intent === "pricing" || draft.intent === "proposal") return { decision: "approval", reason: `locked:${draft.intent}` };
  if (draft.inbound) {
    // Replies to customer messages: only safe FAQ intents may be automatic.
    if (!p.messages.autoReplyFaq) return { decision: "approval", reason: "messages:manual" };
    if (!draft.intent || !(p.messages.safeIntents as readonly string[]).includes(draft.intent)) return { decision: "approval", reason: `messages:intent_not_safe:${draft.intent ?? "unknown"}` };
    return { decision: "auto", reason: `messages:safe_faq:${draft.intent}` };
  }
  return p.salesAutoReply ? { decision: "auto", reason: "sales:auto_reply" } : { decision: "approval", reason: "sales:manual" };
}
