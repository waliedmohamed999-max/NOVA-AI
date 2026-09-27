import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { completeConnect, startConnect } from "@/server/integrations/service";
import { loadConnections } from "@/server/integrations/connections";
import { calendarFor, mailboxFor } from "@/server/integrations/workspace";
import { channelFor } from "@/server/sales/channels";
import { createLead, draftLeadMessage } from "@/server/sales/service";
import { bookMeeting, cancelMeeting, proposeSlots } from "@/server/calendar/service";
import { findSlots, zonedTime } from "@/server/calendar/slots";
import { parseWebhook, verifySignature, verifyWebhookChallenge } from "@/server/whatsapp/cloud-api";
import { processWebhook, sendWhatsApp, windowOpen } from "@/server/whatsapp/service";
import { UserFacingError } from "@/server/errors";

/** Google / Microsoft account connections, calendar booking and WhatsApp Cloud API — provider HTTP mocked. */
type Call = { url: string; method: string; body: string };
let calls: Call[] = [];
type Handler = (url: string, init: RequestInit | undefined) => Response | null;
function mockFetch(...handlers: Handler[]) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? String(init.body) : "" });
    for (const h of handlers) {
      const r = h(url, init);
      if (r) return r;
    }
    return new Response(JSON.stringify({ error: `unmocked ${url}` }), { status: 500 });
  }));
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

const saved: Record<string, string | undefined> = {};
function env(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in saved)) saved[k] = process.env[k];
    process.env[k] = v;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
});

const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
const CAL = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"];

function google(granted: string[]): Handler {
  return (url) => {
    if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "ya29.token", expires_in: 3599, refresh_token: "1//refresh", scope: ["openid", "https://www.googleapis.com/auth/userinfo.email", ...granted].join(" ") });
    if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) return json({ sub: "g-123", email: "sales@acme.test", name: "Acme Sales" });
    if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")) return json({ id: "gmail-msg-1", threadId: "thr-1" });
    if (url.startsWith("https://www.googleapis.com/calendar/v3/freeBusy")) return json({ calendars: { primary: { busy: [] } } });
    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) return json({ id: "evt-1", htmlLink: "https://calendar.google.com/evt-1" });
    return null;
  };
}

async function connect(t: Awaited<ReturnType<typeof makeTenant>>, id: "google" | "microsoft", upgrade?: { platform: string; capability: string }) {
  const url = new URL(await startConnect(t.scope, t.user.id, id, "settings", upgrade));
  const res = await completeConnect(id, { code: "code-1", state: url.searchParams.get("state") }, t.user.id);
  return { url, res };
}

