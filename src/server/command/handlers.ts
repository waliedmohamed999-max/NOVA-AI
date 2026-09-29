import type { Lead } from "@/generated/prisma/client";
import type { TenantContext } from "../context";
import type { TenantScope } from "../db/tenant";
import { aiAvailability, contentAiConfigured } from "../ai";
import { startRun } from "../agents/runtime";
import { CAMPAIGN_STEPS, CONTENT_PLAN_STEPS } from "../agents/workflows/content";
import { normalize } from "./parse";
import { FOLLOWUP_STEPS } from "../agents/workflows/sales";
import { createLead, moveLeadStage, scheduleFollowUp } from "../sales/service";
import { createOpportunity, createQuote, importLeads, importRow, MAX_IMPORT, previewImport, quoteNeedsApproval, runSalesCycle, sendQuote, type ImportRow } from "../sales/operations";
import { deskSummary } from "../sales/desk";
import { guessMapping, OPEN_STAGES, parseCsv, SIGNAL_RULES } from "../sales/intelligence";
import { APPROVAL_PERMISSION, decideApproval } from "../approvals/service";
import { performanceDigest, loadMetricRows } from "../analytics/digest";
import { formatPct } from "../analytics/compare";
import { localParts } from "../reports/service";
import { storage } from "../storage";
import type { IntentDef, IntentKey, RoutingMode } from "./registry";
import type { CommandResponse, Msg, Params, Plan, Receipt, ResultAction, ResultItem } from "./types";

const DAY = 86_400_000;

export type HandlerInput = {
  ctx: TenantContext;
  scope: TenantScope;
  def: IntentDef;
  params: Params;
  plan: Plan | null;
  confirmed: boolean;
  locale: "ar" | "en";
};

export type Outcome = Omit<CommandResponse, "executionId" | "intent" | "type" | "aiUsed"> & {
  plan?: Plan | null;
  receipt?: Receipt | null;
  approvalRequired?: boolean;
  /** The approval-gated action this command resolved to (activity log). */
  action?: string | null;
  /** Routing actually used (a brain question may escalate to brain_ai). */
  mode?: RoutingMode;
  /** Company Brain retrieval metrics for the activity log. */
  metrics?: { contextTokens?: number; retrievedItems?: number; brainVersion?: string };
};

export const actor = (ctx: TenantContext) => ({ type: "USER" as const, id: ctx.user.id, label: ctx.user.name ?? ctx.user.email });
export const receipt = (action: string, entity: string, entityId: string, status = "done"): Receipt => ({ action, entity, entityId, status, at: new Date().toISOString() });
export const msg = (key: string, values?: Msg["values"]): Msg => ({ key, values });

/** Start of the organization's local day (UTC instant), offset by `days`, at `hour` local time. */
export function localDay(tz: string, days = 0, hour = 0) {
  const now = new Date();
  const local = localParts(tz, now);
  const offsetHours = ((local.hour - now.getUTCHours() + 36) % 24) - 12;
  return new Date(Date.parse(`${local.date}T00:00:00.000Z`) - offsetHours * 3_600_000 + days * DAY + hour * 3_600_000);
}

export function formatWhen(d: Date, tz: string, locale: "ar" | "en") {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-US", { weekday: "long", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
}

export function money(cents: number, currency: string, locale: "ar" | "en") {
  return new Intl.NumberFormat(locale === "ar" ? "ar" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

// ── Entity resolution (tenant-scoped; never trusts an id from the client) ──

type LeadRow = Pick<Lead, "id" | "name" | "company" | "stage" | "email">;

export async function findLeads(ctx: TenantContext, name: string): Promise<LeadRow[]> {
  const variants = [name];
  // "لأحمد" → also try "أحمد" (a joined Arabic preposition), never the other way round.
  if (/^ل[؀-ۿ]{2,}/.test(name)) variants.push(name.slice(1));
  for (const q of variants) {
    const rows = await ctx.db.lead.findMany({
      where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }] },
      select: { id: true, name: true, company: true, stage: true, email: true },
      orderBy: { updatedAt: "desc" },
      take: 6,
    });
    if (rows.length) {
      const exact = rows.filter((r) => r.name.toLowerCase() === q.toLowerCase() || r.company?.toLowerCase() === q.toLowerCase());
      return exact.length === 1 ? exact : rows;
    }
  }
  return [];
}

/** Resolves the customer the command is about: one match → continue; several → ask; none → say so. No guessing. */
export async function withLead(h: HandlerInput, next: (lead: LeadRow) => Promise<Outcome>, opts: { askKey?: string } = {}): Promise<Outcome> {
  if (h.params.leadId) {
    const lead = await h.ctx.db.lead.findUnique({ where: { id: h.params.leadId }, select: { id: true, name: true, company: true, stage: true, email: true } });
    if (!lead) return { status: "failed", message: msg("leadGone"), reason: "lead_not_found" };
    return next(lead);
  }
  const name = h.params.name;
  if (!name) return { status: "needs_input", message: msg(opts.askKey ?? "needLead"), actions: [{ label: "openCustomers", href: "/sales?view=customers" }] };
  const found = await findLeads(h.ctx, name);
  if (!found.length) return { status: "needs_input", message: msg("leadNotFound", { name }), actions: [{ label: "openCustomers", href: `/sales?view=customers&q=${encodeURIComponent(name)}` }] };
  if (found.length === 1) return next(found[0]);
  return {
    status: "needs_choice",
    message: msg("whichLead", { name, count: found.length }),
    choices: found.map((l, index) => ({ index, title: l.name, subtitle: l.company })),
    plan: { step: "choice", params: h.params, candidates: found.map((l) => l.id) },
  };
}

