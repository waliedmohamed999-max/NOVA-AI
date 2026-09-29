import { z } from "zod";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { UserFacingError } from "../errors";
import { audit } from "../audit";
import { aiAvailability, aiStructured } from "../ai";
import { brainMeta, compactContext, retrieveCompanyContext } from "../knowledge/company-context";
import { requiresApproval, addLeadEvent } from "../sales/service";
import { decideReply, parseLevel, windowState, type WaIntent } from "./policy";
import { sendWhatsApp } from "./service";

/**
 * Replies to inbound WhatsApp messages. Token-efficient order: local intent rules → an approved Company
 * Brain fact / FAQ (no model) → only then AI, with a small selective context (never the whole brain).
 * Whether anything is sent is decided by the workspace level + policy (see policy.ts); AI-written text is
 * always a draft for a human. Drafts are OUTBOUND messages with status DRAFT and aiDrafted=true.
 */

type Answer = { text: string; source: "brain" | "ai"; ref: string | null };

async function brainAnswer(scope: TenantScope, question: string): Promise<{ answer: Answer | null; ctx: Awaited<ReturnType<typeof retrieveCompanyContext>> }> {
  const ctx = await retrieveCompanyContext(scope, { purpose: "support", query: question, budget: "small", topK: 3 });
  if (ctx.factMatch) return { answer: { text: ctx.factMatch.value, source: "brain", ref: `fact:${ctx.factMatch.key}` }, ctx };
  if (ctx.faqMatch && ctx.faqMatch.coverage >= 0.6) return { answer: { text: ctx.faqMatch.answer, source: "brain", ref: `faq:${ctx.faqMatch.question}` }, ctx };
  return { answer: null, ctx };
}

const replySchema = z.object({ reply: z.string().max(1200), confident: z.boolean() });

async function aiDraft(scope: TenantScope, question: string, ctx: Awaited<ReturnType<typeof retrieveCompanyContext>>, locale: "ar" | "en"): Promise<Answer | null> {
  if (!aiAvailability().configured) return null;
  const res = await aiStructured(
    { organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "SALES_AGENT" },
    {
      task: "SALES",
      schemaName: "whatsapp_reply",
      schema: replySchema,
      maxTokens: 350,
      brain: brainMeta(ctx),
      system: [
        "You draft a short WhatsApp reply for this company's customer. Use ONLY the company knowledge below.",
        "Never promise prices, discounts, refunds, delivery dates, contract or legal terms that are not listed. If unsure, say a team member will follow up.",
        `Write in ${locale === "ar" ? "Arabic" : "English"}, warm and brief (max 3 sentences).`,
        "",
        compactContext(ctx),
      ].join("\n"),
      prompt: `Customer message: ${question.slice(0, 1000)}`,
      offline: () => ({ reply: "", confident: false }),
    },
  );
  const text = res.data.reply.trim();
  return text ? { text, source: "ai", ref: res.offline ? "offline" : "ai" } : null;
}

