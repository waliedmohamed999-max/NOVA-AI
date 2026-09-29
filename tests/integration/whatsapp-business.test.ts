import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { setWaTransport, verifySignature, type WaRequest } from "@/server/whatsapp/cloud-api";
import { processWebhook, setOptOut } from "@/server/whatsapp/service";
import { handleReply } from "@/server/whatsapp/replies";
import { conversationPage, listConversations, sendDraft, sendReply, sendTemplateMessage } from "@/server/whatsapp/inbox";
import { approveWhatsAppCampaign, campaignAnalytics, pauseCampaign, previewAudience, resumeCampaign, runCampaignBatch, saveCampaign, submitCampaign } from "@/server/whatsapp/campaigns";
import { prepareFollowup } from "@/server/whatsapp/followups";
import { saveTemplateDraft, templateSchema } from "@/server/whatsapp/templates";
import { saveWhatsAppSettings } from "@/server/whatsapp/settings";
import { decideApproval } from "@/server/approvals/service";
import { createLead } from "@/server/sales/service";

/** WhatsApp Business: webhook → CRM, 24h rule, templates, campaigns, replies, follow-ups. No real sends. */

const calls: WaRequest[] = [];
let throttleNext = 0;
beforeEach(() => {
  calls.length = 0;
  throttleNext = 0;
  setWaTransport({
    async call<T>(r: WaRequest) {
      calls.push(r);
      const to = (r.body as { to?: string } | undefined)?.to ?? "";
      if (r.path.endsWith("/messages")) {
        if (throttleNext > 0) {
          throttleNext--;
          const { ProviderError } = await import("@/server/integrations/types");
          throw new ProviderError("rate_limited", "Provider request failed (429)", 429, '{"error":{"code":130429}}');
        }
        if (to.endsWith("0000")) {
          const { ProviderError } = await import("@/server/integrations/types");
          throw new ProviderError("unknown", "Provider request failed (400)", 400, '{"error":{"code":131026}}');
        }
        return { messages: [{ id: `wamid.${calls.length}.${Math.random().toString(36).slice(2)}` }] } as T;
      }
      return {} as T;
    },
    async download() {
      return { data: Buffer.from("x"), mime: "image/jpeg" };
    },
  });
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "EAAG-test-token");
  vi.stubEnv("WHATSAPP_APP_SECRET", "0123456789abcdef0123456789abcdef");
});
afterEach(() => {
  setWaTransport(null);
  vi.unstubAllEnvs();
});

const user = (t: Awaited<ReturnType<typeof makeTenant>>) => ({ userId: t.user.id, label: "Owner" });
let seq = 0;
const inbound = (phoneNumberId: string, from: string, text: string, opts: { id?: string; at?: Date; name?: string } = {}) => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: from, profile: { name: opts.name ?? "Hana" } }], messages: [{ from, id: opts.id ?? `wamid.in.${++seq}.${Date.now()}`, timestamp: String(Math.floor((opts.at ?? new Date()).getTime() / 1000)), type: "text", text: { body: text } }] } }] }],
});
const status = (phoneNumberId: string, id: string, s: string) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id, status: s, recipient_id: "x", timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });

async function connected(name = "WA Co") {
  const t = await makeTenant(name);
  const pn = `PN-${t.organization.id.slice(-8)}`;
  await db.whatsAppNumber.create({ data: { ...t.scope, phoneNumberId: pn, displayPhone: "+966 50 000 1111", verifiedName: name, messagingLimit: "TIER_1K" } });
  return { t, pn };
}

async function approvedTemplate(t: Awaited<ReturnType<typeof makeTenant>>, name = "offer_update") {
  const row = await saveTemplateDraft(t.scope, templateSchema.parse({ name, language: "en_US", category: "MARKETING", body: "Hi {{1}}, our new offer is live.", variables: { "1": "customer_name" } }), user(t));
  return db.whatsAppTemplate.update({ where: { id: row.id }, data: { status: "APPROVED" } });
}