/** Generation was needed and no real AI provider is set up — local and brain commands keep working. */
export const aiUnavailable = (reason = "ai_not_configured"): Outcome => ({ status: "ai_unavailable", message: msg("aiGenerationRequired"), reason, actions: [{ label: "openAiSettings", href: "/settings/ai" }] });

// ── Reads ──

async function followUps(h: HandlerInput, overdueOnly: boolean): Promise<Outcome> {
  const tz = h.ctx.organization.timezone;
  const start = localDay(tz, 0);
  const end = localDay(tz, 1);
  const rows = await h.ctx.db.salesActivity.findMany({
    where: { completedAt: null, pausedAt: null, dueAt: overdueOnly ? { lt: start } : { lt: end } },
    include: { lead: { select: { id: true, name: true, company: true } } },
    orderBy: { dueAt: "asc" },
    take: 100,
  });
  const leads = new Map(rows.map((r) => [r.leadId, r]));
  const overdue = new Set(rows.filter((r) => r.dueAt && r.dueAt < start).map((r) => r.leadId)).size;
  const count = leads.size;
  const items: ResultItem[] = [...leads.values()].slice(0, 5).map((r) => ({ title: r.lead.name, subtitle: r.title, href: `/leads/${r.lead.id}`, badge: r.dueAt && r.dueAt < start ? "overdue" : "today" }));
  const actions: ResultAction[] = [{ label: "openFollowups", href: `/sales?view=followups&tab=${overdueOnly ? "overdue" : "today"}`, primary: true }];
  if (count && h.ctx.can("leads:manage")) actions.push({ label: "prepareFollowups", command: "prepareFollowups" });
  return {
    status: "completed",
    message: count ? msg(overdueOnly ? "overdueFound" : "followupsFound", { count }) : msg(overdueOnly ? "noOverdue" : "noFollowups"),
    items,
    stats: overdueOnly ? [{ key: "overdue", value: overdue }] : [{ key: "customers", value: count }, { key: "overdue", value: overdue }],
    actions,
  };
}

async function hotLeads(h: HandlerInput): Promise<Outcome> {
  const where = { temperature: "HOT" as const, stage: { in: [...OPEN_STAGES] } };
  const [count, rows] = await Promise.all([h.ctx.db.lead.count({ where }), h.ctx.db.lead.findMany({ where, orderBy: [{ score: "desc" }], take: 5, select: { id: true, name: true, company: true, nextAction: true } })]);
  return {
    status: "completed",
    message: count ? msg("hotFound", { count }) : msg("noHot"),
    items: rows.map((l) => ({ title: l.name, subtitle: l.nextAction ?? l.company, href: `/leads/${l.id}`, badge: "hot" })),
    actions: [{ label: "openHot", href: "/sales?view=hot", primary: true }],
  };
}

async function stalledDeals(h: HandlerInput): Promise<Outcome> {
  const where = { stage: { in: ["CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION"] as ("CONTACTED" | "QUALIFIED" | "PROPOSAL" | "NEGOTIATION")[] }, stageChangedAt: { lt: new Date(Date.now() - SIGNAL_RULES.stalledDays * DAY) } };
  const [count, rows] = await Promise.all([h.ctx.db.lead.count({ where }), h.ctx.db.lead.findMany({ where, orderBy: { stageChangedAt: "asc" }, take: 5, select: { id: true, name: true, stage: true, stageChangedAt: true } })]);
  return {
    status: "completed",
    message: count ? msg("stalledFound", { count, days: SIGNAL_RULES.stalledDays }) : msg("noStalled", { days: SIGNAL_RULES.stalledDays }),
    items: rows.map((l) => ({ title: l.name, subtitle: l.stage, href: `/leads/${l.id}`, badge: `${Math.floor((Date.now() - l.stageChangedAt.getTime()) / DAY)}d` })),
    actions: [{ label: "openPipeline", href: "/sales?view=pipeline", primary: true }],
  };
}

async function salesSummary(h: HandlerInput): Promise<Outcome> {
  const s = await deskSummary(h.ctx, {});
  if (s.hero.customers === 0) return { status: "completed", message: msg("noSalesData"), actions: [{ label: "addCustomer", command: "addFirstCustomer", primary: true }, { label: "openSales", href: "/sales" }] };
  const open = await h.ctx.db.lead.groupBy({ by: ["currency"], where: { stage: { in: [...OPEN_STAGES] }, estimatedValueCents: { not: null } }, _sum: { estimatedValueCents: true } });
  const stats: { key: string; value: string | number }[] = [
    { key: "openDeals", value: s.hero.openOpportunities },
    { key: "hot", value: s.kpis.hot },
    { key: "overdue", value: s.kpis.overdue },
    { key: "dueToday", value: s.brief.dueToday },
    { key: "stalled", value: s.brief.stalled },
    { key: "won", value: s.kpis.won },
  ];
  for (const o of open.filter((x) => x._sum.estimatedValueCents)) stats.push({ key: "pipelineValue", value: money(o._sum.estimatedValueCents!, o.currency, h.locale) });
  return {
    status: "completed",
    message: msg("salesSummary", { open: s.hero.openOpportunities, hot: s.kpis.hot, overdue: s.kpis.overdue }),
    stats,
    actions: [{ label: "openSales", href: "/sales", primary: true }, { label: "openPipeline", href: "/sales?view=pipeline" }],
  };
}

