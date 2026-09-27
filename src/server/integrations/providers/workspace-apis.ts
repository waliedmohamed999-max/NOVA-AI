import type { TokenSet } from "../types";

/** Mailbox capability of an account connection (Gmail / Outlook): send as the connected user. */
export type OutgoingEmail = { to: string; subject: string; text: string; html?: string; replyTo?: string };
export interface MailboxApi {
  sendEmail(token: TokenSet, message: OutgoingEmail): Promise<{ externalId: string | null; threadId?: string | null }>;
}

/** Calendar capability (Google Calendar / Outlook Calendar). Times are absolute; `timezone` is the event's zone. */
export type BusyInterval = { start: Date; end: Date };
export type CalendarEventInput = { title: string; description?: string; start: Date; end: Date; timezone: string; attendees: string[] };
export interface CalendarApi {
  freeBusy(token: TokenSet, range: { from: Date; to: Date; timezone: string }): Promise<BusyInterval[]>;
  createEvent(token: TokenSet, event: CalendarEventInput): Promise<{ externalId: string; joinUrl: string | null }>;
  updateEvent(token: TokenSet, externalId: string, event: CalendarEventInput): Promise<void>;
  cancelEvent(token: TokenSet, externalId: string): Promise<void>;
}

export const isMailbox = (p: unknown): p is MailboxApi => typeof (p as MailboxApi)?.sendEmail === "function";
export const isCalendar = (p: unknown): p is CalendarApi => typeof (p as CalendarApi)?.freeBusy === "function";