describe("webhook → CRM", () => {
  it("verifies the signature (constant time) — anything unsigned is rejected", () => {
    const body = JSON.stringify(inbound("PN", "966500000001", "hi"));
    const sig = `sha256=${createHmac("sha256", "0123456789abcdef0123456789abcdef").update(body).digest("hex")}`;
    expect(verifySignature(body, sig)).toBe(true);
    expect(verifySignature(body, "sha256=deadbeef")).toBe(false);
    expect(verifySignature(body + " ", sig)).toBe(false);
    expect(verifySignature(body, null)).toBe(false);
  });

  it("new number → one Lead + Conversation + Message; redelivery and reformatted phones never duplicate", async () => {
    const { t, pn } = await connected();
    const payload = inbound(pn, "966501112222", "Hello", { id: "wamid.dup.1", name: "Hana Ali" });
    expect(await processWebhook(payload)).toMatchObject({ received: 1 });
    expect(await processWebhook(payload)).toMatchObject({ received: 0 });
    const leads = await db.lead.findMany({ where: t.scope });
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ name: "Hana Ali", phoneDigits: "966501112222", channel: "WHATSAPP", source: "WhatsApp" });
    const events = await db.leadEvent.findMany({ where: { leadId: leads[0].id, type: "MESSAGE_RECEIVED" } });
    expect(events[0].title).toBe("Started a conversation on WhatsApp");

    // An existing CRM contact typed with spaces/"+" is recognized (digits maintained by the database).
    const existing = await createLead(t.scope, { name: "Omar", phone: "+966 50 333 4444" }, { type: "SYSTEM", label: "t" }, { qualify: false });
    await processWebhook(inbound(pn, "966503334444", "Hi again"));
    expect(await db.lead.count({ where: t.scope })).toBe(2);
    const conv = await db.conversation.findFirstOrThrow({ where: { leadId: existing.id } });
    expect(conv).toMatchObject({ channel: "WHATSAPP", unreadCount: 1 });
    expect(conv.lastInboundAt).not.toBeNull();
    expect(await db.message.count({ where: { conversationId: conv.id } })).toBe(1);
  });

  it("routes only by our phone_number_id mapping: unknown numbers are ignored, tenants never mix", async () => {
    const a = await connected("Tenant A");
    const b = await connected("Tenant B");
    expect(await processWebhook(inbound("PN-UNKNOWN", "966509990000", "hi"))).toMatchObject({ received: 0 });
    await processWebhook(inbound(a.pn, "966508887777", "for A"));
    expect(await db.lead.count({ where: a.t.scope })).toBe(1);
    expect(await db.lead.count({ where: b.t.scope })).toBe(0);
    const inbox = await listConversations(b.t.scope);
    expect(inbox.items).toHaveLength(0);
  });

  it("delivery statuses update the same message forward only (sent → delivered → read; no regressions, no duplicates)", async () => {
    const { t, pn } = await connected();
    await processWebhook(inbound(pn, "966501230000".replace(/0000$/, "1234"), "hi"));
    const conv = await db.conversation.findFirstOrThrow({ where: t.scope });
    const m = await sendReply(t.scope, conv.id, "Welcome!", user(t));
    await processWebhook(status(pn, m.externalId!, "delivered"));
    await processWebhook(status(pn, m.externalId!, "read"));
    await processWebhook(status(pn, m.externalId!, "delivered")); // late, out of order
    const after = await db.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.deliveryStatus).toBe("read");
    expect(after.readAt).not.toBeNull();
    expect(after.deliveredAt).not.toBeNull();
    expect(await db.message.count({ where: { conversationId: conv.id, direction: "OUTBOUND" } })).toBe(1);
  });
});