async function approvalsSummary(h: HandlerInput): Promise<Outcome> {
  const groups = await h.ctx.db.approval.groupBy({ by: ["category"], where: { status: "PENDING" }, _count: true });
  const total = groups.reduce((a, g) => a + g._count, 0);
  return {
    status: "completed",
    message: total ? msg("approvalsPending", { count: total }) : msg("noApprovals"),
    stats: groups.map((g) => ({ key: `approval_${g.category}`, value: g._count })),
    actions: [{ label: "openApprovals", href: "/approvals", primary: true }],
  };
}

async function salesBrief(h: HandlerInput): Promise<Outcome> {
  const brief = await h.ctx.db.report.findFirst({ where: { kind: "DAILY_BRIEF" }, orderBy: { periodStart: "desc" } });
  if (!brief?.narrative) return { status: "completed", message: msg("noBrief"), actions: [{ label: "openReports", href: "/reports" }] };
  return { status: "completed", message: msg("briefReady"), text: brief.narrative.slice(0, 1500), actions: [{ label: "openReports", href: "/reports", primary: true }] };
}

async function analyticsSummary(h: HandlerInput): Promise<Outcome> {
  const days = /شهر|month/.test(h.params.input ?? "") ? 30 : 7;
  const d = await performanceDigest(h.scope, days);
  if (!d.hasData) return { status: "completed", message: msg("noAnalytics", { days }), actions: [{ label: "openAnalytics", href: "/analytics" }] };
  return {
    status: "completed",
    message: msg("analyticsSummary", { posts: d.posts, days }),
    stats: [{ key: "posts", value: d.posts }, ...(d.avgEngagement != null ? [{ key: "engagement", value: `${(d.avgEngagement * 100).toFixed(2)}%` }] : [])],
    items: d.findings.slice(0, 4).map((f) => ({ title: `${f.dimension}: ${f.key}`, subtitle: `${formatPct(f.change)} · ${f.groupPosts}`, badge: f.kind })),
    actions: [{ label: "openAnalytics", href: "/analytics", primary: true }],
  };
}

async function bestContent(h: HandlerInput): Promise<Outcome> {
  const rows = (await loadMetricRows(h.scope, 30)).filter((r) => r.engagementRate != null).sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0)).slice(0, 5);
  if (!rows.length) return { status: "completed", message: msg("noAnalytics", { days: 30 }), actions: [{ label: "openAnalytics", href: "/analytics" }] };
  const posts = await h.ctx.db.socialPost.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, caption: true, contentItem: { select: { id: true, title: true } } } });
  return {
    status: "completed",
    message: msg("bestContent", { count: rows.length }),
    items: rows.map((r) => {
      const p = posts.find((x) => x.id === r.id);
      return { title: p?.contentItem?.title ?? p?.caption?.slice(0, 80) ?? r.platform, subtitle: `${((r.engagementRate ?? 0) * 100).toFixed(2)}%`, href: p?.contentItem ? `/content/${p.contentItem.id}` : "/analytics", badge: r.platform };
    }),
    actions: [{ label: "openAnalytics", href: "/analytics", primary: true }],
  };
}

async function leadSources(h: HandlerInput): Promise<Outcome> {
  const since = new Date(Date.now() - 90 * DAY);
  const [all, won] = await Promise.all([
    h.ctx.db.lead.groupBy({ by: ["source"], where: { createdAt: { gte: since } }, _count: true, orderBy: { _count: { source: "desc" } }, take: 6 }),
    h.ctx.db.lead.groupBy({ by: ["source"], where: { createdAt: { gte: since }, stage: "WON" }, _count: true }),
  ]);
  const total = all.reduce((a, g) => a + g._count, 0);
  if (!total) return { status: "completed", message: msg("noLeadSources"), actions: [{ label: "openSales", href: "/sales" }] };
  return {
    status: "completed",
    message: msg("leadSources", { total, days: 90 }),
    items: all.map((g) => ({ title: g.source ?? "—", subtitle: `${g._count}`, badge: `${won.find((w) => w.source === g.source)?._count ?? 0} won` })),
    actions: [{ label: "openAnalytics", href: "/analytics", primary: true }],
  };
}

async function campaignSummary(h: HandlerInput): Promise<Outcome> {
  const groups = await h.ctx.db.campaign.groupBy({ by: ["status"], _count: true });
  const total = groups.reduce((a, g) => a + g._count, 0);
  if (!total) return { status: "completed", message: msg("noCampaigns"), actions: [{ label: "openCampaigns", href: "/campaigns" }] };
  const recent = await h.ctx.db.campaign.findMany({ orderBy: { updatedAt: "desc" }, take: 4, select: { id: true, name: true, status: true } });
  return {
    status: "completed",
    message: msg("campaignSummary", { count: total }),
    stats: groups.map((g) => ({ key: `campaign_${g.status}`, value: g._count })),
    items: recent.map((c) => ({ title: c.name, badge: c.status, href: `/campaigns/${c.id}` })),
    actions: [{ label: "openCampaigns", href: "/campaigns", primary: true }],
  };
}

// ── Actions ──

async function createFollowup(h: HandlerInput): Promise<Outcome> {
  return withLead(h, async (lead) => {
    const tz = h.ctx.organization.timezone;
    const days = h.params.date?.offsetDays ?? 1;
    let dueAt = localDay(tz, days, 10);
    if (dueAt.getTime() < Date.now()) dueAt = new Date(Date.now() + 3_600_000);
    const title = h.params.topic?.slice(0, 200) ?? (h.locale === "ar" ? `متابعة ${lead.name}` : `Follow up with ${lead.name}`);
    const a = await scheduleFollowUp(h.scope, lead.id, { title, dueAt, createdById: h.ctx.user.id, assignedToId: h.ctx.user.id });
    return {
      status: "completed",
      message: msg(h.params.date ? "followupCreated" : "followupCreatedDefault", { name: lead.name, when: formatWhen(dueAt, tz, h.locale) }),
      actions: [{ label: "openLead", href: `/leads/${lead.id}`, primary: true }, { label: "openFollowups", href: "/sales?view=followups&tab=week" }],
      receipt: receipt("followup.created", "SalesActivity", a.id),
    };
  });
}

