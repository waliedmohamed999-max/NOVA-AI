import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Channel, LeadStage, QuoteStatus } from "@/generated/prisma/enums";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { audit } from "../audit";
import { notify } from "../notifications/service";
import { aiStructured, contentAiConfigured, toUserFacing } from "../ai";
import { addLeadEvent, createLead, moveLeadStage, scheduleFollowUp, type Actor } from "./service";
import { channelFor } from "./channels";
import { isOpen, leadSignals, OPEN_STAGES, type Signal } from "./intelligence";

/**
 * Sales Desk write operations on the existing model: leads, sales_opportunities, sales_activities,
 * lead_events, approvals — plus the Quote entity. Every change leaves a lead_events row (immutable timeline).
 */

// ── Opportunities (deals and B2B) ──

export const opportunityInput = z.object({
  leadId: z.string().optional(),
  // B2B: company + contact person create the customer when there's no leadId.
  company: z.string().trim().max(160).optional(),
  contactName: z.string().trim().max(160).optional(),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["DEAL", "B2B"]).default("DEAL"),
  industry: z.string().trim().max(120).optional(),
  need: z.string().trim().max(2000).optional(),
  decisionMaker: z.string().trim().max(160).optional(),
  value: z.number().nonnegative().max(1e10).nullable().optional(),
  currency: z.string().trim().length(3).optional(),
  stage: z.enum(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION"]).optional(),
  nextStep: z.string().trim().max(300).optional(),
  nextStepAt: z.string().datetime().optional(),
  expectedCloseAt: z.string().datetime().optional(),
  ownerId: z.string().optional(),
  source: z.string().trim().max(80).optional(),
  summary: z.string().trim().max(2000).optional(),
  qualificationQuestions: z.array(z.string().trim().max(300)).max(8).optional(),
});
export type OpportunityInput = z.infer<typeof opportunityInput>;

async function assertMember(organizationId: string, userId: string | undefined) {
  if (!userId) return null;
  const m = await db.organizationMember.findFirst({ where: { organizationId, userId }, select: { userId: true } });
  if (!m) throw new UserFacingError("validation");
  return userId;
}

export async function createOpportunity(scope: TenantScope, input: OpportunityInput, actor: Actor) {
  const i = opportunityInput.parse(input);
  const t = tenantDb(scope);
  const ownerId = await assertMember(scope.organizationId, i.ownerId);
  let leadId = i.leadId;
  if (leadId) {
    if (!(await t.lead.findUnique({ where: { id: leadId }, select: { id: true } }))) throw new NotFoundError("lead");
  } else {
    if (!i.contactName && !i.company) throw new UserFacingError("validation");
    const lead = await createLead(
      scope,
      { name: i.contactName || i.company!, company: i.company || null, email: i.email || null, phone: i.phone || null, source: i.source || (i.kind === "B2B" ? "B2B" : "Manual"), channel: "MANUAL", ownerId },
      actor,
      { qualify: false },
    );
    leadId = lead.id;
  }
  const valueCents = i.value != null ? Math.round(i.value * 100) : null;
  const lead = await t.lead.findUniqueOrThrow({ where: { id: leadId } });
  const opp = await t.salesOpportunity.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      leadId,
      title: i.title,
      kind: i.kind,
      valueCents,
      currency: i.currency?.toUpperCase() ?? lead.currency,
      industry: i.industry || null,
      need: i.need || null,
      decisionMaker: i.decisionMaker || null,
      nextStep: i.nextStep || null,
      nextStepAt: i.nextStepAt ? new Date(i.nextStepAt) : null,
      expectedCloseAt: i.expectedCloseAt ? new Date(i.expectedCloseAt) : null,
      ownerId,
      source: i.source || null,
      summary: i.summary || null,
      qualificationQuestions: i.qualificationQuestions ?? [],
    },
  });
  await addLeadEvent(scope, leadId, { type: "OPPORTUNITY", title: `Opportunity created: ${i.title}`, data: { opportunityId: opp.id, kind: i.kind, valueFrom: null, valueTo: valueCents, currency: opp.currency }, actor });
  if (i.nextStep) await t.lead.update({ where: { id: leadId }, data: { nextAction: i.nextStep.slice(0, 200), nextActionAt: i.nextStepAt ? new Date(i.nextStepAt) : lead.nextActionAt, ...(ownerId && !lead.ownerId ? { ownerId } : {}) } });
  if (i.stage && i.stage !== lead.stage) await moveLeadStage(scope, leadId, i.stage as LeadStage, actor);
  await audit({ ...scope, actorType: actor.type, actorId: actor.id, actorLabel: actor.label, action: "opportunity.created", entityType: "SalesOpportunity", entityId: opp.id, summary: `${i.kind === "B2B" ? "B2B opportunity" : "Opportunity"}: ${i.title}` });
  return opp;
}