describe("Google account connection", () => {
  it("starts with identity only (PKCE, offline), then adds Gmail sending incrementally", async () => {
    env({ GOOGLE_CLIENT_ID: "g-client", GOOGLE_CLIENT_SECRET: "g-secret" });
    const t = await makeTenant();
    mockFetch(google([]));
    const first = await connect(t, "google");
    expect(first.url.origin + first.url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(first.url.searchParams.get("scope")).toBe("openid email profile");
    expect(first.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(first.url.searchParams.get("access_type")).toBe("offline");
    expect(first.url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(first.res.error).toBeUndefined();
    expect(first.res.connected).toEqual(["GOOGLE"]);

    let view = await loadConnections(t.scope, false);
    const card = view.accounts.find((a) => a.provider === "GOOGLE")!;
    expect(card.state).toBe("missing_permission");
    expect(card.email).toBe("sales@acme.test");
    expect(card.capabilities).toEqual([{ key: "email_send", status: "missing" }, { key: "calendar", status: "missing" }]);
    // Account connections are not social channels: the plan's channel counter is untouched.
    expect(view.plan.used).toBe(0);
    expect(await mailboxFor(t.scope)).toBeNull();

    mockFetch(google([GMAIL_SEND]));
    const up = await connect(t, "google", { platform: "GOOGLE", capability: "email_send" });
    expect(up.url.searchParams.get("scope")!.split(" ")).toEqual(expect.arrayContaining(["openid", "email", "profile", GMAIL_SEND]));
    expect(up.url.searchParams.get("scope")).not.toContain("calendar");
    view = await loadConnections(t.scope, false);
    expect(view.accounts.find((a) => a.provider === "GOOGLE")!.capabilities[0]).toEqual({ key: "email_send", status: "granted" });

    const box = await mailboxFor(t.scope);
    expect(box?.provider).toBe("GOOGLE");
    // The email channel now sends from the connected Gmail mailbox (RFC 822, base64url).
    const ch = channelFor("EMAIL")!;
    expect(await ch.describe(t.scope)).toBe("Gmail: sales@acme.test");
    const sent = await ch.send(t.scope, { email: "lead@customer.test" }, { subject: "مرحبا", body: "Hello there", locale: "en" });
    expect(sent).toEqual({ externalId: "gmail-msg-1", via: "gmail" });
    const call = calls.find((c) => c.url.includes("gmail.googleapis.com"))!;
    const raw = Buffer.from(JSON.parse(call.body).raw, "base64url").toString("utf8");
    expect(raw).toContain("To: lead@customer.test");
    expect(raw).toContain("Subject: =?UTF-8?B?");
  });

  it("refuses an upgrade the operator didn't enable (GOOGLE_OPTIONAL_SCOPES)", async () => {
    env({ GOOGLE_CLIENT_ID: "g-client", GOOGLE_CLIENT_SECRET: "g-secret", GOOGLE_OPTIONAL_SCOPES: GMAIL_SEND });
    const t = await makeTenant();
    await expect(startConnect(t.scope, t.user.id, "google", "settings", { platform: "GOOGLE", capability: "calendar" })).rejects.toMatchObject({ code: "capability_unavailable" });
  });
});

describe("Microsoft account + calendar booking", () => {
  function microsoft(opts: { busy?: { start: string; end: string }[] } = {}): Handler {
    return (url) => {
      if (url.startsWith("https://login.microsoftonline.com/common/oauth2/v2.0/token")) return json({ access_token: "eyJ.ms", expires_in: 3600, refresh_token: "ms-refresh", scope: "openid email profile offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Calendars.ReadWrite" });
      if (url.startsWith("https://graph.microsoft.com/v1.0/me?")) return json({ id: "ms-1", displayName: "Acme Sales", mail: "sales@acme.test" });
      if (url === "https://graph.microsoft.com/v1.0/me/calendar/getSchedule") return json({ value: [{ scheduleItems: (opts.busy ?? []).map((b) => ({ status: "busy", start: { dateTime: b.start }, end: { dateTime: b.end } })) }] });
      if (url === "https://graph.microsoft.com/v1.0/me/events") return json({ id: "ms-evt-1", webLink: "https://outlook.office.com/evt" });
      if (/\/me\/events\/ms-evt-1\/cancel$/.test(url)) return new Response(null, { status: 202 });
      return null;
    };
  }

  it("never claims a booking without a connected calendar", async () => {
    const t = await makeTenant();
    const lead = await createLead(t.scope, { name: "Mona", email: "mona@customer.test" }, { type: "SYSTEM" }, { qualify: false });
    await expect(proposeSlots(t.scope, lead.id, { type: "SYSTEM" })).rejects.toMatchObject({ code: "calendar_not_connected" });
    expect(await db.meeting.count({ where: t.scope })).toBe(0);
  });

  it("proposes 3 free slots in working hours, books the one the customer picked, and cancels", async () => {
    env({ MICROSOFT_CLIENT_ID: "ms-client", MICROSOFT_CLIENT_SECRET: "ms-secret", MICROSOFT_TENANT_ID: "" });
    const t = await makeTenant();
    await db.workspaceSettings.updateMany({ where: t.scope, data: { timezone: "Africa/Cairo" } });
    mockFetch(microsoft());
    const { url, res } = await connect(t, "microsoft", { platform: "MICROSOFT", capability: "calendar" });
    expect(url.searchParams.get("scope")).toContain("Calendars.ReadWrite");
    expect(res.connected).toEqual(["MICROSOFT"]);
    expect((await calendarFor(t.scope))?.provider).toBe("MICROSOFT");
    expect(await mailboxFor(t.scope)).toBeNull(); // Mail.Send not granted

    const lead = await createLead(t.scope, { name: "Mona", email: "mona@customer.test" }, { type: "SYSTEM" }, { qualify: false });
    const now = new Date("2026-10-04T06:00:00Z"); // Sunday 09:00 Cairo
    const busyStart = zonedTime(2026, 10, 5, 9, 0, "Africa/Cairo");
    mockFetch(microsoft({ busy: [{ start: busyStart.toISOString().slice(0, 19), end: new Date(busyStart.getTime() + 3 * 3600_000).toISOString().slice(0, 19) }] }));
    const p = await proposeSlots(t.scope, lead.id, { type: "USER", id: t.user.id }, { now });
    expect(p.slots).toHaveLength(3);
    expect(p.timezone).toBe("Africa/Cairo");
    for (const s of p.slots) {
      const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hour: "numeric", hourCycle: "h23" }).format(s.start));
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(17);
      expect(s.start < busyStart || s.start >= new Date(busyStart.getTime() + 3 * 3600_000)).toBe(true);
    }
    expect(p.meeting.status).toBe("PROPOSED");

    mockFetch(microsoft());
    const booked = await bookMeeting(t.scope, p.meeting.id, p.slots[1].start.toISOString(), { type: "USER", id: t.user.id });
    expect(booked.status).toBe("BOOKED");
    expect(booked.externalEventId).toBe("ms-evt-1");
    const create = calls.find((c) => c.url.endsWith("/me/events"))!;
    expect(JSON.parse(create.body).attendees[0].emailAddress.address).toBe("mona@customer.test");
    // A slot that wasn't proposed can't be booked; a booked meeting can't be booked twice.
    await expect(bookMeeting(t.scope, p.meeting.id, p.slots[0].start.toISOString(), { type: "SYSTEM" })).rejects.toMatchObject({ code: "invalid_transition" });

    const cancelled = await cancelMeeting(t.scope, p.meeting.id, { type: "USER", id: t.user.id });
    expect(cancelled.status).toBe("CANCELLED");
    expect(calls.some((c) => c.url.endsWith("/me/events/ms-evt-1/cancel"))).toBe(true);
  });

  it("refuses to book a slot that became busy since it was proposed", async () => {
    env({ MICROSOFT_CLIENT_ID: "ms-client", MICROSOFT_CLIENT_SECRET: "ms-secret" });
    const t = await makeTenant();
    mockFetch(microsoft());
    await connect(t, "microsoft", { platform: "MICROSOFT", capability: "calendar" });
    const lead = await createLead(t.scope, { name: "Omar", email: "omar@customer.test" }, { type: "SYSTEM" }, { qualify: false });
    const p = await proposeSlots(t.scope, lead.id, { type: "SYSTEM" }, { now: new Date("2026-10-05T06:00:00Z") });
    const s = p.slots[0];
    mockFetch(microsoft({ busy: [{ start: s.start.toISOString().slice(0, 19), end: s.end.toISOString().slice(0, 19) }] }));
    await expect(bookMeeting(t.scope, p.meeting.id, s.start.toISOString(), { type: "SYSTEM" })).rejects.toMatchObject({ code: "calendar_slot_taken" });
    expect(calls.some((c) => c.url.endsWith("/me/events"))).toBe(false);
  });

  it("another workspace can't book or cancel this meeting (tenant isolation)", async () => {
    env({ MICROSOFT_CLIENT_ID: "ms-client", MICROSOFT_CLIENT_SECRET: "ms-secret" });
    const a = await makeTenant();
    const b = await makeTenant();
    mockFetch(microsoft());
    await connect(a, "microsoft", { platform: "MICROSOFT", capability: "calendar" });
    const lead = await createLead(a.scope, { name: "Lina", email: "lina@customer.test" }, { type: "SYSTEM" }, { qualify: false });
    const p = await proposeSlots(a.scope, lead.id, { type: "SYSTEM" }, { now: new Date("2026-10-05T06:00:00Z") });
    await expect(bookMeeting(b.scope, p.meeting.id, p.slots[0].start.toISOString(), { type: "SYSTEM" })).rejects.toBeInstanceOf(UserFacingError);
    await expect(cancelMeeting(b.scope, p.meeting.id, { type: "SYSTEM" })).rejects.toBeInstanceOf(UserFacingError);
  });
});