async function createCustomer(h: HandlerInput): Promise<Outcome> {
  const name = h.params.name;
  if (!name) return { status: "needs_input", message: msg("needLeadName"), actions: [{ label: "addCustomerForm", href: "/sales?view=customers", primary: true }] };
  if (!h.confirmed) {
    const dup = await h.ctx.db.lead.findFirst({
      where: { OR: [{ name: { equals: name, mode: "insensitive" } }, ...(h.params.email ? [{ email: h.params.email }] : []), ...(h.params.phone ? [{ phone: h.params.phone }] : [])] },
      select: { id: true, name: true },
    });
    if (dup) return { status: "needs_confirmation", message: msg("leadExists", { name: dup.name }), confirmLabel: "createAnyway", actions: [{ label: "openLead", href: `/leads/${dup.id}` }], plan: { step: "confirm", params: h.params } };
  }
  const lead = await createLead(
    h.scope,
    { name, email: h.params.email, phone: h.params.phone, channel: "MANUAL", source: "Command Center", ownerId: h.ctx.user.id, estimatedValueCents: h.params.value != null ? Math.round(h.params.value * 100) : null },
    actor(h.ctx),
    { qualify: aiAvailability().configured },
  );
  return {
    status: "completed",
    message: msg("leadCreated", { name: lead.name }),
    actions: [{ label: "openLead", href: `/leads/${lead.id}`, primary: true }],
    receipt: receipt("lead.created", "Lead", lead.id),
  };
}

async function createB2B(h: HandlerInput): Promise<Outcome> {
  const company = h.params.name;
  if (!company && !h.params.leadId) return { status: "needs_input", message: msg("needCompany"), actions: [{ label: "openB2B", href: "/sales?view=b2b" }] };
  const kind = h.params.b2b || h.def.key === "create_b2b_opportunity" ? "B2B" : "DEAL";
  const create = async (leadId: string | undefined, label: string) => {
    const opp = await createOpportunity(
      h.scope,
      { leadId, company: leadId ? undefined : label, title: `${kind === "B2B" ? "B2B" : h.locale === "ar" ? "صفقة" : "Deal"} — ${label}`, kind, value: h.params.value, source: "Command Center", ownerId: h.ctx.user.id },
      actor(h.ctx),
    );
    return {
      status: "completed" as const,
      message: msg("opportunityCreated", { name: label }),
      actions: [{ label: "openLead", href: `/leads/${opp.leadId}`, primary: true }, { label: "openB2B", href: "/sales?view=b2b" }],
      receipt: receipt("opportunity.created", "SalesOpportunity", opp.id),
    };
  };
  if (h.params.leadId) return withLead(h, (lead) => create(lead.id, lead.company ?? lead.name));
  const found = await findLeads(h.ctx, company!);
  if (!found.length) return create(undefined, company!); // a new B2B customer with that company name
  return withLead(h, (lead) => create(lead.id, lead.company ?? lead.name));
}

async function createQuoteCmd(h: HandlerInput): Promise<Outcome> {
  return withLead(h, async (lead) => {
    if (!h.params.value) return { status: "needs_input", message: msg("quoteNeedsAmount", { name: lead.name }), actions: [{ label: "openLead", href: `/leads/${lead.id}`, primary: true }] };
    const q = await createQuote(h.scope, { leadId: lead.id, title: h.params.topic ?? (h.locale === "ar" ? `عرض سعر — ${lead.name}` : `Quote — ${lead.name}`), items: [{ description: h.params.topic ?? (h.locale === "ar" ? "الخدمة" : "Services"), quantity: 1, unitPrice: h.params.value }] }, actor(h.ctx));
    const pending = q.status === "NEEDS_APPROVAL";
    return {
      status: pending ? "needs_approval" : "completed",
      message: msg(pending ? "quoteNeedsApproval" : "quoteCreated", { number: q.number, name: lead.name, total: money(q.totalCents, q.currency, h.locale) }),
      actions: [{ label: "openLead", href: `/leads/${lead.id}`, primary: true }, { label: "openQuotes", href: "/sales?view=quotes" }],
      receipt: receipt("quote.created", "Quote", q.id, q.status),
      approvalRequired: pending,
    };
  });
}