export async function updateOpportunityValue(scope: TenantScope, id: string, value: number | null, actor: Actor) {
  const t = tenantDb(scope);
  const opp = await t.salesOpportunity.findUnique({ where: { id } });
  if (!opp) throw new NotFoundError("item");
  const valueCents = value != null ? Math.round(value * 100) : null;
  const updated = await t.salesOpportunity.update({ where: { id }, data: { valueCents } });
  await addLeadEvent(scope, opp.leadId, { type: "OPPORTUNITY", title: `Value updated: ${opp.title}`, data: { opportunityId: id, valueFrom: opp.valueCents, valueTo: valueCents, currency: opp.currency }, actor });
  return updated;
}

/**
 * "Let NOVA help me": drafts a summary, next action and qualification questions from what the user
 * typed — nothing else. Requires a real AI provider.
 */
export const opportunityAssistSchema = z.object({ summary: z.string(), nextAction: z.string(), qualificationQuestions: z.array(z.string()).min(2).max(6), missingInformation: z.array(z.string()).max(6) });

export async function assistOpportunity(scope: TenantScope, input: { company?: string; contactName?: string; industry?: string; need?: string; value?: number | null; currency?: string; stage?: string }, locale: "ar" | "en") {
  if (!contentAiConfigured()) throw new UserFacingError("ai_not_configured");
  const res = await aiStructured(
    { organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "SALES_AGENT" },
    {
      task: "SALES",
      realOnly: true,
      schemaName: "opportunity_assist",
      schema: opportunityAssistSchema,
      system: [
        "You help a salesperson structure a B2B opportunity.",
        "Use ONLY the facts given. Never invent budgets, dates, people, company facts or numbers.",
        "If something important is unknown, list it in missingInformation instead of guessing.",
        locale === "ar" ? "Write in natural Arabic." : "Write in English.",
      ].join(" "),
      prompt: [
        `Company: ${input.company || "unknown"}`,
        `Contact: ${input.contactName || "unknown"}`,
        `Industry: ${input.industry || "unknown"}`,
        `Need: ${input.need || "unknown"}`,
        `Estimated value: ${input.value != null ? `${input.value} ${input.currency ?? ""}` : "unknown"}`,
        `Stage: ${input.stage || "NEW"}`,
        "summary: 1–2 sentences. nextAction: one concrete next step. qualificationQuestions: 3–5 questions to ask the customer.",
      ].join("\n"),
    },
  ).catch((e) => {
    throw toUserFacing(e);
  });
  return res.data;
}

// ── Follow-ups ──

export async function snoozeFollowUp(scope: TenantScope, id: string, until: Date, actor: Actor) {
  const t = tenantDb(scope);
  const a = await t.salesActivity.findUnique({ where: { id } });
  if (!a || a.completedAt) throw new NotFoundError("item");
  await t.salesActivity.update({ where: { id }, data: { dueAt: until, remindedAt: null, pausedAt: null } });
  await addLeadEvent(scope, a.leadId, { type: "FOLLOW_UP", title: `Follow-up postponed: ${a.title}`, data: { from: a.dueAt?.toISOString() ?? null, to: until.toISOString() }, actor });
}

export async function setFollowUpPaused(scope: TenantScope, id: string, paused: boolean, actor: Actor) {
  const t = tenantDb(scope);
  const a = await t.salesActivity.findUnique({ where: { id } });
  if (!a || a.completedAt) throw new NotFoundError("item");
  await t.salesActivity.update({ where: { id }, data: { pausedAt: paused ? new Date() : null } });
  await addLeadEvent(scope, a.leadId, { type: "FOLLOW_UP", title: `${paused ? "Follow-up paused" : "Follow-up resumed"}: ${a.title}`, actor });
}

export async function completeFollowUp(scope: TenantScope, id: string, actor: Actor) {
  const t = tenantDb(scope);
  const a = await t.salesActivity.findUnique({ where: { id } });
  if (!a) throw new NotFoundError("item");
  if (a.completedAt) return a;
  const done = await t.salesActivity.update({ where: { id }, data: { completedAt: new Date() } });
  await addLeadEvent(scope, a.leadId, { type: "FOLLOW_UP", title: `Follow-up done: ${a.title}`, actor });
  return done;
}

