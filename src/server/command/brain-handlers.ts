import { aiAvailability, contentAiConfigured } from "../ai";
import { startRun } from "../agents/runtime";
import { FOLLOWUP_STEPS } from "../agents/workflows/sales";
import { moveLeadStage } from "../sales/service";
import { loadForecast } from "../sales/desk";
import { retrieveCompanyContext, termCoverage, type CompanyContext } from "../knowledge/company-context";
import { actor, aiUnavailable, formatWhen, localDay, money, msg, receipt, withLead, type HandlerInput, type Outcome } from "./handlers";
import type { ResultItem } from "./types";

const DAY = 86_400_000;
const sourceCount = (c: CompanyContext) => c.sources.reduce((a, s) => a + s.count, 0);
const metrics = (c: CompanyContext) => ({ contextTokens: c.contextTokens, retrievedItems: c.retrievedItems, brainVersion: c.brainVersion });

// ── Company Brain facts: retrieval + a formatted answer. No model call, ever. ──

/** Structured Company Intelligence entities (approved only) — read directly, no retrieval, no AI. */
async function brainEntityAnswer(h: HandlerInput): Promise<Outcome | null> {
  const t = h.ctx.db;
  let items: ResultItem[] = [];
  switch (h.def.key) {
    case "brain_icp": {
      const rows = await t.idealCustomerProfile.findMany({ where: { status: "approved" }, orderBy: { updatedAt: "desc" }, take: 5 });
      items = rows.map((r) => ({ title: r.name, subtitle: [r.industry, r.location, r.companySize, r.painPoints.slice(0, 2).join(" · ")].filter(Boolean).join(" · ") || null, badge: r.kind }));
      break;
    }
    case "brain_objections": {
      const rows = await t.brainObjection.findMany({ where: { status: "approved" }, orderBy: { updatedAt: "desc" }, take: 8 });
      items = rows.map((r) => ({ title: r.objection, subtitle: r.response.slice(0, 160) }));
      break;
    }
    case "brain_content_strategy": {
      const [rows, kit, profile] = await Promise.all([t.strategy.findMany({ where: { status: "APPROVED", type: { in: ["content", "marketing"] } }, orderBy: { approvedAt: "desc" }, take: 3 }), t.brandKit.findFirst(), t.companyProfile.findFirst()]);
      items = [...rows.map((r) => ({ title: r.title, subtitle: r.objective ?? r.positioning, badge: r.type })), ...(profile?.contentPillars.length ? [{ title: profile.contentPillars.join(" · "), badge: "pillars" }] : []), ...(kit?.tone ? [{ title: kit.tone, badge: "tone" }] : [])];
      break;
    }
    case "brain_top_products": {
      const rows = await t.offering.findMany({ where: { isActive: true, priceCents: { not: null } }, orderBy: { priceCents: "desc" }, take: 5 });
      items = rows.map((r) => ({ title: r.name, subtitle: r.description?.slice(0, 120) ?? null, badge: r.priceText }));
      break;
    }
    default:
      return null;
  }
  if (!items.length) return { status: "needs_input", message: msg("brainMissing", { topic: h.def.key }), actions: [{ label: "openKnowledge", href: "/knowledge", primary: true }], mode: "brain", sources: 0 };
  return { status: "completed", message: msg("brainFound", { topic: h.def.key, count: items.length }), items, actions: [{ label: "openKnowledge", href: "/knowledge", primary: true }], mode: "brain", sources: 1 };
}