async function importCustomers(h: HandlerInput): Promise<Outcome> {
  if (h.confirmed && h.plan?.data?.rows) {
    const r = await importLeads(h.scope, h.plan.data.rows as ImportRow[], actor(h.ctx));
    return {
      status: r.created ? "completed" : "partial",
      message: msg("importDone", { created: r.created, skipped: r.skipped }),
      actions: [{ label: "openCustomers", href: "/sales?view=customers", primary: true }],
      receipt: receipt("leads.imported", "Lead", "batch", `${r.created} created`),
    };
  }
  const ids = h.params.fileIds ?? [];
  if (!ids.length) return { status: "needs_input", message: msg("needCsv") };
  // Only this tenant's uploads, only CSV, bounded size — never read an arbitrary file.
  const file = await h.ctx.db.fileObject.findFirst({ where: { id: { in: ids }, deletedAt: null } });
  if (!file) return { status: "failed", message: msg("fileNotFound"), reason: "item_not_found" };
  if (!(file.mimeType === "text/csv" || file.fileName.toLowerCase().endsWith(".csv"))) return { status: "needs_input", message: msg("needCsv") };
  if (file.sizeBytes > 2_000_000) return { status: "failed", message: msg("fileTooLarge"), reason: "file_too_large" };
  const table = parseCsv((await storage.get(file.storageKey)).toString("utf8"));
  const [headers, ...body] = table;
  if (!headers || !body.length) return { status: "failed", message: msg("csvEmpty"), reason: "validation" };
  const mapping = guessMapping(headers);
  const rows: ImportRow[] = body.slice(0, MAX_IMPORT).map((cells) => {
    const row: Record<string, string> = {};
    for (const [i, field] of Object.entries(mapping)) if (field && cells[Number(i)]?.trim()) row[field] = cells[Number(i)].trim();
    return importRow.parse(row);
  });
  const preview = await previewImport(h.scope, rows);
  const ok = preview.filter((p) => p.status === "ok").length;
  const dup = preview.filter((p) => p.status === "duplicate").length;
  const invalid = preview.filter((p) => p.status === "invalid").length;
  if (!ok) return { status: "completed", message: msg("importNothing", { dup, invalid }) };
  return {
    status: "needs_confirmation",
    message: msg("importPreview", { ok, file: file.fileName }),
    preview: [msg("previewImportNew", { count: ok }), ...(dup ? [msg("previewImportDup", { count: dup })] : []), ...(invalid ? [msg("previewImportInvalid", { count: invalid })] : [])],
    items: preview.filter((p) => p.status === "ok").slice(0, 5).map((p) => ({ title: p.row.name ?? p.row.company ?? p.row.email ?? "—", subtitle: p.row.company ?? p.row.email })),
    confirmLabel: "importNow",
    plan: { step: "confirm", params: h.params, data: { rows } },
  };
}

async function prepareFollowups(h: HandlerInput): Promise<Outcome> {
  if (!aiAvailability().configured) return aiUnavailable();
  const due = await h.ctx.db.salesActivity.findMany({ where: { completedAt: null, pausedAt: null, dueAt: { lte: localDay(h.ctx.organization.timezone, 1) } }, select: { leadId: true }, orderBy: { dueAt: "asc" }, take: 30 });
  const leadIds = [...new Set(due.map((d) => d.leadId))].slice(0, 10);
  // "Follow up with hot leads" → the Sales Agent's default set (hottest open leads); otherwise the due follow-ups.
  const hotOnly = /ساخن|مهتم|hot|warm/.test(normalize(h.params.input ?? ""));
  if (hotOnly && !(await h.ctx.db.lead.count({ where: { temperature: { in: ["HOT", "WARM"] }, stage: { in: [...OPEN_STAGES] } } }))) return { status: "completed", message: msg("noHot") };
  if (!hotOnly && !leadIds.length) return { status: "completed", message: msg("nothingDue"), actions: [{ label: "openFollowups", href: "/sales?view=followups&tab=week" }] };
  const run = await startRun(h.scope, { kind: "leads_followup", agent: "SALES_AGENT", steps: FOLLOWUP_STEPS, params: hotOnly ? {} : { leadIds }, requestedById: h.ctx.user.id });
  return { status: "queued", message: msg("started"), runId: run.id, receipt: receipt("followups.prepare", "AgentRun", run.id, "queued"), approvalRequired: true, action: "draft_messages" };
}

const BIG_BATCH = 8;
const MAX_BATCH = 14;

async function prepareContent(h: HandlerInput): Promise<Outcome> {
  if (!aiAvailability().configured) return aiUnavailable();
  const input = h.params.input ?? "";
  const requested = h.params.count ?? (/اسبوع|week/.test(input) ? 7 : 1);
  const count = Math.min(MAX_BATCH, Math.max(1, requested));
  const { imagesConfigured } = await import("../studio/images");
  const withDesigns = imagesConfigured() && /تصميم|تصاميم|صور|design|visual|image/.test(input);
  if (!h.confirmed && (requested >= BIG_BATCH || requested > MAX_BATCH)) {
    return {
      status: "needs_confirmation",
      message: msg("previewTitle"),
      preview: [
        msg("previewPosts", { count }),
        msg(h.params.platform ? "previewPlatform" : "previewPlatforms", { platform: h.params.platform ?? "" }),
        ...(requested > MAX_BATCH ? [msg("previewCapped", { requested, max: MAX_BATCH })] : []),
        msg(withDesigns ? "previewDesigns" : "previewNoDesigns"),
        msg("previewApproval"),
      ],
      confirmLabel: "run",
      actions: [{ label: "edit", command: "__edit" }],
      plan: { step: "confirm", params: h.params },
    };
  }
  const startDate = h.params.date ? localDay(h.ctx.organization.timezone, h.params.date.offsetDays).toISOString() : undefined;
  const run = await startRun(h.scope, {
    kind: "content_plan",
    agent: "CONTENT_STRATEGIST",
    steps: CONTENT_PLAN_STEPS,
    input: input || `Create ${count} posts for next week`,
    params: { count, platform: h.params.platform, topic: h.params.topic, withDesigns, ...(startDate ? { startDate } : {}), requested: count },
    requestedById: h.ctx.user.id,
  });
  return { status: "queued", message: msg("started"), runId: run.id, receipt: receipt("content.plan", "AgentRun", run.id, "queued") };
}