describe("slot finder", () => {
  it("respects the work week and minimum notice, and spreads options across days", () => {
    const from = new Date("2026-10-01T05:00:00Z"); // Thursday 08:00 Cairo
    const slots = findSlots([], { from, days: 7, timeZone: "Africa/Cairo", durationMin: 30, count: 3, workDays: [0, 1, 2, 3, 4] });
    expect(slots).toHaveLength(3);
    const days = new Set(slots.map((s) => new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", weekday: "short" }).format(s.start)));
    expect(days.has("Fri")).toBe(false);
    expect(days.has("Sat")).toBe(false);
    expect(days.size).toBe(3);
    expect(slots[0].start.getTime()).toBeGreaterThanOrEqual(from.getTime() + 120 * 60_000);
  });
});

describe("WhatsApp Business Platform (Cloud API)", () => {
  const SECRET = "wa-app-secret-0123456789abcdef";
  const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
  const inbound = (id: string, from = "201001234567", text = "Hi, what are your packages?") => ({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PN-1" }, contacts: [{ wa_id: from, profile: { name: "Hana" } }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] } }] }],
  });

  it("verifies the subscription challenge and the X-Hub-Signature-256 of every delivery", () => {
    env({ WHATSAPP_VERIFY_TOKEN: "verify-me", WHATSAPP_APP_SECRET: SECRET });
    expect(verifyWebhookChallenge(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" }))).toBe("42");
    expect(verifyWebhookChallenge(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42" }))).toBeNull();
    const body = JSON.stringify(inbound("wamid.1"));
    expect(verifySignature(body, sign(body))).toBe(true);
    expect(verifySignature(body + " ", sign(body))).toBe(false);
    expect(verifySignature(body, null)).toBe(false);
    expect(verifySignature(body, "sha256=deadbeef")).toBe(false);
  });

  it("turns an inbound message into a lead + conversation, ignores redeliveries, and tracks delivery status", async () => {
    env({ WHATSAPP_ACCESS_TOKEN: "EAAG-test", WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: "v" });
    const t = await makeTenant();
    await db.whatsAppNumber.create({ data: { ...t.scope, phoneNumberId: "PN-1", displayPhone: "+20 100 000 0000" } });

    const r1 = await processWebhook(inbound("wamid.A"));
    expect(r1.received).toBe(1);
    const again = await processWebhook(inbound("wamid.A"));
    expect(again.received).toBe(0);
    const lead = await db.lead.findFirstOrThrow({ where: t.scope });
    expect(lead).toMatchObject({ name: "Hana", phone: "+201001234567", channel: "WHATSAPP", medium: "whatsapp" });
    const conv = await db.conversation.findFirstOrThrow({ where: { leadId: lead.id }, include: { messages: true } });
    expect(conv.channel).toBe("WHATSAPP");
    expect(conv.messages).toHaveLength(1);
    expect(await windowOpen(t.scope, "+20 100 123 4567")).toBe(true);

    // A second message from the same number joins the same lead and conversation.
    await processWebhook(inbound("wamid.B", "201001234567", "Also, do you do reels?"));
    expect(await db.lead.count({ where: t.scope })).toBe(1);
    expect(await db.message.count({ where: { conversationId: conv.id } })).toBe(2);

    // Reply inside the 24h window goes out through the Cloud API; status webhooks update it.
    mockFetch((url) => (url.endsWith("/PN-1/messages") ? json({ messages: [{ id: "wamid.OUT1" }] }) : null));
    expect(await channelFor("WHATSAPP")!.isConfigured(t.scope)).toBe(true);
    const out = await sendWhatsApp(t.scope, lead.phone!, { body: "Thanks Hana! Here are our packages…" });
    expect(out.externalId).toBe("wamid.OUT1");
    expect(JSON.parse(calls[0].body)).toMatchObject({ messaging_product: "whatsapp", to: "201001234567", type: "text" });
    await db.message.create({ data: { ...t.scope, conversationId: conv.id, direction: "OUTBOUND", authorType: "AGENT", body: "x", status: "SENT", externalId: "wamid.OUT1" } });
    await processWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "PN-1" }, statuses: [{ id: "wamid.OUT1", status: "read", recipient_id: "201001234567", timestamp: "1790000000" }] } }] }] });
    expect((await db.message.findFirstOrThrow({ where: { externalId: "wamid.OUT1" } })).deliveryStatus).toBe("read");
  });

  it("won't send free text outside the 24h window and ignores numbers not linked to any workspace", async () => {
    env({ WHATSAPP_ACCESS_TOKEN: "EAAG-test" });
    const t = await makeTenant();
    await db.whatsAppNumber.create({ data: { ...t.scope, phoneNumberId: "PN-2" } });
    await expect(sendWhatsApp(t.scope, "+201009999999", { body: "hello" })).rejects.toMatchObject({ code: "whatsapp_window_closed" });
    const r = await processWebhook({ ...inbound("wamid.X"), entry: [{ changes: [{ value: { ...inbound("wamid.X").entry[0].changes[0].value, metadata: { phone_number_id: "PN-UNKNOWN" } } }] }] });
    expect(r.received).toBe(0);
    expect(parseWebhook({ object: "page" }).messages).toHaveLength(0);
  });

  it("the Sales Agent keeps WhatsApp replies as drafts when no number is linked", async () => {
    env({ WHATSAPP_ACCESS_TOKEN: "" });
    const t = await makeTenant();
    await db.workspaceSettings.updateMany({ where: t.scope, data: { salesAutonomy: "AUTOPILOT", autopilotAllowedTasks: ["send_follow_up"] } });
    const lead = await createLead(t.scope, { name: "Ali", phone: "+201005555555", channel: "WHATSAPP", message: "hi" }, { type: "SYSTEM" }, { qualify: false });
    const { disposition, message } = await draftLeadMessage(t.scope, lead.id, { body: "Hello Ali", sensitiveTopics: [] }, { reason: "test", locale: "en" });
    expect(disposition).toBe("draft");
    expect(message.status).toBe("DRAFT");
  });
});

describe("lead attribution", () => {
  it("stores only the attribution that was observed", async () => {
    const t = await makeTenant();
    const lead = await createLead(t.scope, { name: "Sara", attribution: { utmSource: "linkedin", medium: "social", utmCampaign: "launch", utmContent: "post-1" } }, { type: "SYSTEM" }, { qualify: false });
    expect(lead).toMatchObject({ utmSource: "linkedin", medium: "social", utmCampaign: "launch", utmContent: "post-1", socialPostId: null, landingUrl: null });
  });
});