export async function brainFact(h: HandlerInput): Promise<Outcome> {
  const entity = await brainEntityAnswer(h);
  if (entity) return entity;
  const c = await retrieveCompanyContext(h.scope, { purpose: "facts", sections: h.def.brainSections, budget: "medium" });
  const offering = (o: { name: string; detail?: string | null; price?: string | null }): ResultItem => ({ title: o.name, subtitle: o.detail ?? null, badge: o.price ?? null });
  const lines = (xs: string[]): ResultItem[] => xs.map((title) => ({ title }));
  let items: ResultItem[] = [];
  let text: string | null = null;
  switch (h.def.key) {
    case "brain_services":
      items = c.services.map(offering);
      break;
    case "brain_products":
      items = c.products.map(offering);
      break;
    case "brain_audience":
      items = lines(c.audience);
      break;
    case "brain_strengths":
      items = lines(c.valueProps);
      break;
    case "brain_pricing":
      items = lines(c.pricing);
      break;
    case "brain_tone":
      items = lines([...c.brandRules, ...(c.pillars.length ? [c.pillars.join(" · ")] : [])]);
      break;
    case "brain_about":
      text = c.company?.summary ?? null;
      items = lines(c.valueProps.slice(0, 5));
      break;
  }
  // Nothing in the brain for this topic: say so — never invent an answer.
  if (!items.length && !text) {
    return { status: "needs_input", message: msg("brainMissing", { topic: h.def.key }), actions: [{ label: "openKnowledge", href: "/knowledge", primary: true }], mode: "brain", sources: 0, metrics: metrics(c) };
  }
  return {
    status: "completed",
    message: msg("brainFound", { topic: h.def.key, count: items.length }),
    text,
    items,
    ...(h.def.key === "brain_pricing" ? { notes: [msg("pricingPolicyNote")] } : {}),
    actions: [{ label: "openKnowledge", href: "/knowledge" }],
    mode: "brain",
    sources: sourceCount(c),
    metrics: metrics(c),
  };
}

/** The sentences of `text` that best answer `query` (extractive — nothing generated). */
export function extractAnswer(query: string, text: string, max = 3) {
  const sentences = text.split(/(?<=[.!?؟])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 15);
  const ranked = sentences.map((s, i) => ({ s, i, c: termCoverage(query, s) })).filter((x) => x.c > 0).sort((a, b) => b.c - a.c).slice(0, max).sort((a, b) => a.i - b.i);
  return (ranked.length ? ranked.map((x) => x.s) : sentences.slice(0, 2)).join(" ").slice(0, 600);
}

/**
 * A question the parser doesn't know: answer from the brain when confident; show the best facts and ask
 * for specifics when partly confident; only then escalate to AI (with a small selective context).
 */
export async function brainQuestion(h: HandlerInput): Promise<Outcome> {
  const query = h.params.input ?? "";
  const c = await retrieveCompanyContext(h.scope, { purpose: "support", query, budget: "small", topK: 3 });
  const src = c.chunks.map((x) => ({ title: x.title || "—", subtitle: x.text.slice(0, 140), badge: x.source }));
  // Structured answers first: an approved fact, then an approved FAQ — no chunk search, no AI.
  if (c.factMatch) {
    return { status: "completed", message: msg("brainAnswer"), text: c.factMatch.value.slice(0, 800), items: [{ title: c.factMatch.key, badge: "fact" }], mode: "brain", sources: sourceCount(c), metrics: metrics(c) };
  }
  if (c.faqMatch && c.faqMatch.coverage >= 0.6) {
    return { status: "completed", message: msg("brainAnswer"), text: c.faqMatch.answer.slice(0, 800), items: [{ title: c.faqMatch.question, badge: "faq" }], mode: "brain", sources: sourceCount(c), metrics: metrics(c) };
  }
  if (c.confidence === "high") {
    return { status: "completed", message: msg("brainAnswer"), text: extractAnswer(query, c.chunks[0].text), items: src.slice(0, 3), mode: "brain", sources: sourceCount(c), metrics: metrics(c) };
  }
  if (c.confidence === "medium") {
    return { status: "needs_input", message: msg("brainPartial"), items: src.slice(0, 3), mode: "brain", sources: sourceCount(c), metrics: metrics(c) };
  }
  if (!contentAiConfigured()) return { ...aiUnavailable(), message: msg("aiRequired"), mode: "brain", metrics: metrics(c) };
  // Low confidence + real AI: the knowledge-answer workflow with a small selective context.
  const run = await startRun(h.scope, { kind: "command", agent: "SOCIAL_MANAGER", input: query, steps: ["searching_knowledge", "writing_answer"], requestedById: h.ctx.user.id, params: { intent: "ask_question" } });
  return { status: "queued", message: msg("started"), runId: run.id, mode: "brain_ai", metrics: metrics(c) };
}