async function createCampaign(h: HandlerInput): Promise<Outcome> {
  if (!aiAvailability().configured) return aiUnavailable();
  const run = await startRun(h.scope, { kind: "campaign", agent: "SOCIAL_MANAGER", steps: CAMPAIGN_STEPS, input: h.params.input ?? "", params: { topic: h.params.topic ?? h.params.name }, requestedById: h.ctx.user.id });
  return { status: "queued", message: msg("started"), runId: run.id, receipt: receipt("campaign.plan", "AgentRun", run.id, "queued"), approvalRequired: true };
}

async function latestEditable(h: HandlerInput) {
  return h.ctx.db.contentItem.findFirst({ where: { status: { notIn: ["PUBLISHED", "PUBLISHING"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true } });
}

async function improveLatest(h: HandlerInput): Promise<Outcome> {
  if (!contentAiConfigured()) return aiUnavailable("content_ai_not_configured");
  const { improveContent, applyVersion } = await import("../studio/content");
  if (h.confirmed && h.plan?.data?.contentItemId) {
    const d = h.plan.data as { contentItemId: string; title: string; fields: { hook: string | null; caption: string; cta: string | null; hashtags: string[] }; reasons: string[]; promptVersion: string | null };
    const version = await applyVersion(h.scope, d.contentItemId, d.fields, { source: "ai_improve", reasons: d.reasons.slice(0, 3), promptVersion: d.promptVersion }, { userId: h.ctx.user.id });
    return { status: "completed", message: msg("improvedApplied", { title: d.title }), actions: [{ label: "openPost", href: `/content/${d.contentItemId}`, primary: true }], receipt: receipt("content.improved", "ContentItem", d.contentItemId, `v${version}`) };
  }
  const item = await latestEditable(h);
  if (!item) return { status: "needs_input", message: msg("noContentYet"), actions: [{ label: "prepareWeek", command: "firstWeek", primary: true }] };
  const s = await improveContent(h.scope, item.id);
  return {
    status: "needs_confirmation",
    message: msg("improvedReady", { title: item.title }),
    text: [s.hook, s.caption, s.cta].filter(Boolean).join("\n\n"),
    confirmLabel: "applyVersion",
    actions: [{ label: "openPost", href: `/content/${item.id}` }],
    plan: { step: "confirm", params: h.params, data: { contentItemId: item.id, title: item.title, fields: { hook: s.hook ?? null, caption: s.caption, cta: s.cta ?? null, hashtags: s.hashtags ?? [] }, reasons: s.reasons ?? [], promptVersion: s.promptVersion ?? null } },
  };
}

async function designLatest(h: HandlerInput): Promise<Outcome> {
  const { imagesConfigured, requestImage } = await import("../studio/images");
  if (!imagesConfigured()) return aiUnavailable("image_not_configured");
  const item = await latestEditable(h);
  if (!item) return { status: "needs_input", message: msg("noContentYet"), actions: [{ label: "prepareWeek", command: "firstWeek", primary: true }] };
  const asset = await requestImage(h.scope, h.ctx.user.id, item.id, { mode: "brand_template" });
  return { status: "queued", message: msg("designStarted", { title: item.title }), actions: [{ label: "openPost", href: `/content/${item.id}`, primary: true }], receipt: receipt("content.design_requested", "ContentAsset", asset.id, "queued") };
}

async function carousel(h: HandlerInput): Promise<Outcome> {
  if (!contentAiConfigured()) return aiUnavailable("content_ai_not_configured");
  const topic = h.params.topic ?? h.params.name;
  if (!topic) return { status: "needs_input", message: msg("needTopic") };
  const item = await h.ctx.db.contentItem.create({
    data: { organizationId: h.scope.organizationId, workspaceId: h.scope.workspaceId, platform: h.params.platform ?? "INSTAGRAM", format: "CAROUSEL", status: "DRAFT", title: topic.slice(0, 120), caption: "", authorUserId: h.ctx.user.id },
  });
  const run = await startRun(h.scope, { kind: "command_carousel", agent: "DESIGNER", steps: ["writing_content", "design_briefs"], input: topic, params: { contentItemId: item.id, topic, slides: Math.min(10, Math.max(3, h.params.count ?? 6)) }, requestedById: h.ctx.user.id });
  return { status: "queued", message: msg("started"), runId: run.id, actions: [{ label: "openPost", href: `/content/${item.id}` }], receipt: receipt("content.carousel", "ContentItem", item.id, "queued") };
}

async function salesCycle(h: HandlerInput): Promise<Outcome> {
  const r = await runSalesCycle(h.scope, actor(h.ctx));
  return {
    status: "completed",
    message: msg("cycleDone", { analyzed: r.analyzed, created: r.followUpsCreated }),
    stats: [{ key: "hot", value: r.hot }, { key: "stalled", value: r.stalled }, { key: "overdue", value: r.overdue }, { key: "followupsCreated", value: r.followUpsCreated }],
    items: r.recommendations.slice(0, 5).map((x) => ({ title: x.name, subtitle: x.company, href: `/leads/${x.leadId}`, badge: x.signal.kind })),
    actions: [{ label: "openFollowups", href: "/sales?view=followups&tab=overdue", primary: true }],
    receipt: receipt("sales.cycle", "Workspace", h.scope.workspaceId, `${r.followUpsCreated} follow-ups`),
  };
}

// ── High-risk ──

async function approveAll(h: HandlerInput): Promise<Outcome> {
  const pending = await h.ctx.db.approval.findMany({ where: { status: "PENDING" }, select: { id: true, category: true }, take: 200 });
  const allowed = pending.filter((a) => h.ctx.can(APPROVAL_PERMISSION[a.category] ?? "approvals:policy"));
  if (!pending.length) return { status: "completed", message: msg("noApprovals") };
  if (!allowed.length) return { status: "denied", message: msg("cannotApprove"), reason: "forbidden" };
  if (!h.confirmed) {
    const byCat = new Map<string, number>();
    for (const a of allowed) byCat.set(a.category, (byCat.get(a.category) ?? 0) + 1);
    return {
      status: "needs_confirmation",
      message: msg("confirmApproveAll", { count: allowed.length }),
      preview: [...[...byCat].map(([cat, count]) => msg("previewApproveCategory", { category: cat, count })), ...(pending.length > allowed.length ? [msg("previewApproveSkipped", { count: pending.length - allowed.length })] : [])],
      confirmLabel: "approveAll",
      actions: [{ label: "openApprovals", href: "/approvals" }],
      approvalRequired: true,
      plan: { step: "confirm", params: h.params, data: { ids: allowed.map((a) => a.id) } },
    };
  }
  let ok = 0;
  let failed = 0;
  const ids = (h.plan?.data?.ids as string[] | undefined) ?? [];
  for (const id of ids) {
    // Re-check at execution time: still pending, still this tenant, still permitted.
    const a = await h.ctx.db.approval.findUnique({ where: { id }, select: { category: true, status: true } });
    if (!a || a.status !== "PENDING" || !h.ctx.can(APPROVAL_PERMISSION[a.category] ?? "approvals:policy")) continue;
    try {
      await decideApproval(h.scope, id, "APPROVED", { userId: h.ctx.user.id, label: h.ctx.user.name ?? h.ctx.user.email });
      ok++;
    } catch {
      failed++;
    }
  }
  return {
    status: failed ? "partial" : "completed",
    message: failed ? msg("approvedPartial", { ok, total: ok + failed }) : msg("approvedAll", { count: ok }),
    actions: [{ label: "openApprovals", href: "/approvals", primary: true }],
    receipt: receipt("approvals.bulk_approved", "Approval", "batch", `${ok} approved`),
    approvalRequired: true,
  };
}

async function publishContent(h: HandlerInput): Promise<Outcome> {
  const pending = await h.ctx.db.contentItem.count({ where: { status: "PENDING_APPROVAL" } });
  return {
    status: "needs_approval",
    message: msg(pending ? "publishViaApprovals" : "publishNothingPending", { count: pending }),
    actions: [{ label: "openContentApproval", href: "/content?view=approval", primary: true }, { label: "openCalendar", href: "/calendar" }],
    approvalRequired: true,
    action: "publish_content",
  };
}

async function discount(): Promise<Outcome> {
  return { status: "needs_approval", message: msg("discountViaQuote"), actions: [{ label: "openQuotes", href: "/sales?view=quotes", primary: true }], approvalRequired: true, action: "discount" };
}

async function sendQuoteCmd(h: HandlerInput): Promise<Outcome> {
  return withLead(h, async (lead) => {
    const q = await h.ctx.db.quote.findFirst({ where: { leadId: lead.id, status: { in: ["DRAFT", "NEEDS_APPROVAL"] } }, orderBy: { createdAt: "desc" } });
    if (!q) return { status: "needs_input", message: msg("noQuote", { name: lead.name }), actions: [{ label: "openLead", href: `/leads/${lead.id}`, primary: true }] };
    if (q.status === "NEEDS_APPROVAL" || (quoteNeedsApproval(q) && !q.approvedAt)) {
      return { status: "needs_approval", message: msg("quoteAwaitingApproval", { number: q.number }), actions: [{ label: "openApprovals", href: "/approvals?tab=PRICING", primary: true }], approvalRequired: true, action: "send_quote" };
    }
    if (!lead.email) return { status: "needs_input", message: msg("noEmail", { name: lead.name }), actions: [{ label: "openLead", href: `/leads/${lead.id}`, primary: true }] };
    if (!h.confirmed) {
      return {
        status: "needs_confirmation",
        message: msg("confirmSendQuote", { number: q.number, name: lead.name, total: money(q.totalCents, q.currency, h.locale) }),
        preview: [msg("previewSendEmail", { email: lead.email })],
        confirmLabel: "send",
        plan: { step: "confirm", params: { ...h.params, leadId: lead.id }, data: { quoteId: q.id } },
      };
    }
    const quoteId = String(h.plan?.data?.quoteId ?? q.id);
    await sendQuote(h.scope, quoteId, actor(h.ctx));
    return { status: "completed", message: msg("quoteSent", { number: q.number, name: lead.name }), actions: [{ label: "openLead", href: `/leads/${lead.id}`, primary: true }], receipt: receipt("quote.sent", "Quote", quoteId, "SENT"), action: "send_quote" };
  });
}

async function sendMessageCmd(h: HandlerInput): Promise<Outcome> {
  return withLead(h, async (lead) => {
    const body = h.params.body;
    if (!body) return { status: "needs_input", message: msg("needMessageBody", { name: lead.name }) };
    // A message typed into a command is never sent directly: it becomes a draft that a human approves.
    const full = await h.ctx.db.lead.findUniqueOrThrow({ where: { id: lead.id }, select: { channel: true, email: true } });
    const conv =
      (await h.ctx.db.conversation.findFirst({ where: { leadId: lead.id }, orderBy: { lastMessageAt: "desc" } })) ??
      (await h.ctx.db.conversation.create({ data: { organizationId: h.scope.organizationId, workspaceId: h.scope.workspaceId, leadId: lead.id, channel: full.email ? "EMAIL" : full.channel } }));
    const m = await h.ctx.db.message.create({ data: { organizationId: h.scope.organizationId, workspaceId: h.scope.workspaceId, conversationId: conv.id, direction: "OUTBOUND", authorType: "USER", authorId: h.ctx.user.id, body, status: "PENDING_APPROVAL" } });
    await h.ctx.db.approval.create({
      data: {
        organizationId: h.scope.organizationId,
        workspaceId: h.scope.workspaceId,
        category: /خصم|discount|سعر|price/i.test(body) ? "PRICING" : "SALES",
        action: "send_message",
        title: h.locale === "ar" ? `رسالة إلى ${lead.name}` : `Message to ${lead.name}`,
        summary: body.slice(0, 500),
        reason: "Command Center",
        entityType: "Message",
        entityId: m.id,
        requestedById: h.ctx.user.id,
        payload: { leadId: lead.id },
      },
    });
    return { status: "needs_approval", message: msg("messageForApproval", { name: lead.name }), actions: [{ label: "openApprovals", href: "/approvals?tab=SALES", primary: true }], receipt: receipt("message.drafted", "Message", m.id, "PENDING_APPROVAL"), approvalRequired: true, action: "send_message" };
  });
}

async function closeDeal(h: HandlerInput): Promise<Outcome> {
  return withLead(h, async (lead) => {
    const stage = h.params.stage ?? "WON";
    if (lead.stage === stage) return { status: "completed", message: msg("alreadyStage", { name: lead.name, stage }) };
    if (!h.confirmed) {
      return { status: "needs_confirmation", message: msg(stage === "WON" ? "confirmWon" : "confirmLost", { name: lead.name }), confirmLabel: stage === "WON" ? "markWon" : "markLost", plan: { step: "confirm", params: { ...h.params, leadId: lead.id } }, approvalRequired: true };
    }
    await moveLeadStage(h.scope, lead.id, stage, actor(h.ctx), "Command Center");
    return { status: "completed", message: msg(stage === "WON" ? "markedWon" : "markedLost", { name: lead.name }), actions: [{ label: "openLead", href: `/leads/${lead.id}`, primary: true }], receipt: receipt("lead.stage_changed", "Lead", lead.id, stage), action: "close_deal" };
  });
}

async function askQuestion(h: HandlerInput): Promise<Outcome> {
  if (!contentAiConfigured()) return aiUnavailable();
  const run = await startRun(h.scope, { kind: "command", agent: "SOCIAL_MANAGER", input: h.params.input ?? "", steps: ["searching_knowledge", "writing_answer"], requestedById: h.ctx.user.id, params: { intent: "ask_question" } });
  return { status: "queued", message: msg("started"), runId: run.id };
}

async function openEntity(h: HandlerInput): Promise<Outcome> {
  return withLead(h, async (lead) => ({ status: "completed", message: msg("openingLead", { name: lead.name }), navigation: `/leads/${lead.id}` }));
}

function navigate(h: HandlerInput): Outcome {
  return { status: "completed", message: msg("opening", { page: h.def.key }), navigation: h.def.route ?? "/home" };
}

export type Handler = (h: HandlerInput) => Promise<Outcome> | Outcome;

/** Core handlers; Company Brain / no-AI lookups live in brain-handlers.ts (combined in service.ts). */
export const HANDLERS: Record<Exclude<IntentKey, import("./brain-handlers").BrainHandlerKey | import("./whatsapp-handlers").WhatsAppHandlerKey>, Handler> = {
  greeting: () => ({ status: "completed", message: msg("greeting"), actions: [{ label: "followupsToday", command: "followupsToday" }, { label: "ourServices", command: "ourServices" }, { label: "salesSummary", command: "salesSummary" }] }),
  delete_anything: () => ({ status: "denied", message: msg("deleteNotAllowed"), reason: "forbidden" }),
  approve_all: approveAll,
  approve_item: () => ({ status: "needs_approval", message: msg("approveInCenter"), navigation: "/approvals", approvalRequired: true }),
  publish_content: publishContent,
  send_discount: discount,
  send_quote: sendQuoteCmd,
  send_message: sendMessageCmd,
  close_deal: closeDeal,
  import_leads: importCustomers,
  create_campaign: createCampaign,
  prepare_followups: prepareFollowups,
  create_followup: createFollowup,
  create_b2b_opportunity: createB2B,
  create_quote: createQuoteCmd,
  create_lead: createCustomer,
  create_carousel: carousel,
  design_post: designLatest,
  improve_content: improveLatest,
  prepare_week_content: prepareContent,
  run_sales_cycle: salesCycle,
  stalled_deals: stalledDeals,
  overdue_followups: (h) => followUps(h, true),
  followups_today: (h) => followUps(h, false),
  hot_leads: hotLeads,
  approvals_summary: approvalsSummary,
  sales_brief: salesBrief,
  best_content: bestContent,
  lead_sources: leadSources,
  campaign_summary: campaignSummary,
  analytics_summary: analyticsSummary,
  sales_summary: salesSummary,
  open_entity: openEntity,
  ask_question: askQuestion,
  open_hot_leads: navigate,
  open_overdue_followups: navigate,
  open_followups: navigate,
  open_content_pending: navigate,
  open_approvals: navigate,
  open_calendar: navigate,
  open_messages: navigate,
  open_pipeline: navigate,
  open_quotes: navigate,
  open_b2b: navigate,
  open_sales: navigate,
  open_customers: navigate,
  open_content: navigate,
  open_campaigns: navigate,
  open_analytics: navigate,
  open_reports: navigate,
  open_integrations: navigate,
  open_settings: navigate,
  open_knowledge: navigate,
  open_team: navigate,
  open_home: navigate,
};

