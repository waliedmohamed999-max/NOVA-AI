"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { UserFacingError } from "@/server/errors";
import { aiAvailability, contentAiConfigured } from "@/server/ai";
import { startRun } from "@/server/agents/runtime";
import { FOLLOWUP_STEPS } from "@/server/agents/workflows/sales";
import { createLead, moveLeadStage, scheduleFollowUp, LEAD_STAGES } from "@/server/sales/service";
import { leadDrawer } from "@/server/sales/desk";
import {
  assistOpportunity,
  completeFollowUp,
  createOpportunity,
  createQuote,
  importLeads,
  importRow,
  MAX_IMPORT,
  opportunityInput,
  previewImport,
  quoteInput,
  runSalesCycle,
  sendQuote,
  setFollowUpPaused,
  setQuoteOutcome,
  snoozeFollowUp,
  updateOpportunityValue,
} from "@/server/sales/operations";

const scopeOf = (ctx: { organization: { id: string }; workspace: { id: string } }) => ({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
const who = (ctx: { user: { id: string; name: string | null; email: string } }) => ({ type: "USER" as const, id: ctx.user.id, label: ctx.user.name ?? ctx.user.email });
const refresh = (leadId?: string) => {
  revalidatePath("/sales");
  if (leadId) revalidatePath(`/leads/${leadId}`);
};
const CHANNELS = ["WEBSITE", "EMAIL", "INSTAGRAM_DM", "FACEBOOK_DM", "LINKEDIN", "WHATSAPP", "PHONE", "MANUAL"] as const;

/** "+ Add customer": fast form, optional advanced fields; qualification runs async when AI is available. */
export const addCustomer = tenantAction(
  { name: "sales.add_customer", permission: "leads:manage", rateLimit: 60 },
  z.object({
    name: z.string().trim().min(1).max(160),
    company: z.string().trim().max(160).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().email().max(254).optional().or(z.literal("")),
    channel: z.enum(CHANNELS).optional(),
    interest: z.string().trim().max(200).optional(),
    value: z.number().nonnegative().max(1e10).optional(),
    source: z.string().trim().max(80).optional(),
    ownerId: z.string().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    notes: z.string().trim().max(4000).optional(),
  }),
  async (i, ctx) => {
    if (i.ownerId && !(await ctx.db.organizationMember.findFirst({ where: { userId: i.ownerId } }))) throw new UserFacingError("validation");
    const lead = await createLead(
      scopeOf(ctx),
      {
        name: i.name,
        company: i.company || null,
        phone: i.phone || null,
        email: i.email || null,
        channel: i.channel ?? "MANUAL",
        source: i.source || "Manual",
        interests: i.interest ? [i.interest] : [],
        estimatedValueCents: i.value != null ? Math.round(i.value * 100) : null,
        ownerId: i.ownerId ?? ctx.user.id,
        tags: i.tags ?? [],
        message: i.notes || null,
      },
      who(ctx),
      { qualify: aiAvailability().configured },
    );
    refresh();
    return { id: lead.id };
  },
);

export const createOpportunityAction = tenantAction({ name: "sales.opportunity_create", permission: "leads:manage", rateLimit: 60 }, opportunityInput, async (i, ctx) => {
  const opp = await createOpportunity(scopeOf(ctx), i, who(ctx));
  refresh(opp.leadId);
  return { id: opp.id, leadId: opp.leadId };
});

export const opportunityValueAction = tenantAction({ name: "sales.opportunity_value", permission: "leads:manage" }, z.object({ id: z.string(), value: z.number().nonnegative().max(1e10).nullable() }), async ({ id, value }, ctx) => {
  const o = await updateOpportunityValue(scopeOf(ctx), id, value, who(ctx));
  refresh(o.leadId);
  return { ok: true };
});

export const assistOpportunityAction = tenantAction(
  { name: "sales.opportunity_assist", permission: "leads:manage", rateLimit: 15 },
  z.object({ company: z.string().max(160).optional(), contactName: z.string().max(160).optional(), industry: z.string().max(120).optional(), need: z.string().max(2000).optional(), value: z.number().nullable().optional(), currency: z.string().max(3).optional(), stage: z.string().max(20).optional() }),
  async (i, ctx) => assistOpportunity(scopeOf(ctx), i, ctx.organization.locale === "ar" ? "ar" : "en"),
);

export const moveStageAction = tenantAction({ name: "sales.move_stage", permission: "leads:manage", rateLimit: 120 }, z.object({ id: z.string(), stage: z.enum(LEAD_STAGES as [string, ...string[]]), note: z.string().trim().max(500).optional() }), async ({ id, stage, note }, ctx) => {
  await moveLeadStage(scopeOf(ctx), id, stage as (typeof LEAD_STAGES)[number], who(ctx), note);
  refresh(id);
  return { ok: true };
});

export const scheduleFollowUpAction = tenantAction(
  { name: "sales.followup_create", permission: "leads:manage", rateLimit: 60 },
  z.object({ leadId: z.string(), title: z.string().trim().min(1).max(200), dueAt: z.string().datetime(), channel: z.enum(CHANNELS).optional(), type: z.enum(["FOLLOW_UP", "CALL", "EMAIL", "MEETING", "TASK"]).optional() }),
  async (i, ctx) => {
    await scheduleFollowUp(scopeOf(ctx), i.leadId, { title: i.title, dueAt: new Date(i.dueAt), channel: i.channel, type: i.type, createdById: ctx.user.id });
    refresh(i.leadId);
    return { ok: true };
  },
);

export const followUpAction = tenantAction(
  { name: "sales.followup_update", permission: "leads:manage", rateLimit: 120 },
  z.object({ id: z.string(), op: z.enum(["done", "snooze_tomorrow", "snooze_3d", "snooze_week", "pause", "resume"]) }),
  async ({ id, op }, ctx) => {
    const scope = scopeOf(ctx);
    if (op === "done") await completeFollowUp(scope, id, who(ctx));
    else if (op === "pause" || op === "resume") await setFollowUpPaused(scope, id, op === "pause", who(ctx));
    else {
      const d = new Date();
      d.setDate(d.getDate() + (op === "snooze_tomorrow" ? 1 : op === "snooze_3d" ? 3 : 7));
      d.setHours(9, 0, 0, 0);
      await snoozeFollowUp(scope, id, d, who(ctx));
    }
    refresh();
    return { ok: true };
  },
);

/** "Prepare messages" for due follow-ups: drafts only; each goes through the approval policy. */
export const prepareFollowUpsAction = tenantAction({ name: "sales.prepare_followups", permission: "leads:manage", rateLimit: 10 }, z.object({ leadIds: z.array(z.string()).max(10).optional() }), async ({ leadIds }, ctx) => {
  if (!aiAvailability().configured) throw new UserFacingError("ai_not_configured");
  let ids = leadIds;
  if (!ids?.length) {
    const due = await ctx.db.salesActivity.findMany({ where: { completedAt: null, pausedAt: null, dueAt: { lte: new Date(Date.now() + 86_400_000) } }, select: { leadId: true }, orderBy: { dueAt: "asc" }, take: 30 });
    ids = [...new Set(due.map((d) => d.leadId))].slice(0, 10);
  }
  if (!ids.length) throw new UserFacingError("nothing_due");
  const owned = await ctx.db.lead.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const run = await startRun(scopeOf(ctx), { kind: "leads_followup", agent: "SALES_AGENT", steps: FOLLOWUP_STEPS, params: { leadIds: owned.map((l) => l.id) }, requestedById: ctx.user.id });
  return { runId: run.id, count: owned.length };
});

/** "Run NOVA's sales cycle": deterministic analysis + follow-up tasks; never sends messages. */
export const runSalesCycleAction = tenantAction({ name: "sales.cycle", permission: "leads:manage", rateLimit: 10 }, z.object({}), async (_, ctx) => {
  const r = await runSalesCycle(scopeOf(ctx), who(ctx));
  refresh();
  return r;
});

export const leadDrawerAction = tenantAction({ name: "sales.drawer", permission: "leads:read", rateLimit: 240 }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  const d = await leadDrawer(ctx, id);
  if (!d) throw new UserFacingError("lead_not_found");
  return d;
});

export const createQuoteAction = tenantAction({ name: "sales.quote_create", permission: "leads:manage", rateLimit: 30 }, quoteInput, async (i, ctx) => {
  const q = await createQuote(scopeOf(ctx), i, who(ctx));
  refresh(q.leadId);
  revalidatePath("/approvals");
  return { id: q.id, number: q.number, status: q.status };
});

export const sendQuoteAction = tenantAction({ name: "sales.quote_send", permission: "leads:manage", rateLimit: 30 }, z.object({ id: z.string(), manual: z.boolean().optional() }), async ({ id, manual }, ctx) => {
  await sendQuote(scopeOf(ctx), id, who(ctx), { manual });
  refresh();
  return { ok: true };
});

export const quoteOutcomeAction = tenantAction({ name: "sales.quote_outcome", permission: "leads:manage" }, z.object({ id: z.string(), status: z.enum(["VIEWED", "ACCEPTED", "REJECTED", "EXPIRED"]) }), async ({ id, status }, ctx) => {
  await setQuoteOutcome(scopeOf(ctx), id, status, who(ctx));
  refresh();
  return { ok: true };
});

const rows = z.array(importRow).min(1).max(MAX_IMPORT);
export const previewImportAction = tenantAction({ name: "sales.import_preview", permission: "leads:manage", rateLimit: 30 }, z.object({ rows }), async ({ rows: r }, ctx) => previewImport(scopeOf(ctx), r));

export const importLeadsAction = tenantAction({ name: "sales.import", permission: "leads:manage", rateLimit: 5 }, z.object({ rows }), async ({ rows: r }, ctx) => {
  const res = await importLeads(scopeOf(ctx), r, who(ctx));
  refresh();
  return res;
});

/**
 * Sales command bar. Known intents become real actions (filters, the sales cycle, drafting runs);
 * anything else goes to the Sales Assistant when AI is configured.
 */
export const salesCommandAction = tenantAction({ name: "sales.command", permission: "leads:read", rateLimit: 20 }, z.object({ text: z.string().trim().min(2).max(500) }), async ({ text }, ctx) => {
  const t = text.toLowerCase();
  if (/(follow.?up|متابع).*(today|اليوم)|(today|اليوم).*(follow|متابع)|who.*(follow|contact)|مين.*(أكلم|متابعة)/i.test(t)) return { kind: "navigate" as const, href: "/sales?view=followups&tab=today" };
  if (/(stalled|stuck|متوقف|متعثر|واقف)/i.test(t)) return { kind: "navigate" as const, href: "/sales?view=followups&tab=overdue", cycle: true };
  if (/(closest|close to closing|أقرب).*/i.test(t)) return { kind: "navigate" as const, href: "/sales?view=pipeline&stage=NEGOTIATION" };
  if (/(prepare|draft|جهز|جهّز|اكتب).*(hot|ساخن)/i.test(t)) {
    if (!aiAvailability().configured) throw new UserFacingError("ai_not_configured");
    const run = await startRun(scopeOf(ctx), { kind: "leads_followup", agent: "SALES_AGENT", steps: FOLLOWUP_STEPS, requestedById: ctx.user.id });
    return { kind: "run" as const, runId: run.id };
  }
  if (!contentAiConfigured() && !aiAvailability().configured) throw new UserFacingError("ai_not_configured");
  const run = await startRun(scopeOf(ctx), { kind: "command", agent: "SALES_ASSISTANT", input: text, steps: ["understanding_goal"], requestedById: ctx.user.id });
  return { kind: "run" as const, runId: run.id };
});