describe("24-hour customer-service window", () => {
  it("free text only inside the window; outside it an APPROVED template is required", async () => {
    const { t, pn } = await connected();
    await processWebhook(inbound(pn, "966505556666", "hi", { at: new Date(Date.now() - 25 * 3600_000) }));
    const conv = await db.conversation.findFirstOrThrow({ where: t.scope });
    const page = await conversationPage(t.scope, conv.id);
    expect(page.conversation.window.open).toBe(false);
    await expect(sendReply(t.scope, conv.id, "Hello?", user(t))).rejects.toMatchObject({ code: "whatsapp_window_closed" });

    const draft = await saveTemplateDraft(t.scope, templateSchema.parse({ name: "follow_up_note", language: "en_US", category: "UTILITY", body: "Hi {{1}}, just checking in.", variables: { "1": "customer_name" } }), user(t));
    await expect(sendTemplateMessage(t.scope, conv.id, draft.id, user(t))).rejects.toMatchObject({ code: "whatsapp_template_not_approved" });
    await db.whatsAppTemplate.update({ where: { id: draft.id }, data: { status: "APPROVED" } });
    const sent = await sendTemplateMessage(t.scope, conv.id, draft.id, user(t));
    expect(sent).toMatchObject({ messageType: "template", templateName: "follow_up_note", body: "Hi Hana, just checking in." });
    expect(calls.at(-1)!.body).toMatchObject({ type: "template", template: { name: "follow_up_note" } });
  });

  it("templates: variables must be sequential and mapped", () => {
    expect(() => templateSchema.parse({ name: "x", language: "en", category: "MARKETING", body: "Hi {{2}}", variables: { "2": "customer_name" } })).toThrow();
    expect(() => templateSchema.parse({ name: "x", language: "en", category: "MARKETING", body: "Hi {{1}}", variables: {} })).toThrow();
    expect(() => templateSchema.parse({ name: "Bad Name", language: "en", category: "MARKETING", body: "Hi" })).toThrow();
  });
});

describe("replies: brain first, AI last, policy decides", () => {
  it("SAFE_AUTO answers a safe FAQ from the approved brain automatically; a pricing question stays a draft for a human", async () => {
    const { t, pn } = await connected();
    await db.brainFaq.create({ data: { ...t.scope, question: "What are your working hours?", answer: "We are open Sunday to Thursday, 9am to 6pm.", status: "approved" } });
    await saveWhatsAppSettings(t.scope, { level: "SAFE_AUTO" }, user(t));
    await processWebhook(inbound(pn, "966507778888", "What are your working hours?"));
    const msg = await db.message.findFirstOrThrow({ where: { organizationId: t.organization.id, direction: "INBOUND" } });
    expect(msg.intent).toBe("opening_hours");
    await handleReply(t.scope, msg.id);
    const auto = await db.message.findFirstOrThrow({ where: { conversationId: msg.conversationId, direction: "OUTBOUND" } });
    expect(auto).toMatchObject({ status: "SENT", aiDrafted: true, body: "We are open Sunday to Thursday, 9am to 6pm." });
    expect(await db.auditLog.count({ where: { organizationId: t.organization.id, action: "whatsapp.auto_reply" } })).toBe(1);

    await processWebhook(inbound(pn, "966507778888", "How much is the website package?"));
    const q = await db.message.findFirstOrThrow({ where: { organizationId: t.organization.id, direction: "INBOUND", intent: "pricing" } });
    await handleReply(t.scope, q.id);
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: q.conversationId } });
    expect(conv.needsHuman).toBe(true);
    expect(await db.message.count({ where: { conversationId: q.conversationId, direction: "OUTBOUND", status: "SENT" } })).toBe(1); // only the safe one
  });

  it("OFF makes no draft and no AI call; with AI disabled nothing calls a model", async () => {
    vi.stubEnv("AI_OFFLINE_MODE", "false");
    const { t, pn } = await connected();
    await processWebhook(inbound(pn, "966501212121", "Tell me about your company history please"));
    const msg = await db.message.findFirstOrThrow({ where: { organizationId: t.organization.id, direction: "INBOUND" } });
    await handleReply(t.scope, msg.id);
    expect(await db.message.count({ where: { conversationId: msg.conversationId, direction: "OUTBOUND" } })).toBe(0);
    expect(await db.aiRun.count({ where: { organizationId: t.organization.id } })).toBe(0);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: msg.conversationId } })).needsHuman).toBe(true);

    await saveWhatsAppSettings(t.scope, { level: "OFF" }, user(t));
    await processWebhook(inbound(pn, "966501212121", "What are your working hours?"));
    const m2 = await db.message.findFirstOrThrow({ where: { organizationId: t.organization.id, direction: "INBOUND", intent: "opening_hours" } });
    await handleReply(t.scope, m2.id);
    expect(await db.message.count({ where: { conversationId: m2.conversationId, direction: "OUTBOUND" } })).toBe(0);
  });

  it("a human sends (or edits) a NOVA draft; it is recorded as AI-assisted", async () => {
    const { t, pn } = await connected();
    await db.brainFaq.create({ data: { ...t.scope, question: "Where are you located?", answer: "Riyadh, Olaya Street.", status: "approved" } });
    await processWebhook(inbound(pn, "966504445555", "Where are you located?"));
    const msg = await db.message.findFirstOrThrow({ where: { organizationId: t.organization.id, direction: "INBOUND" } });
    await handleReply(t.scope, msg.id); // DRAFT level (default)
    const draft = await db.message.findFirstOrThrow({ where: { conversationId: msg.conversationId, status: "DRAFT" } });
    const sent = await sendDraft(t.scope, draft.id, user(t), "Riyadh, Olaya Street — welcome!");
    expect(sent).toMatchObject({ status: "SENT", aiDrafted: true, body: "Riyadh, Olaya Street — welcome!" });
    await expect(sendDraft(t.scope, draft.id, user(t))).rejects.toMatchObject({ code: "invalid_transition" }); // no double send
    expect(await db.auditLog.count({ where: { organizationId: t.organization.id, action: "whatsapp.ai_assisted_reply" } })).toBe(1);
  });
});

