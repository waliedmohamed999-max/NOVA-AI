import { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { audit } from "../audit";
import { calendarFor } from "../integrations/workspace";
import { addLeadEvent, type Actor } from "../sales/service";
import { findSlots, type Interval } from "./slots";

/**
 * Meetings for the Sales Agent: propose 3 free slots from the connected Google/Outlook calendar, then book
 * only after the customer agrees. With no calendar connected every call fails with
 * `calendar_not_connected` — NOVA never claims a booking it didn't make.
 */
type StoredSlot = { start: string; end: string };

async function workspaceTimezone(scope: TenantScope) {
  const s = await db.workspaceSettings.findFirst({ where: scope, select: { timezone: true } });
  if (s?.timezone && s.timezone !== "UTC") return s.timezone;
  const org = await db.organization.findUnique({ where: { id: scope.organizationId }, select: { timezone: true } });
  return org?.timezone ?? "UTC";
}

async function requireCalendar(scope: TenantScope, access: "read" | "write" = "write") {
  const cal = await calendarFor(scope, access);
  if (!cal) throw new UserFacingError("calendar_not_connected");
  return cal;
}

/** A calendar that can book (read + write). Read-only calendars can propose times but not book. */
export async function calendarConnected(scope: TenantScope) {
  const cal = await calendarFor(scope, "write");
  return cal ? { provider: cal.provider, email: cal.email } : null;
}

export async function proposeSlots(scope: TenantScope, leadId: string, actor: Actor, opts: { durationMin?: number; now?: Date; workDays?: number[] } = {}) {
  const t = tenantDb(scope);
  const lead = await t.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new NotFoundError("lead");
  const cal = await requireCalendar(scope, "read");
  const timezone = await workspaceTimezone(scope);
  const durationMin = opts.durationMin ?? 30;
  const from = opts.now ?? new Date();
  const to = new Date(from.getTime() + 10 * 86_400_000);
  const busy = await cal.api.freeBusy(cal.token, { from, to, timezone });
  const slots = findSlots(busy, { from, days: 10, timeZone: timezone, durationMin, count: 3, workDays: opts.workDays });
  if (slots.length === 0) throw new UserFacingError("calendar_no_free_slots");

  const meeting = await t.meeting.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      leadId,
      integrationId: cal.integrationId,
      provider: cal.provider,
      title: `${lead.company || lead.name} — intro call`.slice(0, 200),
      timezone,
      durationMin,
      proposedSlots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })) as Prisma.InputJsonValue,
      attendeeEmail: lead.email,
      status: "PROPOSED",
      createdById: actor.type === "USER" ? (actor.id ?? null) : null,
    },
  });
  await addLeadEvent(scope, leadId, { type: "MEETING", title: "Meeting times proposed", data: { meetingId: meeting.id, slots: meeting.proposedSlots, timezone }, actor });
  return { meeting, slots, timezone };
}

/** Books one of the proposed slots — call only after the customer picked it. */
export async function bookMeeting(scope: TenantScope, meetingId: string, slotStart: string, actor: Actor) {
  const t = tenantDb(scope);
  const meeting = await t.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw new NotFoundError("item");
  if (meeting.status !== "PROPOSED") throw new UserFacingError("invalid_transition");
  const slot = (meeting.proposedSlots as StoredSlot[]).find((s) => s.start === slotStart);
  if (!slot) throw new UserFacingError("validation");
  const lead = await t.lead.findUnique({ where: { id: meeting.leadId } });
  if (!lead?.email) throw new UserFacingError("meeting_needs_email");
  const cal = await requireCalendar(scope);
  const org = await db.organization.findUniqueOrThrow({ where: { id: scope.organizationId }, select: { name: true } });

  const start = new Date(slot.start);
  const end = new Date(slot.end);
  // Re-check availability right before booking — the slot may have been taken since it was proposed.
  const busy = await cal.api.freeBusy(cal.token, { from: start, to: end, timezone: meeting.timezone });
  if (busy.some((b) => start < b.end && end > b.start)) throw new UserFacingError("calendar_slot_taken");

  const event = await cal.api.createEvent(cal.token, { title: meeting.title, description: `${org.name} × ${lead.company || lead.name}`, start, end, timezone: meeting.timezone, attendees: [lead.email] });
  const booked = await t.meeting.update({
    where: { id: meetingId },
    data: { status: "BOOKED", startAt: start, endAt: end, externalEventId: event.externalId, joinUrl: event.joinUrl, integrationId: cal.integrationId, provider: cal.provider, attendeeEmail: lead.email },
  });
  await t.lead.update({ where: { id: lead.id }, data: { nextAction: meeting.title, nextActionAt: start } });
  await addLeadEvent(scope, lead.id, { type: "MEETING", title: "Meeting booked", data: { meetingId, start: slot.start, end: slot.end, provider: cal.provider }, actor });
  await audit({ ...scope, actorType: actor.type, actorId: actor.id, actorLabel: actor.label, action: "meeting.booked", entityType: "Meeting", entityId: meetingId, summary: `Meeting booked with ${lead.name}` });
  return booked;
}

export async function rescheduleMeeting(scope: TenantScope, meetingId: string, slot: Interval, actor: Actor) {
  const t = tenantDb(scope);
  const meeting = await t.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting || meeting.status !== "BOOKED" || !meeting.externalEventId) throw new UserFacingError("invalid_transition");
  const cal = await requireCalendar(scope);
  await cal.api.updateEvent(cal.token, meeting.externalEventId, { title: meeting.title, start: slot.start, end: slot.end, timezone: meeting.timezone, attendees: meeting.attendeeEmail ? [meeting.attendeeEmail] : [] });
  const updated = await t.meeting.update({ where: { id: meetingId }, data: { startAt: slot.start, endAt: slot.end } });
  await addLeadEvent(scope, meeting.leadId, { type: "MEETING", title: "Meeting rescheduled", data: { meetingId, start: slot.start.toISOString() }, actor });
  return updated;
}

export async function cancelMeeting(scope: TenantScope, meetingId: string, actor: Actor) {
  const t = tenantDb(scope);
  const meeting = await t.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting || meeting.status === "CANCELLED") throw new UserFacingError("invalid_transition");
  if (meeting.status === "BOOKED" && meeting.externalEventId) {
    const cal = await requireCalendar(scope);
    await cal.api.cancelEvent(cal.token, meeting.externalEventId);
  }
  const updated = await t.meeting.update({ where: { id: meetingId }, data: { status: "CANCELLED" } });
  await addLeadEvent(scope, meeting.leadId, { type: "MEETING", title: "Meeting cancelled", data: { meetingId }, actor });
  return updated;
}
