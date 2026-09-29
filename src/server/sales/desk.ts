import type { Prisma } from "@/generated/prisma/client";
import type { Channel, LeadStage } from "@/generated/prisma/enums";
import type { TenantContext } from "../context";
import { db } from "../db/client";
import { aiAvailability, contentAiConfigured } from "../ai";
import { embeddedSignupStatus, whatsappStatus } from "../whatsapp/cloud-api";
import { whatsappConnected } from "../whatsapp/numbers";
import { getMailer } from "../email/mailer";
import { forecast, isOpen, leadSignals, leadValue, OPEN_STAGES, salesInsights, temperatureReasons, URGENCY, type Money, type Signal } from "./intelligence";

/**
 * Sales Desk read model. Everything comes from existing tables (leads, sales_opportunities,
 * sales_activities, conversations/messages, lead_events, pipeline_stages, quotes). Each view loads only
 * what it shows, with server-side filters and limits.
 */
export const DESK_VIEWS = ["overview", "pipeline", "hot", "followups", "conversations", "b2b", "quotes", "forecast", "activity", "customers"] as const;
export type DeskView = (typeof DESK_VIEWS)[number];
export const FOLLOWUP_TABS = ["today", "overdue", "week", "paused", "done"] as const;
export type FollowUpTab = (typeof FOLLOWUP_TABS)[number];

export type DeskFilters = {
  owner?: string;
  stage?: string;
  temperature?: string;
  source?: string;
  channel?: string;
  period?: "7d" | "30d" | "90d";
  q?: string;
  /** Leads whose phone digits match a numeric search (filled by resolveSearch). */
  phoneIds?: string[];
};

const DAY = 86_400_000;
const str = (v: unknown, max = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const STAGES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];
const CHANNELS = ["WEBSITE", "EMAIL", "INSTAGRAM_DM", "FACEBOOK_DM", "LINKEDIN", "WHATSAPP", "PHONE", "MANUAL"];

export function parseFilters(sp: Record<string, string | string[] | undefined>): DeskFilters {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const period = one("period");
  return {
    owner: str(one("owner"), 40),
    stage: STAGES.includes(one("stage") ?? "") ? one("stage") : undefined,
    temperature: ["HOT", "WARM", "COLD"].includes(one("temp") ?? "") ? one("temp") : undefined,
    source: str(one("source")),
    channel: CHANNELS.includes(one("channel") ?? "") ? one("channel") : undefined,
    period: period === "7d" || period === "30d" || period === "90d" ? period : undefined,
    q: str(one("q"), 120),
  };
}

export function leadWhere(f: DeskFilters, userId: string): Prisma.LeadWhereInput {
  const w: Prisma.LeadWhereInput = {};
  if (f.owner === "me") w.ownerId = userId;
  else if (f.owner === "none") w.ownerId = null;
  else if (f.owner) w.ownerId = f.owner;
  if (f.stage) w.stage = f.stage as LeadStage;
  if (f.temperature) w.temperature = f.temperature as "HOT" | "WARM" | "COLD";
  if (f.source) w.source = { contains: f.source, mode: "insensitive" };
  if (f.channel) w.channel = f.channel as Channel;
  if (f.period) w.createdAt = { gte: new Date(Date.now() - { "7d": 7, "30d": 30, "90d": 90 }[f.period] * DAY) };
  if (f.q) {
    const q = f.q;
    w.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { company: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      ...(f.phoneIds?.length ? [{ id: { in: f.phoneIds } }] : []),
      { opportunities: { some: { title: { contains: q, mode: "insensitive" } } } },
    ];
  }
  return w;
}

/**
 * Phone numbers are stored as typed ("+20 100 555 1234"); a digits-only search must ignore formatting.
 * One workspace-scoped query, run once per request before building the filter.
 */