// ── Quotes (foundation; not invoicing) ──

export const quoteItem = z.object({ description: z.string().trim().min(1).max(300), quantity: z.number().positive().max(1e6), unitPrice: z.number().nonnegative().max(1e9) });
export const quoteInput = z.object({
  leadId: z.string(),
  opportunityId: z.string().optional(),
  title: z.string().trim().min(1).max(200),
  items: z.array(quoteItem).min(1).max(50),
  discount: z.number().nonnegative().max(1e9).default(0),
  taxPercent: z.number().min(0).max(100).default(0),
  currency: z.string().trim().length(3).optional(),
  terms: z.string().trim().max(4000).optional(),
  validDays: z.number().int().min(1).max(365).default(14),
});

export function quoteTotals(items: z.infer<typeof quoteItem>[], discount: number, taxPercent: number) {
  const subtotal = Math.round(items.reduce((a, i) => a + i.quantity * i.unitPrice * 100, 0));
  const discountCents = Math.min(subtotal, Math.round(discount * 100));
  const taxCents = Math.round(((subtotal - discountCents) * taxPercent) / 100);
  return { subtotalCents: subtotal, discountCents, taxCents, totalCents: subtotal - discountCents + taxCents };
}

/**
 * A quote needs human approval when the AI drafted it, when it has a discount, or when it has special
 * terms. Pricing/discount/proposal rules are locked in the approval policies (can't be switched off).
 */
export function quoteNeedsApproval(q: { createdByAgent: boolean; discountCents: number; terms: string | null }) {
  return q.createdByAgent || q.discountCents > 0 || Boolean(q.terms?.trim());
}