// ── Sales: one named customer's draft, with only that customer's data + sales rules ──

export async function draftSalesMessage(h: HandlerInput): Promise<Outcome> {
  return withLead(h, async (lead) => {
    if (!aiAvailability().configured) return aiUnavailable();
    const run = await startRun(h.scope, { kind: "leads_followup", agent: "SALES_AGENT", steps: FOLLOWUP_STEPS, params: { leadIds: [lead.id] }, requestedById: h.ctx.user.id });
    return { status: "queued", message: msg("started"), runId: run.id, receipt: receipt("message.draft", "AgentRun", run.id, "queued"), approvalRequired: true, mode: "brain_ai" };
  });
}

// ── Local (no AI): stage updates, pipeline math, calendar, activity, integrations ──

export async function moveStage(h: HandlerInput): Promise<Outcome> {
  const stage = h.params.targetStage;
  if (!stage) return { status: "needs_input", message: msg("needStage") };
  return withLead(h, async (lead) => {
    if (lead.stage === stage) return { status: "completed", message: msg("alreadyStage", { name: lead.name, stage }) };
    // Won/lost close the deal's opportunities: confirm first.
    if ((stage === "WON" || stage === "LOST") && !h.confirmed) {
      return { status: "needs_confirmation", message: msg(stage === "WON" ? "confirmWon" : "confirmLost", { name: lead.name }), confirmLabel: stage === "WON" ? "markWon" : "markLost", plan: { step: "confirm", params: { ...h.params, leadId: lead.id } }, approvalRequired: true };
    }
    await moveLeadStage(h.scope, lead.id, stage, actor(h.ctx), "Command Center");
    return { status: "completed", message: msg("stageMoved", { name: lead.name, stage }), actions: [{ label: "openLead", href: `/leads/${lead.id}`, primary: true }, { label: "openPipeline", href: "/sales?view=pipeline" }], receipt: receipt("lead.stage_changed", "Lead", lead.id, stage) };
  });
}

export async function pipelineValue(h: HandlerInput): Promise<Outcome> {
  const f = await loadForecast(h.ctx, {});
  if (!f.openCount) return { status: "completed", message: msg("noSalesData"), actions: [{ label: "openSales", href: "/sales" }] };
  if (!f.pipeline) return { status: "completed", message: msg("noPipelineValue", { open: f.openCount }), actions: [{ label: "openPipeline", href: "/sales?view=pipeline", primary: true }] };
  return {
    status: "completed",
    message: msg("pipelineValue", { value: money(f.pipeline.cents, f.pipeline.currency, h.locale), withValue: f.openWithValue, open: f.openCount }),
    stats: [
      { key: "pipelineValue", value: money(f.pipeline.cents, f.pipeline.currency, h.locale) },
      ...(f.weighted ? [{ key: "weighted", value: money(f.weighted.cents, f.weighted.currency, h.locale) }] : []),
      { key: "openDeals", value: f.openCount },
      { key: "withValue", value: f.openWithValue },
    ],
    items: f.byStage.filter((s) => s.count).map((s) => ({ title: s.label, subtitle: s.value ? money(s.value.cents, s.value.currency, h.locale) : null, badge: `${s.count} · ${s.probability}%` })),
    actions: [{ label: "openPipeline", href: "/sales?view=pipeline", primary: true }],
  };
}