export async function resolveSearch(ctx: TenantContext, f: DeskFilters): Promise<DeskFilters> {
  const digits = f.q?.replace(/[^\d]/g, "") ?? "";
  if (digits.length < 6) return f;
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "leads" WHERE "organizationId" = ${ctx.organization.id} AND "workspaceId" = ${ctx.workspace.id} AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE ${"%" + digits + "%"} LIMIT 200`;
  return { ...f, phoneIds: rows.map((r) => r.id) };
}

/** The workspace's main currency: the most common lead currency (USD when there are no leads). */
async function mainCurrency(ctx: TenantContext) {
  const g = await ctx.db.lead.groupBy({ by: ["currency"], _count: true });
  return g.sort((a, b) => b._count - a._count)[0]?.currency ?? "USD";
}

const oppSelect = { id: true, title: true, valueCents: true, currency: true, status: true, kind: true, nextStep: true, nextStepAt: true } as const;

// ── Summary: hero, KPIs, status strip, brief, getting started ──

export async function deskSummary(ctx: TenantContext, f: DeskFilters) {
  const where = leadWhere(f, ctx.user.id);
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + DAY);
  const [total, open, newWeek, qualified, hot, won, lost, overdue, dueToday, quotesSent, pendingApprovals, openOppCount, stalled] = await Promise.all([
    ctx.db.lead.count({ where }),
    ctx.db.lead.count({ where: { ...where, stage: { in: [...OPEN_STAGES] } } }),
    ctx.db.lead.count({ where: { ...where, createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    ctx.db.lead.count({ where: { ...where, stage: { in: ["QUALIFIED", "PROPOSAL", "NEGOTIATION"] } } }),
    ctx.db.lead.count({ where: { ...where, temperature: "HOT", stage: { in: [...OPEN_STAGES] } } }),
    ctx.db.lead.count({ where: { ...where, stage: "WON" } }),
    ctx.db.lead.count({ where: { ...where, stage: "LOST" } }),
    ctx.db.salesActivity.count({ where: { completedAt: null, pausedAt: null, dueAt: { lt: now }, lead: where } }),
    ctx.db.salesActivity.count({ where: { completedAt: null, pausedAt: null, dueAt: { gte: startOfDay, lt: endOfDay }, lead: where } }),
    ctx.db.quote.count({ where: { status: { in: ["SENT", "VIEWED", "ACCEPTED", "REJECTED"] } } }),
    ctx.db.approval.count({ where: { status: "PENDING", category: { in: ["SALES", "PRICING"] } } }),
    ctx.db.salesOpportunity.count({ where: { status: "OPEN", lead: where } }),
    ctx.db.lead.count({ where: { ...where, stage: { in: ["CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION"] }, stageChangedAt: { lt: new Date(now.getTime() - 7 * DAY) } } }),
  ]);
  const [channels, anyOpp] = await Promise.all([channelStatus(ctx), ctx.db.salesOpportunity.count()]);
  return {
    hero: { customers: total, openOpportunities: open, overdue },
    kpis: { newWeek, qualified, hot, quotesSent, won, lost, overdue, openOppCount },
    brief: { dueToday, hot, pendingApprovals, stalled, show: dueToday + hot + pendingApprovals + stalled > 0 },
    channels,
    gettingStarted: {
      show: total === 0 && !f.q && !f.stage && !f.owner && !f.temperature && !f.source && !f.channel && !f.period,
      steps: { lead: total > 0, channel: channels.some((c) => c.kind === "channel" && c.state === "connected"), opportunity: anyOpp > 0, agent: contentAiConfigured() },
    },
    currency: await mainCurrency(ctx),
  };
}

export type ChannelState = "connected" | "not_connected" | "reconnect" | "not_configured" | "ready" | "running";
export type ChannelRow = { key: string; kind: "crm" | "channel" | "agent"; state: ChannelState; detail?: string | null; connectHref?: string };

/** Status strip from real state: integrations registry rows, WhatsApp link, mailer, AI configuration. */
export async function channelStatus(ctx: TenantContext): Promise<ChannelRow[]> {
  const [ints, wa, running] = await Promise.all([
    ctx.db.integration.findMany({ where: { provider: { in: ["GOOGLE", "MICROSOFT", "LINKEDIN", "FACEBOOK", "INSTAGRAM"] }, status: { not: "DISCONNECTED" } }, select: { provider: true, status: true, statusMessage: true, scopes: true } }),
    ctx.db.whatsAppNumber.findFirst({ where: { isActive: true }, select: { displayPhone: true } }),
    ctx.db.agentRun.count({ where: { kind: { in: ["lead_qualify", "leads_followup", "sales_cycle"] }, status: { in: ["QUEUED", "RUNNING"] } } }).catch(() => 0),
  ]);
  const waLive = await whatsappConnected({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
  const state = (p: string): ChannelState => {
    const r = ints.find((i) => i.provider === p);
    if (!r) return "not_connected";
    return r.status === "CONNECTED" ? "connected" : "reconnect";
  };
  const mailbox = ints.find((i) => (i.provider === "GOOGLE" && i.scopes.includes("https://www.googleapis.com/auth/gmail.send")) || (i.provider === "MICROSOFT" && i.scopes.includes("Mail.Send")));
  const emailState: ChannelState = mailbox ? (mailbox.status === "CONNECTED" ? "connected" : "reconnect") : getMailer().configured ? "connected" : "not_configured";
  const rows: ChannelRow[] = [
    { key: "crm", kind: "crm", state: "connected" },
    { key: "email", kind: "channel", state: emailState, detail: mailbox ? (mailbox.provider === "GOOGLE" ? "Gmail" : "Outlook") : getMailer().configured ? "platform" : null, connectHref: "/settings/connected-accounts" },
    { key: "whatsapp", kind: "channel", state: waLive ? "connected" : wa ? "reconnect" : whatsappStatus().configured || embeddedSignupStatus().available ? "not_connected" : "not_configured", detail: wa?.displayPhone ?? null, connectHref: "/whatsapp" },
  ];
  for (const p of ["LINKEDIN", "FACEBOOK", "INSTAGRAM"] as const) {
    const s = state(p);
    if (s !== "not_connected") rows.push({ key: p.toLowerCase(), kind: "channel", state: s, connectHref: "/settings/connected-accounts" });
  }
  const ai = aiAvailability();
  rows.push({ key: "sales_ai", kind: "agent", state: running > 0 ? "running" : contentAiConfigured() ? "ready" : ai.configured ? "ready" : "not_configured" });
  return rows;
}

// ── Signals for a batch of leads (3 queries, no N+1) ──

type SignalRow = { id: string; stage: string; temperature: string; createdAt: Date; stageChangedAt: Date; lastContactAt: Date | null; nextActionAt: Date | null };

export async function signalsFor(ctx: TenantContext, leads: SignalRow[], now = new Date()) {
  const ids = leads.map((l) => l.id);
  if (!ids.length) return new Map<string, Signal[]>();
  const [acts, convs, quotes] = await Promise.all([
    ctx.db.salesActivity.findMany({ where: { leadId: { in: ids }, completedAt: null, pausedAt: null }, select: { leadId: true, dueAt: true } }),
    ctx.db.conversation.findMany({ where: { leadId: { in: ids } }, select: { leadId: true, messages: { where: { status: { in: ["RECEIVED", "SENT"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { direction: true, createdAt: true, sentAt: true } } } }),
    ctx.db.quote.findMany({ where: { leadId: { in: ids }, status: { in: ["SENT", "VIEWED"] } }, select: { leadId: true, sentAt: true } }),
  ]);
  const map = new Map<string, Signal[]>();
  for (const l of leads) {
    const msgs = convs.filter((c) => c.leadId === l.id).flatMap((c) => c.messages).map((m) => ({ direction: m.direction, at: m.sentAt ?? m.createdAt })).sort((a, b) => b.at.getTime() - a.at.getTime());
    const sent = quotes.filter((q) => q.leadId === l.id && q.sentAt).map((q) => q.sentAt!.getTime());
    map.set(l.id, leadSignals({ ...l, openFollowUps: acts.filter((a) => a.leadId === l.id), lastMessage: msgs[0] ?? null, quoteSentAt: sent.length ? new Date(Math.max(...sent)) : null }, now));
  }
  return map;
}

const reasonsOf = (j: unknown) => (Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : []);

const signalSelect = { id: true, stage: true, temperature: true, createdAt: true, stageChangedAt: true, lastContactAt: true, nextActionAt: true } as const;

// ── Pipeline (stages from the DB; active cards only, capped per stage) ──

export type PipelineCard = {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  value: Money | null;
  temperature: "HOT" | "WARM" | "COLD";
  lastContactAt: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  source: string | null;
  channels: string[];
  stage: string;
};

export async function loadPipeline(ctx: TenantContext, f: DeskFilters) {
  const where = leadWhere(f, ctx.user.id);
  const stages = await ctx.db.pipelineStage.findMany({ orderBy: { position: "asc" } });
  const PER_STAGE = 30;
  const closedSince = new Date(Date.now() - 30 * DAY);
  const cols = await Promise.all(
    stages.map(async (s) => {
      const w: Prisma.LeadWhereInput = { ...where, stage: s.stage, ...(isOpen(s.stage) ? {} : { stageChangedAt: { gte: closedSince } }) };
      const [count, leads] = await Promise.all([
        ctx.db.lead.count({ where: w }),
        ctx.db.lead.findMany({
          where: w,
          orderBy: [{ temperature: "asc" }, { score: "desc" }, { updatedAt: "desc" }],
          take: PER_STAGE,
          include: { opportunities: { where: { status: { in: ["OPEN", "WON"] } }, select: oppSelect, orderBy: { createdAt: "desc" } }, conversations: { select: { channel: true }, take: 5 } },
        }),
      ]);
      const cards: PipelineCard[] = leads.map((l) => {
        const open = l.opportunities.find((o) => o.status === (s.stage === "WON" ? "WON" : "OPEN"));
        return {
          id: l.id,
          name: l.name,
          company: l.company,
          title: open?.title ?? l.intent ?? null,
          value: leadValue(l, l.opportunities, s.stage === "WON" ? "WON" : "OPEN"),
          temperature: l.temperature,
          lastContactAt: l.lastContactAt?.toISOString() ?? null,
          nextAction: open?.nextStep ?? l.nextAction,
          nextActionAt: (open?.nextStepAt ?? l.nextActionAt)?.toISOString() ?? null,
          source: l.source,
          channels: [...new Set([...(l.email ? ["EMAIL"] : []), ...(l.phone ? ["PHONE"] : []), ...l.conversations.map((c) => c.channel)])],
          stage: l.stage,
        };
      });
      const known = cards.filter((c) => c.value);
      const cur = known[0]?.value?.currency;
      return {
        stage: s.stage,
        label: s.label,
        probability: s.probability,
        count,
        closedWindow: !isOpen(s.stage),
        value: known.length && cur ? { cents: known.filter((c) => c.value!.currency === cur).reduce((a, c) => a + c.value!.cents, 0), currency: cur } : null,
        valuePartial: known.length < count,
        cards,
      };
    }),
  );
  return { columns: cols };
}

// ── Funnel snapshot (current counts; NOT a historical conversion rate) ──

export async function loadFunnel(ctx: TenantContext, f: DeskFilters) {
  const where = leadWhere(f, ctx.user.id);
  const [stages, g] = await Promise.all([ctx.db.pipelineStage.findMany({ orderBy: { position: "asc" } }), ctx.db.lead.groupBy({ by: ["stage"], where, _count: true })]);
  const rows = stages.filter((s) => s.stage !== "LOST").map((s) => ({ stage: s.stage, label: s.label, count: g.find((x) => x.stage === s.stage)?._count ?? 0 }));
  return { rows, total: rows.reduce((a, r) => a + r.count, 0) };
}

// ── Hot leads (priority to contact) ──

export async function loadHotLeads(ctx: TenantContext, f: DeskFilters, take = 6) {
  const where = leadWhere(f, ctx.user.id);
  const leads = await ctx.db.lead.findMany({
    where: { ...where, temperature: "HOT", stage: { in: [...OPEN_STAGES] } },
    orderBy: [{ score: "desc" }, { lastContactAt: "asc" }],
    take,
    include: { scores: { orderBy: { createdAt: "desc" }, take: 1, select: { reasons: true } }, conversations: { select: { messages: { where: { direction: "INBOUND" }, orderBy: { createdAt: "desc" }, take: 3, select: { createdAt: true, body: true } } } } },
  });
  const [signals, meetings, quotes] = await Promise.all([
    signalsFor(ctx, leads),
    ctx.db.meeting.findMany({ where: { leadId: { in: leads.map((l) => l.id) }, status: { in: ["PROPOSED", "BOOKED"] } }, select: { leadId: true } }),
    ctx.db.quote.findMany({ where: { leadId: { in: leads.map((l) => l.id) } }, select: { leadId: true } }),
  ]);
  return leads.map((l) => {
    const inbound = l.conversations.flatMap((c) => c.messages).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      id: l.id,
      name: l.name,
      company: l.company,
      temperature: l.temperature,
      intent: l.intent,
      lastContactAt: l.lastContactAt?.toISOString() ?? null,
      nextAction: l.nextAction,
      reasons: temperatureReasons({
        scoreReasons: reasonsOf(l.scores[0]?.reasons),
        lastInboundAt: inbound[0]?.createdAt ?? null,
        stage: l.stage,
        hasQuote: quotes.some((q) => q.leadId === l.id),
        hasMeeting: meetings.some((m) => m.leadId === l.id),
        inboundCount: inbound.length,
        lastContactAt: l.lastContactAt,
        createdAt: l.createdAt,
        urgent: inbound.some((m) => URGENCY.test(m.body)),
      }),
      signals: signals.get(l.id) ?? [],
    };
  });
}

// ── Follow-up center ──

function followUpWhere(tab: FollowUpTab, now = new Date()): Prisma.SalesActivityWhereInput {
  const sod = new Date(now);
  sod.setHours(0, 0, 0, 0);
  const eod = new Date(sod.getTime() + DAY);
  switch (tab) {
    case "today":
      return { completedAt: null, pausedAt: null, dueAt: { gte: sod, lt: eod } };
    case "overdue":
      return { completedAt: null, pausedAt: null, dueAt: { lt: now } };
    case "week":
      return { completedAt: null, pausedAt: null, dueAt: { gte: sod, lt: new Date(sod.getTime() + 7 * DAY) } };
    case "paused":
      return { completedAt: null, pausedAt: { not: null } };
    case "done":
      return { completedAt: { not: null } };
  }
}

export async function loadFollowUps(ctx: TenantContext, f: DeskFilters, tab: FollowUpTab, page = 1) {
  const lead = leadWhere(f, ctx.user.id);
  const counts = Object.fromEntries(await Promise.all(FOLLOWUP_TABS.map(async (t) => [t, await ctx.db.salesActivity.count({ where: { ...followUpWhere(t), lead } })] as const))) as Record<FollowUpTab, number>;
  const PAGE = 25;
  const items = await ctx.db.salesActivity.findMany({
    where: { ...followUpWhere(tab), lead },
    orderBy: tab === "done" ? { completedAt: "desc" } : { dueAt: "asc" },
    take: PAGE,
    skip: (page - 1) * PAGE,
    include: { lead: { select: { ...signalSelect, name: true, company: true, email: true, phone: true, channel: true, ownerId: true } } },
  });
  const signals = await signalsFor(ctx, items.map((i) => i.lead));
  const owners = await ownersById(ctx, items.map((i) => i.assignedToId ?? i.lead.ownerId));
  return {
    counts,
    page,
    pageSize: PAGE,
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      body: i.body,
      type: i.type,
      dueAt: i.dueAt?.toISOString() ?? null,
      completedAt: i.completedAt?.toISOString() ?? null,
      pausedAt: i.pausedAt?.toISOString() ?? null,
      channel: i.channel ?? (i.lead.email ? "EMAIL" : i.lead.phone ? "WHATSAPP" : i.lead.channel),
      byAgent: Boolean(i.createdByAgent),
      owner: owners.get(i.assignedToId ?? i.lead.ownerId ?? "") ?? null,
      lead: { id: i.lead.id, name: i.lead.name, company: i.lead.company },
      signals: signals.get(i.lead.id) ?? [],
    })),
  };
}

async function ownersById(ctx: TenantContext, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map<string, string>();
  const users = await db.user.findMany({ where: { id: { in: unique }, memberships: { some: { organizationId: ctx.organization.id } } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name ?? u.email]));
}

export async function teamMembers(ctx: TenantContext) {
  const m = await db.organizationMember.findMany({ where: { organizationId: ctx.organization.id }, include: { user: { select: { id: true, name: true, email: true } } } });
  return m.map((x) => ({ id: x.user.id, name: x.user.name ?? x.user.email }));
}

// ── Conversations ──

export async function loadConversations(ctx: TenantContext, f: DeskFilters, page = 1) {
  const PAGE = 20;
  const lead = f.q || f.owner || f.stage || f.temperature || f.channel ? { lead: leadWhere(f, ctx.user.id) } : {};
  const convs = await ctx.db.conversation.findMany({
    where: { ...lead },
    orderBy: { lastMessageAt: "desc" },
    take: PAGE,
    skip: (page - 1) * PAGE,
    include: { lead: { select: { id: true, name: true, company: true } }, messages: { orderBy: { createdAt: "desc" }, take: 3, select: { direction: true, body: true, status: true, aiDrafted: true, createdAt: true } } },
  });
  return {
    page,
    pageSize: PAGE,
    items: convs.map((c) => {
      const lastReal = c.messages.find((m) => m.status === "RECEIVED" || m.status === "SENT");
      const draft = c.messages.find((m) => m.direction === "OUTBOUND" && (m.status === "DRAFT" || m.status === "PENDING_APPROVAL"));
      return {
        id: c.id,
        channel: c.channel,
        lead: c.lead,
        preview: lastReal?.body.slice(0, 160) ?? c.messages[0]?.body.slice(0, 160) ?? null,
        at: (lastReal?.createdAt ?? c.lastMessageAt).toISOString(),
        unread: lastReal?.direction === "INBOUND",
        needsHuman: draft?.status === "PENDING_APPROVAL",
        draftReady: Boolean(draft && draft.aiDrafted),
      };
    }),
  };
}

// ── B2B opportunities ──

export async function loadB2B(ctx: TenantContext, f: DeskFilters) {
  const opps = await ctx.db.salesOpportunity.findMany({
    where: { kind: "B2B", lead: leadWhere(f, ctx.user.id) },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 60,
    include: { lead: { select: { id: true, name: true, company: true, email: true, phone: true, stage: true, source: true } } },
  });
  const owners = await ownersById(ctx, opps.map((o) => o.ownerId));
  return opps.map((o) => ({
    id: o.id,
    title: o.title,
    status: o.status,
    value: o.valueCents != null ? { cents: o.valueCents, currency: o.currency } : null,
    industry: o.industry,
    need: o.need,
    decisionMaker: o.decisionMaker,
    nextStep: o.nextStep,
    nextStepAt: o.nextStepAt?.toISOString() ?? null,
    expectedCloseAt: o.expectedCloseAt?.toISOString() ?? null,
    source: o.source ?? o.lead.source,
    owner: owners.get(o.ownerId ?? "") ?? null,
    summary: o.summary,
    lead: o.lead,
  }));
}

// ── Quotes ──

export async function loadQuotes(ctx: TenantContext) {
  const quotes = await ctx.db.quote.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  const leads = await ctx.db.lead.findMany({ where: { id: { in: quotes.map((q) => q.leadId) } }, select: { id: true, name: true, company: true } });
  return quotes.map((q) => ({
    id: q.id,
    number: q.number,
    title: q.title,
    status: q.status,
    total: { cents: q.totalCents, currency: q.currency },
    discountCents: q.discountCents,
    validUntil: q.validUntil?.toISOString() ?? null,
    approved: Boolean(q.approvedAt),
    sentAt: q.sentAt?.toISOString() ?? null,
    sentVia: q.sentVia,
    createdAt: q.createdAt.toISOString(),
    lead: leads.find((l) => l.id === q.leadId) ?? null,
  }));
}

// ── Forecast & insights (open leads, capped) ──

async function openLeadsWithValue(ctx: TenantContext, f: DeskFilters) {
  return ctx.db.lead.findMany({
    where: { ...leadWhere(f, ctx.user.id), stage: { in: [...OPEN_STAGES, "WON"] } },
    select: { ...signalSelect, source: true, estimatedValueCents: true, currency: true, opportunities: { where: { status: { in: ["OPEN", "WON"] } }, select: { valueCents: true, currency: true, status: true } } },
    take: 1000,
    orderBy: { updatedAt: "desc" },
  });
}

export async function loadForecast(ctx: TenantContext, f: DeskFilters) {
  const [leads, stages, currency] = await Promise.all([openLeadsWithValue(ctx, f), ctx.db.pipelineStage.findMany(), mainCurrency(ctx)]);
  const prob = Object.fromEntries(stages.map((s) => [s.stage, s.probability]));
  const rows = leads.map((l) => ({ stage: l.stage, value: leadValue(l, l.opportunities, l.stage === "WON" ? "WON" : "OPEN") }));
  const byStage = stages
    .filter((s) => isOpen(s.stage))
    .sort((a, b) => a.position - b.position)
    .map((s) => {
      const f2 = forecast(rows.filter((r) => r.stage === s.stage), prob, currency);
      return { stage: s.stage, label: s.label, probability: s.probability, count: f2.openCount, withValue: f2.openWithValue, value: f2.pipeline, weighted: f2.weighted };
    });
  return { ...forecast(rows, prob, currency), currency, byStage };
}

export async function loadInsights(ctx: TenantContext, f: DeskFilters) {
  const leads = await openLeadsWithValue(ctx, f);
  const signals = await signalsFor(ctx, leads.filter((l) => isOpen(l.stage)));
  return salesInsights(leads.map((l) => ({ id: l.id, stage: l.stage, temperature: l.temperature, source: l.source, createdAt: l.createdAt, stageChangedAt: l.stageChangedAt, value: leadValue(l, l.opportunities), signals: signals.get(l.id) ?? [] })));
}

// ── Activity feed & opportunity log (immutable lead_events) ──

const LOG_TYPES = ["STATUS_CHANGE", "OPPORTUNITY", "QUOTE", "PROPOSAL", "MEETING"] as const;

export async function loadActivity(ctx: TenantContext, f: DeskFilters, page = 1, onlyOpportunityLog = false) {
  const PAGE = 30;
  const events = await ctx.db.leadEvent.findMany({
    where: { lead: leadWhere(f, ctx.user.id), ...(onlyOpportunityLog ? { type: { in: [...LOG_TYPES] } } : {}) },
    orderBy: { createdAt: "desc" },
    take: PAGE + 1,
    skip: (page - 1) * PAGE,
    include: { lead: { select: { id: true, name: true, company: true, opportunities: { select: { title: true }, take: 1, orderBy: { createdAt: "desc" } } } } },
  });
  const owners = await ownersById(ctx, events.filter((e) => e.actorType === "USER").map((e) => e.actorId));
  return {
    page,
    hasMore: events.length > PAGE,
    items: events.slice(0, PAGE).map((e) => {
      const d = (e.data ?? {}) as { from?: string; to?: string; valueFrom?: number | null; valueTo?: number | null; currency?: string };
      return {
        id: e.id,
        type: e.type,
        title: e.title,
        body: e.body?.slice(0, 240) ?? null,
        at: e.createdAt.toISOString(),
        actor: e.actorType === "USER" ? (owners.get(e.actorId ?? "") ?? null) : e.actorType,
        lead: { id: e.lead.id, name: e.lead.name, company: e.lead.company },
        opportunity: e.lead.opportunities[0]?.title ?? null,
        from: d.from ?? null,
        to: d.to ?? null,
        valueChange: d.valueTo !== undefined ? { from: d.valueFrom ?? null, to: d.valueTo ?? null, currency: d.currency ?? "USD" } : null,
      };
    }),
  };
}

// ── Customers log (paginated, searchable) ──

export async function loadCustomers(ctx: TenantContext, f: DeskFilters, page = 1) {
  const PAGE = 30;
  const where = leadWhere(f, ctx.user.id);
  const [total, leads] = await Promise.all([
    ctx.db.lead.count({ where }),
    ctx.db.lead.findMany({ where, orderBy: [{ updatedAt: "desc" }], take: PAGE, skip: (page - 1) * PAGE, include: { opportunities: { where: { status: { in: ["OPEN", "WON"] } }, select: { valueCents: true, currency: true, status: true } } } }),
  ]);
  const owners = await ownersById(ctx, leads.map((l) => l.ownerId));
  return {
    total,
    page,
    pageSize: PAGE,
    items: leads.map((l) => ({
      id: l.id,
      name: l.name,
      company: l.company,
      email: l.email,
      phone: l.phone,
      stage: l.stage,
      temperature: l.temperature,
      source: l.source,
      channel: l.channel,
      value: leadValue(l, l.opportunities, l.stage === "WON" ? "WON" : "OPEN"),
      owner: owners.get(l.ownerId ?? "") ?? null,
      lastContactAt: l.lastContactAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}

// ── Customer drawer ──

export async function leadDrawer(ctx: TenantContext, id: string) {
  const l = await ctx.db.lead.findUnique({
    where: { id },
    include: {
      opportunities: { orderBy: { createdAt: "desc" }, take: 5 },
      activities: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 5 },
      notes: { orderBy: { createdAt: "desc" }, take: 3 },
      events: { orderBy: { createdAt: "desc" }, take: 8 },
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      conversations: { orderBy: { lastMessageAt: "desc" }, take: 2, include: { messages: { orderBy: { createdAt: "desc" }, take: 3 } } },
    },
  });
  if (!l) return null;
  const [signals, quotes, meetings, stages] = await Promise.all([
    signalsFor(ctx, [l]),
    ctx.db.quote.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" }, take: 3 }),
    ctx.db.meeting.findMany({ where: { leadId: id, status: { in: ["PROPOSED", "BOOKED"] } }, take: 2 }),
    ctx.db.pipelineStage.findMany({ orderBy: { position: "asc" } }),
  ]);
  const inbound = l.conversations.flatMap((c) => c.messages).filter((m) => m.direction === "INBOUND");
  const owner = (await ownersById(ctx, [l.ownerId])).get(l.ownerId ?? "") ?? null;
  return {
    id: l.id,
    name: l.name,
    company: l.company,
    email: l.email,
    phone: l.phone,
    stage: l.stage,
    temperature: l.temperature,
    source: l.source,
    channel: l.channel,
    owner,
    summary: l.summary,
    intent: l.intent,
    nextAction: l.nextAction,
    nextActionAt: l.nextActionAt?.toISOString() ?? null,
    value: leadValue(l, l.opportunities, l.stage === "WON" ? "WON" : "OPEN"),
    reasons: temperatureReasons({ scoreReasons: reasonsOf(l.scores[0]?.reasons), lastInboundAt: inbound[0]?.createdAt ?? null, stage: l.stage, hasQuote: quotes.length > 0, hasMeeting: meetings.length > 0, inboundCount: inbound.length, lastContactAt: l.lastContactAt, createdAt: l.createdAt, urgent: inbound.some((m) => URGENCY.test(m.body)) }),
    signals: signals.get(l.id) ?? [],
    opportunities: l.opportunities.map((o) => ({ id: o.id, title: o.title, status: o.status, kind: o.kind, value: o.valueCents != null ? { cents: o.valueCents, currency: o.currency } : null, nextStep: o.nextStep })),
    followUps: l.activities.map((a) => ({ id: a.id, title: a.title, dueAt: a.dueAt?.toISOString() ?? null, paused: Boolean(a.pausedAt) })),
    notes: l.notes.map((n) => ({ id: n.id, body: n.body, at: n.createdAt.toISOString() })),
    timeline: l.events.map((e) => ({ id: e.id, type: e.type, title: e.title, at: e.createdAt.toISOString() })),
    conversation: l.conversations.flatMap((c) => c.messages.map((m) => ({ id: m.id, direction: m.direction, body: m.body.slice(0, 280), status: m.status, at: m.createdAt.toISOString(), channel: c.channel }))).slice(0, 4),
    quotes: quotes.map((q) => ({ id: q.id, number: q.number, status: q.status, total: { cents: q.totalCents, currency: q.currency } })),
    stages: stages.map((s) => ({ stage: s.stage, label: s.label })),
  };
}
