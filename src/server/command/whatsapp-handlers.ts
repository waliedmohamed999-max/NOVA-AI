import { msg, receipt, type Handler, type HandlerInput, type Outcome } from "./handlers";
import { previewAudience, saveCampaign, type Audience } from "../whatsapp/campaigns";
import { prepareDueFollowups } from "../whatsapp/followups";
import { whatsappConnected } from "../whatsapp/numbers";
import { normalize } from "./parse";

/**
 * WhatsApp commands — all local (no model call): navigation, counts from our records, and drafts.
 * "Prepare a WhatsApp campaign for…" builds the CRM audience and a DRAFT campaign with its real count;
 * choosing the template, approval and sending happen in the campaign flow — a command never sends.
 */

const actor = (h: HandlerInput) => ({ userId: h.ctx.user.id, label: h.ctx.user.name ?? h.ctx.user.email });

/** Local audience parsing: "hot customers", "haven't bought in 60 days", "not contacted for 30 days", "qualified". */
export function audienceFromText(n: string): Audience {
  const a: Audience = {};
  if (/ساخن|hot/.test(n)) a.temperatures = ["HOT"];
  else if (/دافي|warm/.test(n)) a.temperatures = ["WARM"];
  const days = Number(n.match(/(\d{1,4})\s*(يوم|ايام|days?)/)?.[1] ?? 0) || (/شهرين|two months/.test(n) ? 60 : /شهر|a month/.test(n) ? 30 : 0);
  if (days && /(ما|لم|مش|مااشتر|ما اشتر|مشتروش|haven ?'?t|not|no)\s*(اشتر|يشتر|شر|bought|purchas|ordered)|بدون شراء|no purchase/.test(n)) a.noPurchaseDays = days;
  else if (days && /(تواصل|كلمنا|contact)/.test(n)) a.lastContactOlderThanDays = days;
  if (/مؤهل|qualified/.test(n)) a.stages = ["QUALIFIED"];
  if (/(عروض|عرض سعر|proposal)/.test(n) && !a.stages) a.stages = ["PROPOSAL"];
  return a;
}

async function whatsappUnread(h: HandlerInput): Promise<Outcome> {
  const [agg, needs] = await Promise.all([
    h.ctx.db.conversation.aggregate({ where: { channel: "WHATSAPP" }, _sum: { unreadCount: true } }),
    h.ctx.db.conversation.count({ where: { channel: "WHATSAPP", needsHuman: true } }),
  ]);
  const unread = agg._sum.unreadCount ?? 0;
  return {
    status: "completed",
    message: msg(unread ? "waUnread" : "waNoUnread", { count: unread, needs }),
    stats: [
      { key: "wa_unread", value: unread },
      { key: "wa_needs_human", value: needs },
    ],
    actions: [{ label: "openWhatsappInbox", href: needs ? "/whatsapp/inbox?filter=needs_human" : "/whatsapp/inbox", primary: true }],
  };
}

async function waCampaignSummary(h: HandlerInput): Promise<Outcome> {
  const rows = await h.ctx.db.campaign.findMany({ where: { channel: "whatsapp" }, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, name: true, waState: true } });
  if (!rows.length) return { status: "completed", message: msg("waNoCampaigns"), actions: [{ label: "createWhatsappCampaign", href: "/whatsapp/campaigns/new", primary: true }] };
  const groups = await h.ctx.db.campaign.groupBy({ by: ["waState"], where: { channel: "whatsapp" }, _count: true });
  return {
    status: "completed",
    message: msg("waCampaignSummary", { count: groups.reduce((a, g) => a + g._count, 0) }),
    stats: groups.map((g) => ({ key: `wa_${g.waState ?? "DRAFT"}`, value: g._count })),
    items: rows.map((c) => ({ title: c.name, badge: c.waState ?? "DRAFT", href: `/whatsapp/campaigns/${c.id}` })),
    actions: [{ label: "openWhatsappCampaigns", href: "/whatsapp/campaigns", primary: true }],
  };
}

async function createWaCampaign(h: HandlerInput): Promise<Outcome> {
  if (!(await whatsappConnected(h.scope))) return { status: "needs_input", message: msg("waNotConnected"), actions: [{ label: "connectWhatsapp", href: "/whatsapp", primary: true }] };
  const audience = audienceFromText(normalize(h.params.input ?? ""));
  const preview = await previewAudience(h.scope, audience);
  const name = (h.params.input ?? "WhatsApp").slice(0, 80);
  const c = await saveCampaign(h.scope, { name, objective: audience.noPurchaseDays || audience.lastContactOlderThanDays ? "reengagement" : "offer", templateId: null, audience }, actor(h));
  return {
    status: "completed",
    message: msg("waCampaignDrafted", { eligible: preview.eligible, total: preview.total }),
    stats: [
      { key: "wa_targeted", value: preview.total },
      { key: "wa_eligible", value: preview.eligible },
      { key: "wa_excluded", value: preview.excludedTotal },
    ],
    actions: [{ label: "reviewCampaign", href: `/whatsapp/campaigns/new?id=${c.id}`, primary: true }],
    receipt: receipt("whatsapp.campaign_drafted", "Campaign", c.id, "draft"),
    approvalRequired: true,
  };
}

async function prepareWaFollowups(h: HandlerInput): Promise<Outcome> {
  if (!(await whatsappConnected(h.scope))) return { status: "needs_input", message: msg("waNotConnected"), actions: [{ label: "connectWhatsapp", href: "/whatsapp", primary: true }] };
  const r = await prepareDueFollowups(h.scope, actor(h));
  return {
    status: "completed",
    message: msg(r.due ? "waFollowupsPrepared" : "waNoFollowupsDue", { drafted: r.drafted, templateRequired: r.templateRequired }),
    actions: [{ label: "reviewFollowups", href: "/whatsapp/followups", primary: true }],
    approvalRequired: r.drafted > 0,
  };
}

const navigate: Handler = (h) => ({ status: "completed", message: msg("opening", { page: h.def.key }), navigation: h.def.route ?? "/whatsapp" });

export const WHATSAPP_HANDLERS = {
  open_whatsapp: navigate,
  open_whatsapp_inbox: navigate,
  whatsapp_customers: navigate,
  whatsapp_templates: navigate,
  whatsapp_unread: whatsappUnread,
  whatsapp_campaign_summary: waCampaignSummary,
  create_whatsapp_campaign: createWaCampaign,
  prepare_whatsapp_followups: prepareWaFollowups,
} satisfies Record<string, Handler>;
export type WhatsAppHandlerKey = keyof typeof WHATSAPP_HANDLERS;