describe("opt-out, suppression and campaigns", () => {
  it("STOP opts the contact out and suppresses the number; campaigns exclude them with reasons", async () => {
    const { t, pn } = await connected();
    await processWebhook(inbound(pn, "966501010101", "STOP", { name: "Stopper" }));
    const stopper = await db.lead.findFirstOrThrow({ where: { ...t.scope, phoneDigits: "966501010101" } });
    expect(stopper.whatsappOptOut).toBe(true);
    expect(await db.whatsAppSuppression.count({ where: { ...t.scope, phone: "966501010101", reason: "opt_out" } })).toBe(1);

    const actor = { type: "SYSTEM" as const, label: "t" };
    await createLead(t.scope, { name: "Good One", phone: "+966 50 202 0202", tags: ["vip"] }, actor, { qualify: false });
    await createLead(t.scope, { name: "Twin", phone: "966502020202", tags: ["vip"] }, actor, { qualify: false });
    await createLead(t.scope, { name: "No Phone", email: "np@x.test", tags: ["vip"] }, actor, { qualify: false });
    await createLead(t.scope, { name: "Bad", phone: "123", tags: ["vip"] }, actor, { qualify: false });
    await db.lead.update({ where: { id: stopper.id }, data: { tags: ["vip"] } });
    const p = await previewAudience(t.scope, { tags: ["vip"] });
    expect(p).toMatchObject({ total: 5, eligible: 1, excludedTotal: 4 });
    expect(p.excluded).toMatchObject({ opted_out: 1, duplicate: 1, missing_phone: 1, invalid_phone: 1 });

    await saveWhatsAppSettings(t.scope, { requireConsent: true }, user(t));
    expect((await previewAudience(t.scope, { tags: ["vip"] })).excluded.no_consent).toBe(2); // both reachable contacts lack explicit consent
  });

  it("draft → approval → recipients → queued batches → sent; pause stops, resume continues; failures and throttling are real states", async () => {
    const { t, pn } = await connected();
    const tpl = await approvedTemplate(t);
    const actor = { type: "SYSTEM" as const, label: "t" };
    for (let i = 0; i < 5; i++) await createLead(t.scope, { name: `Buyer ${i}`, phone: `+96650100${String(1000 + i)}`, tags: ["promo"] }, actor, { qualify: false });
    await createLead(t.scope, { name: "Unreachable", phone: "+966501230000", tags: ["promo"] }, actor, { qualify: false });

    const c = await saveCampaign(t.scope, { name: "Ramadan offer", objective: "offer", templateId: tpl.id, audience: { tags: ["promo"] } }, user(t));
    const sub = await submitCampaign(t.scope, c.id, user(t));
    expect(sub).toMatchObject({ state: "NEEDS_APPROVAL", eligible: 6 });
    expect(calls.filter((x) => x.path.endsWith("/messages"))).toHaveLength(0); // nothing sent before approval
    const approval = await db.approval.findFirstOrThrow({ where: { entityType: "Campaign", entityId: c.id, status: "PENDING" } });

    await decideApproval(t.scope, approval.id, "APPROVED", { userId: t.user.id, label: "Owner" });
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).waState).toBe("SENDING");
    expect(await db.campaignRecipient.count({ where: { campaignId: c.id, status: "QUEUED" } })).toBe(6);

    throttleNext = 1; // Meta throughput error on the first send → back to the queue, not failed
    const r1 = await runCampaignBatch(t.scope, c.id);
    expect(r1).toMatchObject({ sent: 0 });
    expect(await db.campaignRecipient.count({ where: { campaignId: c.id, status: "QUEUED" } })).toBe(6);

    await pauseCampaign(t.scope, c.id, user(t));
    expect(await runCampaignBatch(t.scope, c.id)).toMatchObject({ skipped: "PAUSED" });
    expect(await db.campaignRecipient.count({ where: { campaignId: c.id, status: { in: ["SENT", "DELIVERED", "READ"] } } })).toBe(0);

    await resumeCampaign(t.scope, c.id, user(t));
    const r2 = await runCampaignBatch(t.scope, c.id);
    expect(r2).toMatchObject({ sent: 5, completed: true });
    const stats = await campaignAnalytics(t.scope, c.id);
    expect(stats).toMatchObject({ recipients: 6, sent: 5, failed: 1, state: "COMPLETED", delivered: 0, read: 0, revenue: null });

    // A reply within 7 days is attributed to the campaign (lead + recipient).
    const rec = await db.campaignRecipient.findFirstOrThrow({ where: { campaignId: c.id, status: "SENT" } });
    await processWebhook(inbound(pn, rec.phone, "Interested!"));
    expect((await db.campaignRecipient.findUniqueOrThrow({ where: { id: rec.id } })).repliedAt).not.toBeNull();
    expect((await db.lead.findUniqueOrThrow({ where: { id: rec.leadId } })).campaignId).toBe(c.id);
    expect((await campaignAnalytics(t.scope, c.id)).replies).toBe(1);
  });

  it("a contact who opts out after approval is skipped at send time", async () => {
    const { t } = await connected();
    const tpl = await approvedTemplate(t);
    const lead = await createLead(t.scope, { name: "Late Stop", phone: "+966507070707", tags: ["x"] }, { type: "SYSTEM", label: "t" }, { qualify: false });
    const c = await saveCampaign(t.scope, { name: "C", objective: "follow_up", templateId: tpl.id, audience: { tags: ["x"] } }, user(t));
    await approveWhatsAppCampaign(t.scope, c.id, user(t), { sendNow: true });
    await setOptOut(t.scope, lead.id, true, { type: "USER", id: t.user.id, label: "Owner" });
    await runCampaignBatch(t.scope, c.id);
    expect(await db.campaignRecipient.findFirstOrThrow({ where: { campaignId: c.id } })).toMatchObject({ status: "SKIPPED", error: "opted_out" });
    expect(calls.filter((x) => x.path.endsWith("/messages"))).toHaveLength(0);
  });

  it("a campaign can't be submitted with an unapproved template", async () => {
    const { t } = await connected();
    const draft = await saveTemplateDraft(t.scope, templateSchema.parse({ name: "not_yet", language: "en_US", category: "MARKETING", body: "Hello" }), user(t));
    await createLead(t.scope, { name: "A", phone: "+966501111111", tags: ["y"] }, { type: "SYSTEM", label: "t" }, { qualify: false });
    const c = await saveCampaign(t.scope, { name: "C", objective: "offer", templateId: draft.id, audience: { tags: ["y"] } }, user(t));
    await expect(submitCampaign(t.scope, c.id, user(t))).rejects.toMatchObject({ code: "whatsapp_campaign_template_not_approved" });
  });
});

describe("sales follow-up over WhatsApp", () => {
  it("inside the window: a draft waiting for approval; outside: template required (nothing sent)", async () => {
    const { t, pn } = await connected();
    await processWebhook(inbound(pn, "966506060606", "hello"));
    const lead = await db.lead.findFirstOrThrow({ where: t.scope });
    const r = await prepareFollowup(t.scope, lead.id, user(t));
    expect(r.status).toBe("drafted");
    expect(await db.message.count({ where: { organizationId: t.organization.id, direction: "OUTBOUND", status: "DRAFT", aiDrafted: true } })).toBe(1);
    expect(calls.filter((x) => x.path.endsWith("/messages"))).toHaveLength(0);

    const cold = await createLead(t.scope, { name: "Cold", phone: "+966509090909" }, { type: "SYSTEM", label: "t" }, { qualify: false });
    expect((await prepareFollowup(t.scope, cold.id, user(t))).status).toBe("template_required");
  });
});