/** Job body for an inbound message (idempotent: a message is answered/drafted at most once). */
export async function handleReply(scope: TenantScope, messageId: string) {
  const t = tenantDb(scope);
  const inbound = await t.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { lead: true } } } });
  if (!inbound || inbound.direction !== "INBOUND") return { skipped: true };
  const conv = inbound.conversation;
  const lead = conv.lead;
  // Already handled (a draft or reply exists after this message)?
  const after = await t.message.findFirst({ where: { conversationId: conv.id, direction: "OUTBOUND", createdAt: { gte: inbound.createdAt } }, select: { id: true } });
  if (after || !lead) return { skipped: true };

  const settings = await db.workspaceSettings.findFirst({ where: scope, select: { whatsappAutoReply: true, whatsappConfig: true } });
  const level = parseLevel(settings?.whatsappAutoReply);
  const cfg = (settings?.whatsappConfig ?? {}) as { safeIntents?: string[] };
  const intent = (inbound.intent ?? "other") as WaIntent;
  const org = await db.organization.findUniqueOrThrow({ where: { id: scope.organizationId }, select: { locale: true } });
  const locale = org.locale === "ar" ? "ar" : "en";

  let answer: Answer | null = null;
  if (level !== "OFF" && intent !== "opt_out" && intent !== "opt_in" && inbound.body.trim() && !inbound.body.startsWith("[")) {
    const b = await brainAnswer(scope, inbound.body);
    answer = b.answer ?? (await aiDraft(scope, inbound.body, b.ctx, locale));
  }
  const policyAllowsAuto = level === "CUSTOM" ? !(await requiresApproval(scope, "send_message")) : false;
  const decision = decideReply({ level, intent, answer: answer?.source ?? null, windowOpen: windowState(conv.lastInboundAt).open, optedOut: lead.whatsappOptOut, safeIntents: cfg.safeIntents, policyAllowsAuto });

  await db.conversation.update({ where: { id: conv.id }, data: { needsHuman: decision.needsHuman } });
  if (decision.action === "none" || !answer) return { decision };

  const draft = await t.message.create({
    data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, conversationId: conv.id, direction: "OUTBOUND", authorType: "AGENT", body: answer.text.slice(0, 4096), status: "DRAFT", aiDrafted: true, intent },
  });
  if (decision.action === "draft") return { decision, draftId: draft.id };

  // SAFE_AUTO / allowed CUSTOM: an approved brain answer to a safe question inside the 24h window.
  try {
    const r = await sendWhatsApp(scope, lead.phone ?? "", { body: draft.body });
    await t.message.update({ where: { id: draft.id }, data: { status: "SENT", sentAt: new Date(), externalId: r.externalId, deliveryStatus: "accepted" } });
    await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
    await addLeadEvent(scope, lead.id, { type: "MESSAGE_SENT", title: "NOVA answered on WhatsApp (automatic, safe FAQ)", body: draft.body.slice(0, 2000), actor: { type: "AGENT", label: "NOVA" }, data: { intent, source: answer.ref } });
    await audit({ ...scope, actorType: "AGENT", actorLabel: "NOVA", action: "whatsapp.auto_reply", entityType: "Message", entityId: draft.id, summary: `Automatic WhatsApp reply (${intent}) to ${lead.name}`, metadata: { source: answer.ref } });
    return { decision, sentId: draft.id };
  } catch (err) {
    // Couldn't send (window closed meanwhile, no number…): keep it as a draft for a human.
    await db.conversation.update({ where: { id: conv.id }, data: { needsHuman: true } });
    return { decision: { ...decision, action: "draft" as const, reason: err instanceof UserFacingError ? err.code : "send_failed" }, draftId: draft.id };
  }
}

/** "Prepare with AI" in the inbox: a fresh draft for the latest customer message (brain first). */
export async function prepareDraft(scope: TenantScope, conversationId: string) {
  const t = tenantDb(scope);
  const conv = await t.conversation.findUnique({ where: { id: conversationId } });
  if (!conv || conv.channel !== "WHATSAPP") throw new UserFacingError("item_not_found");
  const last = await t.message.findFirst({ where: { conversationId, direction: "INBOUND" }, orderBy: { createdAt: "desc" } });
  if (!last) throw new UserFacingError("whatsapp_nothing_to_answer");
  const org = await db.organization.findUniqueOrThrow({ where: { id: scope.organizationId }, select: { locale: true } });
  const b = await brainAnswer(scope, last.body);
  const answer = b.answer ?? (await aiDraft(scope, last.body, b.ctx, org.locale === "ar" ? "ar" : "en"));
  if (!answer) throw new UserFacingError(aiAvailability().configured ? "whatsapp_no_answer" : "ai_not_configured");
  await t.message.deleteMany({ where: { conversationId, direction: "OUTBOUND", status: "DRAFT", aiDrafted: true } });
  return t.message.create({
    data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, conversationId, direction: "OUTBOUND", authorType: "AGENT", body: answer.text.slice(0, 4096), status: "DRAFT", aiDrafted: true, intent: last.intent },
  });
}