export async function calendarLookup(h: HandlerInput): Promise<Outcome> {
  const tz = h.ctx.organization.timezone;
  const days = h.params.date?.offsetDays ?? 0;
  const from = localDay(tz, days);
  const to = new Date(from.getTime() + DAY);
  const [meetings, calls] = await Promise.all([
    h.ctx.db.meeting.findMany({ where: { status: "BOOKED", startAt: { gte: from, lt: to } }, select: { title: true, startAt: true, leadId: true }, orderBy: { startAt: "asc" }, take: 20 }),
    h.ctx.db.salesActivity.findMany({ where: { type: { in: ["MEETING", "CALL"] }, completedAt: null, dueAt: { gte: from, lt: to } }, include: { lead: { select: { id: true, name: true } } }, orderBy: { dueAt: "asc" }, take: 20 }),
  ]);
  const names = new Map((await h.ctx.db.lead.findMany({ where: { id: { in: meetings.map((m) => m.leadId) } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]));
  const items: ResultItem[] = [
    ...meetings.map((m) => ({ title: `${m.title} — ${names.get(m.leadId) ?? "—"}`, subtitle: formatWhen(m.startAt!, tz, h.locale), href: `/leads/${m.leadId}`, badge: "meeting" })),
    ...calls.map((a) => ({ title: `${a.title} — ${a.lead.name}`, subtitle: formatWhen(a.dueAt!, tz, h.locale), href: `/leads/${a.lead.id}`, badge: a.type === "CALL" ? "call" : "meeting" })),
  ];
  const day = new Intl.DateTimeFormat(h.locale === "ar" ? "ar" : "en-US", { weekday: "long", day: "numeric", month: "short", timeZone: tz }).format(from);
  return {
    status: "completed",
    message: items.length ? msg("calendarFound", { count: items.length, day }) : msg("calendarEmpty", { day }),
    items: items.slice(0, 8),
    actions: [{ label: "openCalendar", href: "/calendar", primary: true }],
  };
}

export async function leadActivity(h: HandlerInput): Promise<Outcome> {
  return withLead(h, async (lead) => {
    const events = await h.ctx.db.leadEvent.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" }, take: 6, select: { title: true, createdAt: true, type: true } });
    return {
      status: "completed",
      message: events.length ? msg("activityFound", { name: lead.name, count: events.length }) : msg("activityEmpty", { name: lead.name }),
      items: events.map((e) => ({ title: e.title, subtitle: formatWhen(e.createdAt, h.ctx.organization.timezone, h.locale), badge: e.type })),
      actions: [{ label: "openLead", href: `/leads/${lead.id}`, primary: true }],
    };
  });
}

export async function integrationsStatus(h: HandlerInput): Promise<Outcome> {
  // Status only — never scopes, credentials or provider messages.
  const rows = await h.ctx.db.integration.findMany({ select: { provider: true, status: true, lastSyncAt: true }, orderBy: { provider: "asc" } });
  if (!rows.length) return { status: "completed", message: msg("noIntegrations"), actions: [{ label: "openIntegrations", href: "/settings/connected-accounts", primary: true }] };
  const connected = rows.filter((r) => r.status === "CONNECTED").length;
  return {
    status: "completed",
    message: msg("integrationsStatus", { connected, total: rows.length }),
    items: rows.map((r) => ({ title: r.provider, subtitle: r.lastSyncAt ? formatWhen(r.lastSyncAt, h.ctx.organization.timezone, h.locale) : null, badge: r.status })),
    actions: [{ label: "openIntegrations", href: "/settings/connected-accounts", primary: true }],
  };
}

export const BRAIN_HANDLERS = {
  brain_about: brainFact,
  brain_services: brainFact,
  brain_products: brainFact,
  brain_audience: brainFact,
  brain_strengths: brainFact,
  brain_pricing: brainFact,
  brain_tone: brainFact,
  brain_icp: brainFact,
  brain_objections: brainFact,
  brain_content_strategy: brainFact,
  brain_top_products: brainFact,
  brain_question: brainQuestion,
  draft_sales_message: draftSalesMessage,
  move_stage: moveStage,
  pipeline_value: pipelineValue,
  calendar_lookup: calendarLookup,
  lead_activity: leadActivity,
  integrations_status: integrationsStatus,
} satisfies Record<string, (h: HandlerInput) => Promise<Outcome>>;
export type BrainHandlerKey = keyof typeof BRAIN_HANDLERS;
