"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import type { TenantContext } from "@/server/context";
import { customerContext, conversationPage, listConversations, rejectDraft, sendAttachment, sendDraft, sendReply, sendTemplateMessage } from "@/server/whatsapp/inbox";
import { prepareDraft } from "@/server/whatsapp/replies";
import { setOptOut } from "@/server/whatsapp/service";
import { completeEmbeddedSignup, disconnectNumber, refreshNumber } from "@/server/whatsapp/numbers";
import { deleteTemplateDraft, draftTemplateText, previewTemplate, saveTemplateDraft, submitTemplate, syncTemplates, templateSchema } from "@/server/whatsapp/templates";
import { audienceSchema, campaignAnalytics, campaignSchema, cancelCampaign, pauseCampaign, previewAudience, resumeCampaign, saveCampaign, submitCampaign } from "@/server/whatsapp/campaigns";
import { prepareDueFollowups, prepareFollowup } from "@/server/whatsapp/followups";
import { addSuppression, removeSuppression, saveWhatsAppSettings, settingsSchema } from "@/server/whatsapp/settings";

/** Every action: signed-in, tenant-scoped (scope from the session — never from input), RBAC-checked, validated. */

const scopeOf = (ctx: TenantContext) => ({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
const actorOf = (ctx: TenantContext) => ({ userId: ctx.user.id, label: ctx.user.name ?? ctx.user.email });
const id = z.string().min(1).max(40);

// ── Connection ──

export const completeSignupAction = tenantAction({ name: "whatsapp.signup", permission: "integrations:manage", rateLimit: 10 }, z.object({ code: z.string().min(4).max(2000), phoneNumberId: z.string().regex(/^\d{5,25}$/), wabaId: z.string().regex(/^\d{5,25}$/) }), async (input, ctx) => {
  const n = await completeEmbeddedSignup(scopeOf(ctx), actorOf(ctx), input);
  revalidatePath("/whatsapp");
  return { display: n.displayPhone, name: n.verifiedName };
});

export const refreshNumberAction = tenantAction({ name: "whatsapp.refresh_number", permission: "integrations:manage", rateLimit: 20 }, z.object({ id }), async ({ id }, ctx) => refreshNumber(scopeOf(ctx), id));

export const disconnectNumberAction = tenantAction({ name: "whatsapp.disconnect", permission: "integrations:manage" }, z.object({ id }), async ({ id }, ctx) => {
  await disconnectNumber(scopeOf(ctx), id, actorOf(ctx));
  revalidatePath("/whatsapp");
  return { ok: true };
});

// ── Inbox ──

export const listConversationsAction = tenantAction(
  { name: "whatsapp.list", permission: "leads:read" },
  z.object({ filter: z.enum(["all", "unread", "needs_human", "drafts"]).default("all"), cursor: z.string().max(40).nullable().optional(), q: z.string().max(80).nullable().optional() }),
  async (input, ctx) => listConversations(scopeOf(ctx), input),
);

export const conversationAction = tenantAction({ name: "whatsapp.thread", permission: "leads:read" }, z.object({ id, before: z.string().max(40).nullable().optional() }), async ({ id, before }, ctx) => conversationPage(scopeOf(ctx), id, before, ctx.can("leads:manage")));

export const customerContextAction = tenantAction({ name: "whatsapp.context", permission: "leads:read" }, z.object({ leadId: id }), async ({ leadId }, ctx) => customerContext(scopeOf(ctx), leadId));

export const sendReplyAction = tenantAction({ name: "whatsapp.reply", permission: "leads:manage", rateLimit: 60 }, z.object({ conversationId: id, body: z.string().trim().min(1).max(4096) }), async ({ conversationId, body }, ctx) => {
  const m = await sendReply(scopeOf(ctx), conversationId, body, actorOf(ctx));
  return { id: m.id };
});

export const sendDraftAction = tenantAction({ name: "whatsapp.send_draft", permission: "leads:manage", rateLimit: 60 }, z.object({ messageId: id, body: z.string().trim().min(1).max(4096).optional() }), async ({ messageId, body }, ctx) => {
  const m = await sendDraft(scopeOf(ctx), messageId, actorOf(ctx), body);
  return { id: m.id };
});

export const rejectDraftAction = tenantAction({ name: "whatsapp.reject_draft", permission: "leads:manage" }, z.object({ messageId: id }), async ({ messageId }, ctx) => {
  await rejectDraft(scopeOf(ctx), messageId, actorOf(ctx));
  return { ok: true };
});

export const prepareDraftAction = tenantAction({ name: "whatsapp.prepare_draft", permission: "leads:manage", rateLimit: 20 }, z.object({ conversationId: id }), async ({ conversationId }, ctx) => {
  const m = await prepareDraft(scopeOf(ctx), conversationId);
  return { id: m.id, body: m.body };
});

export const sendTemplateAction = tenantAction(
  { name: "whatsapp.send_template", permission: "leads:manage", rateLimit: 30 },
  z.object({ conversationId: id, templateId: id, overrides: z.record(z.string().regex(/^\d+$/), z.string().max(200)).default({}) }),
  async ({ conversationId, templateId, overrides }, ctx) => {
    const m = await sendTemplateMessage(scopeOf(ctx), conversationId, templateId, actorOf(ctx), overrides);
    return { id: m.id };
  },
);

export const sendAttachmentAction = tenantAction({ name: "whatsapp.send_media", permission: "leads:manage", rateLimit: 20 }, z.object({ conversationId: id, fileId: id, caption: z.string().max(1024).optional() }), async ({ conversationId, fileId, caption }, ctx) => {
  const m = await sendAttachment(scopeOf(ctx), conversationId, fileId, caption, actorOf(ctx));
  return { id: m.id };
});

export const setOptOutAction = tenantAction({ name: "whatsapp.opt_out", permission: "leads:manage" }, z.object({ leadId: id, optOut: z.boolean() }), async ({ leadId, optOut }, ctx) => {
  await setOptOut(scopeOf(ctx), leadId, optOut, { type: "USER", id: ctx.user.id, label: actorOf(ctx).label }, "manual");
  return { ok: true };
});

// ── Templates ──

export const saveTemplateAction = tenantAction({ name: "whatsapp.template_save", permission: "campaign:manage" }, z.object({ id: id.optional(), template: z.any() }), async ({ id, template }, ctx) => {
  const row = await saveTemplateDraft(scopeOf(ctx), templateSchema.parse(template), actorOf(ctx), id);
  revalidatePath("/whatsapp/templates");
  return { id: row.id };
});

export const deleteTemplateAction = tenantAction({ name: "whatsapp.template_delete", permission: "campaign:manage" }, z.object({ id }), async ({ id }, ctx) => {
  await deleteTemplateDraft(scopeOf(ctx), id);
  revalidatePath("/whatsapp/templates");
  return { ok: true };
});

export const submitTemplateAction = tenantAction({ name: "whatsapp.template_submit", permission: "campaign:manage", rateLimit: 10 }, z.object({ id }), async ({ id }, ctx) => {
  const row = await submitTemplate(scopeOf(ctx), id, actorOf(ctx));
  revalidatePath("/whatsapp/templates");
  return { status: row.status };
});

export const syncTemplatesAction = tenantAction({ name: "whatsapp.template_sync", permission: "campaign:manage", rateLimit: 10 }, z.object({}), async (_i, ctx) => {
  const r = await syncTemplates(scopeOf(ctx));
  revalidatePath("/whatsapp/templates");
  return r;
});

export const previewTemplateAction = tenantAction({ name: "whatsapp.template_preview", permission: "leads:read" }, z.object({ id, leadId: id.nullable() }), async ({ id, leadId }, ctx) => previewTemplate(scopeOf(ctx), id, leadId));

export const draftTemplateTextAction = tenantAction({ name: "whatsapp.template_ai", permission: "campaign:manage", rateLimit: 10 }, z.object({ objective: z.string().trim().min(2).max(200), topic: z.string().max(200).optional() }), async (input, ctx) =>
  draftTemplateText(scopeOf(ctx), { ...input, locale: ctx.organization.locale === "ar" ? "ar" : "en" }),
);

// ── Campaigns ──

export const previewAudienceAction = tenantAction({ name: "whatsapp.audience", permission: "campaign:manage", rateLimit: 60 }, z.object({ audience: audienceSchema }), async ({ audience }, ctx) => previewAudience(scopeOf(ctx), audience));

export const saveCampaignAction = tenantAction({ name: "whatsapp.campaign_save", permission: "campaign:manage" }, z.object({ id: id.optional(), campaign: campaignSchema }), async ({ id, campaign }, ctx) => {
  const row = await saveCampaign(scopeOf(ctx), campaign, actorOf(ctx), id);
  return { id: row.id };
});

export const submitCampaignAction = tenantAction({ name: "whatsapp.campaign_submit", permission: "campaign:manage", rateLimit: 10 }, z.object({ id, sendNow: z.boolean().default(false) }), async ({ id, sendNow }, ctx) => {
  const r = await submitCampaign(scopeOf(ctx), id, actorOf(ctx), { sendNow });
  revalidatePath("/whatsapp/campaigns");
  return r;
});

export const campaignControlAction = tenantAction({ name: "whatsapp.campaign_control", permission: "campaign:manage" }, z.object({ id, op: z.enum(["pause", "resume", "cancel"]) }), async ({ id, op }, ctx) => {
  const s = scopeOf(ctx);
  if (op === "pause") await pauseCampaign(s, id, actorOf(ctx));
  else if (op === "resume") await resumeCampaign(s, id, actorOf(ctx));
  else await cancelCampaign(s, id, actorOf(ctx));
  revalidatePath(`/whatsapp/campaigns/${id}`);
  return { ok: true };
});

export const campaignAnalyticsAction = tenantAction({ name: "whatsapp.campaign_stats", permission: "analytics:read" }, z.object({ id }), async ({ id }, ctx) => campaignAnalytics(scopeOf(ctx), id));

// ── Follow-ups ──

export const prepareFollowupAction = tenantAction({ name: "whatsapp.followup", permission: "leads:manage", rateLimit: 30 }, z.object({ leadId: id }), async ({ leadId }, ctx) => prepareFollowup(scopeOf(ctx), leadId, actorOf(ctx)));

export const prepareDueFollowupsAction = tenantAction({ name: "whatsapp.followups_due", permission: "leads:manage", rateLimit: 5 }, z.object({}), async (_i, ctx) => {
  const r = await prepareDueFollowups(scopeOf(ctx), actorOf(ctx));
  revalidatePath("/whatsapp/followups");
  return r;
});

// ── Settings / suppression ──

export const saveSettingsAction = tenantAction({ name: "whatsapp.settings", permission: "settings:manage" }, settingsSchema, async (input, ctx) => saveWhatsAppSettings(scopeOf(ctx), input, actorOf(ctx)));

/** Onboarding preference ("what should NOVA do with WhatsApp?") — preferences only, never switches on sending. */
export const saveGoalsAction = tenantAction({ name: "whatsapp.goals", permission: "integrations:manage" }, z.object({ goals: settingsSchema.shape.goals.unwrap() }), async ({ goals }, ctx) => saveWhatsAppSettings(scopeOf(ctx), { goals }, actorOf(ctx)));

export const addSuppressionAction = tenantAction({ name: "whatsapp.suppress", permission: "leads:manage" }, z.object({ phone: z.string().min(6).max(30), reason: z.enum(["blocked", "invalid", "manual"]), note: z.string().max(200).nullable().optional() }), async ({ phone, reason, note }, ctx) => {
  await addSuppression(scopeOf(ctx), phone, reason, note ?? null, actorOf(ctx));
  revalidatePath("/whatsapp/settings");
  return { ok: true };
});

export const removeSuppressionAction = tenantAction({ name: "whatsapp.unsuppress", permission: "leads:manage" }, z.object({ id }), async ({ id }, ctx) => {
  await removeSuppression(scopeOf(ctx), id, actorOf(ctx));
  revalidatePath("/whatsapp/settings");
  return { ok: true };
});
