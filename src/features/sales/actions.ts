"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { addLeadNote, createLead, moveLeadStage, scheduleFollowUp, sendMessage, LEAD_STAGES } from "@/server/sales/service";
import { startRun } from "@/server/agents/runtime";
import { FOLLOWUP_STEPS } from "@/server/agents/workflows/sales";
import { aiAvailability } from "@/server/ai";
import { UserFacingError } from "@/server/errors";

const scopeOf = (ctx: { organization: { id: string }; workspace: { id: string } }) => ({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
const who = (ctx: { user: { id: string; name: string | null; email: string } }) => ({ type: "USER" as const, id: ctx.user.id, label: ctx.user.name ?? ctx.user.email });

function refresh(leadId?: string) {
  revalidatePath("/leads");
  revalidatePath("/sales");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

export const addLead = tenantAction(
  { name: "leads.create", permission: "leads:manage", rateLimit: 30 },
  z.object({
    name: z.string().trim().min(1).max(160),
    company: z.string().trim().max(160).optional(),
    email: z.string().trim().email().max(254).optional().or(z.literal("")),
    phone: z.string().trim().max(40).optional(),
    source: z.string().trim().max(80).optional(),
    message: z.string().trim().max(4000).optional(),
    estimatedValue: z.number().nonnegative().max(1e9).optional(),
  }),
  async (input, ctx) => {
    const lead = await createLead(
      scopeOf(ctx),
      {
        name: input.name,
        company: input.company || null,
        email: input.email || null,
        phone: input.phone || null,
        source: input.source || "Manual",
        message: input.message || null,
        channel: "MANUAL",
        estimatedValueCents: input.estimatedValue != null ? Math.round(input.estimatedValue * 100) : null,
      },
      who(ctx),
      { qualify: aiAvailability().configured },
    );
    refresh();
    return { id: lead.id };
  },
);

export const moveLead = tenantAction({ name: "leads.move", permission: "leads:manage" }, z.object({ id: z.string(), stage: z.enum(LEAD_STAGES as [string, ...string[]]) }), async ({ id, stage }, ctx) => {
  await moveLeadStage(scopeOf(ctx), id, stage as (typeof LEAD_STAGES)[number], who(ctx));
  refresh(id);
  return { ok: true };
});

export const noteLead = tenantAction({ name: "leads.note", permission: "leads:manage" }, z.object({ id: z.string(), body: z.string().trim().min(1).max(4000) }), async ({ id, body }, ctx) => {
  await addLeadNote(scopeOf(ctx), id, body, who(ctx));
  refresh(id);
  return { ok: true };
});

export const followUpLead = tenantAction({ name: "leads.followup", permission: "leads:manage" }, z.object({ id: z.string(), title: z.string().trim().min(1).max(200), dueAt: z.string().datetime() }), async ({ id, title, dueAt }, ctx) => {
  await scheduleFollowUp(scopeOf(ctx), id, { title, dueAt: new Date(dueAt), createdById: ctx.user.id });
  refresh(id);
  return { ok: true };
});

export const completeActivity = tenantAction({ name: "leads.activity_done", permission: "leads:manage" }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  const a = await ctx.db.salesActivity.update({ where: { id }, data: { completedAt: new Date() } });
  refresh(a.leadId);
  return { ok: true };
});

/** Human sends an AI draft (or their own edit) through the configured channel. */
export const sendLeadMessage = tenantAction({ name: "leads.send", permission: "leads:manage", rateLimit: 30 }, z.object({ messageId: z.string(), body: z.string().trim().min(1).max(8000) }), async ({ messageId, body }, ctx) => {
  const msg = await ctx.db.message.findUnique({ where: { id: messageId }, include: { conversation: true } });
  if (!msg) throw new UserFacingError("item_not_found");
  if (msg.body !== body) await ctx.db.message.update({ where: { id: messageId }, data: { body } });
  await sendMessage(scopeOf(ctx), messageId, who(ctx));
  await ctx.db.approval.updateMany({ where: { entityType: "Message", entityId: messageId, status: "PENDING" }, data: { status: "APPROVED", decidedById: ctx.user.id, decidedAt: new Date() } });
  refresh(msg.conversation.leadId ?? undefined);
  return { ok: true };
});

export const requalifyLead = tenantAction({ name: "leads.qualify", permission: "leads:manage", rateLimit: 10 }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  if (!aiAvailability().configured) throw new UserFacingError("ai_not_configured");
  const run = await startRun(scopeOf(ctx), { kind: "lead_qualify", agent: "SALES_AGENT", steps: ["reading_lead", "reviewing_business", "qualifying", "recommending_action"], params: { leadId: id }, requestedById: ctx.user.id });
  return { runId: run.id };
});

export const runPipelineAction = tenantAction(
  { name: "sales.ai", permission: "leads:read", rateLimit: 10 },
  z.object({ action: z.enum(["summarize", "stalled", "hot", "followups"]) }),
  async ({ action }, ctx) => {
    if (!aiAvailability().configured) throw new UserFacingError("ai_not_configured");
    const scope = scopeOf(ctx);
    if (action === "followups") {
      const run = await startRun(scope, { kind: "leads_followup", agent: "SALES_AGENT", steps: FOLLOWUP_STEPS, requestedById: ctx.user.id });
      return { runId: run.id };
    }
    const text = { summarize: "Summarize our pipeline", stalled: "Find stalled deals in our pipeline", hot: "Show me our hot leads and pipeline" }[action];
    const run = await startRun(scope, { kind: "command", agent: "SALES_ASSISTANT", input: text, steps: ["understanding_goal"], requestedById: ctx.user.id });
    return { runId: run.id };
  },
);

// ── Meetings (connected Google / Outlook calendar only) ──

export const proposeMeetingSlots = tenantAction({ name: "leads.meeting_propose", permission: "leads:manage", rateLimit: 20 }, z.object({ leadId: z.string(), durationMin: z.number().int().min(15).max(120).optional() }), async ({ leadId, durationMin }, ctx) => {
  const { proposeSlots } = await import("@/server/calendar/service");
  const r = await proposeSlots(scopeOf(ctx), leadId, who(ctx), { durationMin });
  refresh(leadId);
  return { meetingId: r.meeting.id, slots: r.slots.map((s) => s.start.toISOString()), timezone: r.timezone };
});

export const bookMeetingSlot = tenantAction({ name: "leads.meeting_book", permission: "leads:manage", rateLimit: 20 }, z.object({ meetingId: z.string(), start: z.string().datetime() }), async ({ meetingId, start }, ctx) => {
  const { bookMeeting } = await import("@/server/calendar/service");
  const m = await bookMeeting(scopeOf(ctx), meetingId, start, who(ctx));
  refresh(m.leadId);
  return { ok: true };
});

export const cancelLeadMeeting = tenantAction({ name: "leads.meeting_cancel", permission: "leads:manage" }, z.object({ meetingId: z.string() }), async ({ meetingId }, ctx) => {
  const { cancelMeeting } = await import("@/server/calendar/service");
  const m = await cancelMeeting(scopeOf(ctx), meetingId, who(ctx));
  refresh(m.leadId);
  return { ok: true };
});