export async function createQuote(scope: TenantScope, input: z.input<typeof quoteInput>, actor: Actor) {
  const i = quoteInput.parse(input);
  const t = tenantDb(scope);
  const lead = await t.lead.findUnique({ where: { id: i.leadId } });
  if (!lead) throw new NotFoundError("lead");
  if (i.opportunityId && !(await t.salesOpportunity.findFirst({ where: { id: i.opportunityId, leadId: lead.id } }))) throw new NotFoundError("item");
  const totals = quoteTotals(i.items, i.discount, i.taxPercent);
  const count = await t.quote.count();
  const number = `Q-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
  const byAgent = actor.type === "AGENT";
  const needs = quoteNeedsApproval({ createdByAgent: byAgent, discountCents: totals.discountCents, terms: i.terms ?? null });
  const quote = await t.quote.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      leadId: lead.id,
      opportunityId: i.opportunityId ?? null,
      number,
      title: i.title,
      items: i.items.map((x) => ({ description: x.description, quantity: x.quantity, unitCents: Math.round(x.unitPrice * 100) })) as Prisma.InputJsonValue,
      ...totals,
      currency: i.currency?.toUpperCase() ?? lead.currency,
      terms: i.terms || null,
      status: needs ? "NEEDS_APPROVAL" : "DRAFT",
      validUntil: new Date(Date.now() + i.validDays * 86_400_000),
      createdById: actor.type === "USER" ? (actor.id ?? null) : null,
      createdByAgent: byAgent,
    },
  });
  if (needs) {
    await t.approval.create({
      data: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        category: "PRICING",
        action: totals.discountCents > 0 ? "discount" : "custom_pricing",
        title: `${number} — ${lead.name}`,
        summary: `${i.title}: ${(totals.totalCents / 100).toFixed(2)} ${quote.currency}${totals.discountCents ? ` (discount ${(totals.discountCents / 100).toFixed(2)})` : ""}`,
        reason: byAgent ? "Drafted by the Sales Agent" : totals.discountCents > 0 ? "Includes a discount" : "Includes special terms",
        impact: i.terms ? `Terms: ${i.terms.slice(0, 200)}` : null,
        entityType: "Quote",
        entityId: quote.id,
        requestedByAgent: byAgent ? "SALES_AGENT" : null,
        requestedById: actor.type === "USER" ? (actor.id ?? null) : null,
        payload: { leadId: lead.id, totalCents: totals.totalCents, discountCents: totals.discountCents },
      },
    });
  }
  await addLeadEvent(scope, lead.id, { type: "QUOTE", title: `Quote ${number} created${needs ? " — waiting for approval" : ""}`, data: { quoteId: quote.id, totalCents: totals.totalCents, currency: quote.currency }, actor });
  return quote;
}

/** Called by the Approval Center. */
export async function decideQuote(scope: TenantScope, quoteId: string, decision: "APPROVED" | "REJECTED", actor: { userId: string; label: string }) {
  const t = tenantDb(scope);
  const q = await t.quote.findUnique({ where: { id: quoteId } });
  if (!q || q.status !== "NEEDS_APPROVAL") return;
  await t.quote.update({ where: { id: quoteId }, data: decision === "APPROVED" ? { status: "DRAFT", approvedById: actor.userId, approvedAt: new Date() } : { status: "DRAFT", approvedById: null, approvedAt: null } });
  await addLeadEvent(scope, q.leadId, { type: "QUOTE", title: `Quote ${q.number} ${decision === "APPROVED" ? "approved" : "not approved"}`, actor: { type: "USER", id: actor.userId, label: actor.label } });
}

/**
 * Sends a quote. Blocked until approved when it needs approval. Goes out by email when the lead has an
 * address and email is configured; otherwise "sent outside NOVA" is recorded only when the user says so.
 */
export async function sendQuote(scope: TenantScope, quoteId: string, actor: Actor, opts: { manual?: boolean } = {}) {
  const t = tenantDb(scope);
  const q = await t.quote.findUnique({ where: { id: quoteId } });
  if (!q) throw new NotFoundError("item");
  if (q.status === "NEEDS_APPROVAL" || (quoteNeedsApproval(q) && !q.approvedAt)) throw new UserFacingError("requires_approval");
  if (q.status !== "DRAFT") throw new UserFacingError("invalid_transition");
  const lead = await t.lead.findUniqueOrThrow({ where: { id: q.leadId } });
  let via = "manual";
  if (!opts.manual) {
    const email = channelFor("EMAIL")!;
    if (!lead.email || !(await email.isConfigured(scope))) throw new UserFacingError("integration_not_configured");
    const org = await db.organization.findUniqueOrThrow({ where: { id: scope.organizationId }, select: { name: true, locale: true } });
    const items = (q.items as { description: string; quantity: number; unitCents: number }[]).map((x) => `• ${x.description} × ${x.quantity} — ${(x.unitCents / 100).toFixed(2)} ${q.currency}`).join("\n");
    const body = [q.title, "", items, "", `Subtotal: ${(q.subtotalCents / 100).toFixed(2)} ${q.currency}`, q.discountCents ? `Discount: -${(q.discountCents / 100).toFixed(2)} ${q.currency}` : null, q.taxCents ? `Tax: ${(q.taxCents / 100).toFixed(2)} ${q.currency}` : null, `Total: ${(q.totalCents / 100).toFixed(2)} ${q.currency}`, q.validUntil ? `Valid until: ${q.validUntil.toISOString().slice(0, 10)}` : null, q.terms ? `\n${q.terms}` : null].filter((x) => x !== null).join("\n");
    const r = await email.send(scope, { email: lead.email }, { subject: `${org.name} — ${q.number}`, body, locale: org.locale });
    via = r.via;
  }
  await t.quote.update({ where: { id: quoteId }, data: { status: "SENT", sentAt: new Date(), sentVia: via } });
  await t.lead.update({ where: { id: lead.id }, data: { lastContactAt: new Date() } });
  await addLeadEvent(scope, lead.id, { type: "QUOTE", title: `Quote ${q.number} sent${via === "manual" ? " (outside NOVA)" : ` via ${via}`}`, data: { quoteId, totalCents: q.totalCents, currency: q.currency }, actor });
  if (["NEW", "CONTACTED", "QUALIFIED"].includes(lead.stage)) await moveLeadStage(scope, lead.id, "PROPOSAL", actor, `Quote ${q.number} sent`);
}

/** Customer outcome recorded by a salesperson (no tracking pixel — "viewed" only when reported). */
export async function setQuoteOutcome(scope: TenantScope, quoteId: string, status: Extract<QuoteStatus, "VIEWED" | "ACCEPTED" | "REJECTED" | "EXPIRED">, actor: Actor) {
  const t = tenantDb(scope);
  const q = await t.quote.findUnique({ where: { id: quoteId } });
  if (!q || !["SENT", "VIEWED"].includes(q.status)) throw new UserFacingError("invalid_transition");
  await t.quote.update({ where: { id: quoteId }, data: { status } });
  await addLeadEvent(scope, q.leadId, { type: "QUOTE", title: `Quote ${q.number}: ${status.toLowerCase()}`, data: { quoteId }, actor });
}

// ── NOVA sales cycle (deterministic; drafts nothing it can't justify, sends nothing) ──

export type CycleResult = {
  analyzed: number;
  followUpsCreated: number;
  hot: number;
  stalled: number;
  overdue: number;
  recommendations: { leadId: string; name: string; company: string | null; signal: Signal }[];
};

/**
 * Analyses open leads, finds due/overdue follow-ups, stalled deals and hot leads without a next step,
 * creates follow-up tasks where one is missing and notifies — never sends a message.
 */
export async function runSalesCycle(scope: TenantScope, actor: Actor, now = new Date()): Promise<CycleResult> {
  const t = tenantDb(scope);
  const leads = await t.lead.findMany({
    where: { stage: { in: [...OPEN_STAGES] } },
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: { id: true, name: true, company: true, stage: true, temperature: true, createdAt: true, stageChangedAt: true, lastContactAt: true, nextActionAt: true },
  });
  const ids = leads.map((l) => l.id);
  const [acts, convs, quotes] = await Promise.all([
    t.salesActivity.findMany({ where: { leadId: { in: ids }, completedAt: null, pausedAt: null }, select: { leadId: true, dueAt: true } }),
    t.conversation.findMany({ where: { leadId: { in: ids } }, select: { leadId: true, messages: { where: { status: { in: ["RECEIVED", "SENT"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { direction: true, createdAt: true } } } }),
    t.quote.findMany({ where: { leadId: { in: ids }, status: { in: ["SENT", "VIEWED"] } }, select: { leadId: true, sentAt: true } }),
  ]);
  const result: CycleResult = { analyzed: leads.length, followUpsCreated: 0, hot: 0, stalled: 0, overdue: 0, recommendations: [] };
  for (const l of leads) {
    const open = acts.filter((a) => a.leadId === l.id);
    const last = convs.filter((c) => c.leadId === l.id).flatMap((c) => c.messages).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const sent = quotes.filter((q) => q.leadId === l.id && q.sentAt).map((q) => q.sentAt!.getTime());
    const signals = leadSignals({ ...l, openFollowUps: open, lastMessage: last ? { direction: last.direction, at: last.createdAt } : null, quoteSentAt: sent.length ? new Date(Math.max(...sent)) : null }, now);
    if (!signals.length) continue;
    if (signals.some((s) => s.kind === "followup_overdue")) result.overdue++;
    if (signals.some((s) => s.kind === "stalled")) result.stalled++;
    if (l.temperature === "HOT") result.hot++;
    const top = signals[0];
    result.recommendations.push({ leadId: l.id, name: l.name, company: l.company, signal: top });
    // A lead with a high-severity signal and no open follow-up gets one (a task — not a message).
    if (!open.length && top.severity === "high") {
      await scheduleFollowUp(scope, l.id, { title: followUpTitle(top), body: `NOVA: ${top.kind} (${top.days}d)`, dueAt: now, agent: true });
      result.followUpsCreated++;
    }
  }
  result.recommendations.sort((a, b) => (a.signal.severity === b.signal.severity ? b.signal.days - a.signal.days : a.signal.severity === "high" ? -1 : 1));
  result.recommendations = result.recommendations.slice(0, 20);
  // One cycle notification per day at most — don't notify on every run.
  const since = new Date(now);
  since.setHours(0, 0, 0, 0);
  const already = await db.notification.count({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, type: "AI_RECOMMENDATION", link: "/sales?view=followups&tab=overdue", createdAt: { gte: since } } });
  if ((result.stalled || result.hot) && !already) {
    await notify({ ...scope, type: "AI_RECOMMENDATION", title: `Sales cycle: ${result.recommendations.length} customers need attention`, body: `${result.hot} hot · ${result.stalled} stalled · ${result.overdue} overdue`, link: "/sales?view=followups&tab=overdue", roles: ["OWNER", "ADMIN", "MANAGER"] });
  }
  await audit({ ...scope, actorType: actor.type, actorId: actor.id, actorLabel: actor.label, action: "sales.cycle_run", summary: `Sales cycle: analysed ${result.analyzed}, ${result.followUpsCreated} follow-ups created` });
  return result;
}

function followUpTitle(s: Signal) {
  return {
    followup_overdue: "Overdue follow-up",
    unanswered_question: "Reply to the customer's question",
    proposal_no_response: "Follow up on the proposal",
    hot_no_next_step: "Contact this hot lead",
    no_contact: "Check in — no contact recently",
    stalled: "Move this deal forward",
  }[s.kind];
}

// ── CSV import: preview (duplicates) → import ──

export const importRow = z.object({
  name: z.string().trim().max(160).optional(),
  company: z.string().trim().max(160).optional(),
  email: z.string().trim().max(254).optional(),
  phone: z.string().trim().max(40).optional(),
  source: z.string().trim().max(80).optional(),
  value: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
  tags: z.string().trim().max(300).optional(),
});
export type ImportRow = z.infer<typeof importRow>;
export const MAX_IMPORT = 1000;

const normEmail = (e?: string) => e?.trim().toLowerCase() || null;
const normPhone = (p?: string) => (p ? p.replace(/[^\d]/g, "") || null : null);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ImportPreviewRow = { index: number; row: ImportRow; status: "ok" | "duplicate" | "invalid"; reason?: string; existingLeadId?: string };

export async function previewImport(scope: TenantScope, rows: ImportRow[]): Promise<ImportPreviewRow[]> {
  if (rows.length > MAX_IMPORT) throw new UserFacingError("validation");
  const parsed = rows.map((r) => importRow.parse(r));
  const emails = [...new Set(parsed.map((r) => normEmail(r.email)).filter(Boolean))] as string[];
  const existing = await tenantDb(scope).lead.findMany({ where: { OR: [{ email: { in: emails } }, { phone: { not: null } }] }, select: { id: true, email: true, phone: true }, take: 20_000 });
  const byEmail = new Map(existing.filter((l) => l.email).map((l) => [l.email!.toLowerCase(), l.id]));
  const byPhone = new Map(existing.filter((l) => l.phone).map((l) => [normPhone(l.phone!)!, l.id]));
  const seen = new Set<string>();
  return parsed.map((row, index) => {
    const email = normEmail(row.email);
    const phone = normPhone(row.phone);
    if (!row.name && !row.company && !email) return { index, row, status: "invalid", reason: "missing_name" };
    if (email && !EMAIL_RE.test(email)) return { index, row, status: "invalid", reason: "bad_email" };
    if (row.value && Number.isNaN(Number(row.value.replace(/[^\d.]/g, "")))) return { index, row, status: "invalid", reason: "bad_value" };
    const existingLeadId = (email && byEmail.get(email)) || (phone && phone.length >= 7 && byPhone.get(phone)) || undefined;
    if (existingLeadId) return { index, row, status: "duplicate", reason: "exists", existingLeadId };
    const key = email ?? (phone && phone.length >= 7 ? `p:${phone}` : null);
    if (key && seen.has(key)) return { index, row, status: "duplicate", reason: "in_file" };
    if (key) seen.add(key);
    return { index, row, status: "ok" };
  });
}

/** Imports only rows the preview accepted (duplicates/invalid rows are skipped, never merged silently). */
export async function importLeads(scope: TenantScope, rows: ImportRow[], actor: Actor, opts: { currency?: string } = {}) {
  const preview = await previewImport(scope, rows);
  let created = 0;
  for (const p of preview) {
    if (p.status !== "ok") continue;
    const r = p.row;
    const value = r.value ? Number(r.value.replace(/[^\d.]/g, "")) : null;
    const lead = await createLead(
      scope,
      {
        name: r.name || r.company || r.email!,
        company: r.company || null,
        email: normEmail(r.email),
        phone: r.phone || null,
        source: r.source || "Import",
        channel: "MANUAL",
        estimatedValueCents: value != null && !Number.isNaN(value) ? Math.round(value * 100) : null,
        tags: r.tags ? r.tags.split(/[,;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 10) : [],
      },
      actor,
      { qualify: false },
    );
    if (opts.currency) await db.lead.update({ where: { id: lead.id }, data: { currency: opts.currency } });
    await addLeadEvent(scope, lead.id, { type: "IMPORTED", title: "Imported from CSV", body: r.notes || null, actor });
    created++;
  }
  await audit({ ...scope, actorType: actor.type, actorId: actor.id, actorLabel: actor.label, action: "leads.imported", summary: `Imported ${created} customers from CSV (${preview.length - created} skipped)` });
  return { created, skipped: preview.length - created, duplicates: preview.filter((p) => p.status === "duplicate").length, invalid: preview.filter((p) => p.status === "invalid").length };
}

export const _test = { isOpen };
export type { Channel };
