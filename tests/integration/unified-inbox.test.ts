import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { setMailer, type Mailer } from "@/server/email/mailer";
import { getThread, inboxCounts, listInbox, replyToConversation, setConversationStatus } from "@/server/inbox/service";
import { makeTenant } from "../support/factory";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const actor = (t: Tenant) => ({ userId: t.user.id, label: "Owner" });

const sent: { to: string; subject: string }[] = [];
const fakeMailer: Mailer = {
  name: "fake",
  configured: true,
  async send(m) {
    sent.push({ to: m.to, subject: m.subject });
    return { messageId: "fake-1" };
  },
  async testConnection() {
    return { ok: true, detail: "fake" };
  },
};

async function conversation(t: Tenant, o: { name: string; channel: "EMAIL" | "WEBSITE" | "WHATSAPP" | "MANUAL"; inbound: string; subject?: string; replied?: boolean; email?: string | null }) {
  const lead = await db.lead.create({ data: { ...t.scope, name: o.name, email: o.email === undefined ? `${o.name.toLowerCase().replace(/\s/g, ".")}@example.test` : o.email, channel: o.channel } });
  const at = new Date(Date.now() - 60_000);
  const conv = await db.conversation.create({ data: { ...t.scope, leadId: lead.id, channel: o.channel, subject: o.subject ?? null, lastInboundAt: at, lastMessageAt: at, unreadCount: 1 } });
  await db.message.create({ data: { ...t.scope, conversationId: conv.id, direction: "INBOUND", authorType: "USER", body: o.inbound, status: "RECEIVED", sentAt: at } });
  if (o.replied) {
    await db.message.create({ data: { ...t.scope, conversationId: conv.id, direction: "OUTBOUND", authorType: "USER", body: "Thanks!", status: "SENT", sentAt: new Date() } });
    await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), unreadCount: 0 } });
  }
  return conv;
}

afterEach(() => {
  setMailer(null);
  sent.length = 0;
});

/** One inbox for every channel: filters, search, replies through the right channel, close / reopen. */
describe("unified inbox", () => {
  it("lists every channel and filters by needs-reply, channel and search", async () => {
    const t = await makeTenant("Inbox Co");
    const a = await conversation(t, { name: "Mona Saleh", channel: "EMAIL", inbound: "Do you ship to Jeddah?" });
    const b = await conversation(t, { name: "Omar Fathy", channel: "WEBSITE", inbound: "Pricing for 10 seats?", replied: true });
    const c = await conversation(t, { name: "Sara Nabil", channel: "WHATSAPP", inbound: "مرحبا، عندكم توصيل؟" });

    const all = await listInbox(t.scope);
    expect(all.items.map((i) => i.id).sort()).toEqual([a.id, b.id, c.id].sort());

    const needs = await listInbox(t.scope, { filter: "needs_reply" });
    expect(needs.items.map((i) => i.id).sort()).toEqual([a.id, c.id].sort());
    expect(all.items.find((i) => i.id === b.id)?.needsReply).toBe(false);

    expect((await listInbox(t.scope, { channel: "WHATSAPP" })).items.map((i) => i.id)).toEqual([c.id]);
    expect((await listInbox(t.scope, { q: "jeddah" })).items.map((i) => i.id)).toEqual([a.id]);
    expect((await listInbox(t.scope, { q: "omar" })).items.map((i) => i.id)).toEqual([b.id]);
    expect(await inboxCounts(t.scope)).toEqual({ open: 3, needsReply: 2, unread: 2 });
  });

  it("never shows another workspace's conversations", async () => {
    const a = await makeTenant("Tenant A");
    const b = await makeTenant("Tenant B");
    const conv = await conversation(a, { name: "Private Lead", channel: "EMAIL", inbound: "hello" });
    expect((await listInbox(b.scope)).items).toHaveLength(0);
    await expect(getThread(b.scope, conv.id)).rejects.toThrow();
    await expect(replyToConversation(b.scope, conv.id, "hi", actor(b))).rejects.toThrow();
  });

  it("opening a thread marks it read and explains when a reply can't go out", async () => {
    const t = await makeTenant("Thread Co");
    const conv = await conversation(t, { name: "No Email", channel: "EMAIL", inbound: "Hi", email: null });
    setMailer(fakeMailer);
    const thread = await getThread(t.scope, conv.id);
    expect(thread.messages).toHaveLength(1);
    expect(thread.reply.blocked).toBe("no_recipient");
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).unreadCount).toBe(0);
  });

  it("replies by email through the channel adapter and clears 'needs reply'", async () => {
    const t = await makeTenant("Reply Co");
    const conv = await conversation(t, { name: "Hana Adel", channel: "EMAIL", inbound: "Can I book a demo?", subject: "Demo request" });
    setMailer(fakeMailer);
    expect((await getThread(t.scope, conv.id)).reply.blocked).toBeNull();
    await replyToConversation(t.scope, conv.id, "Sure — how about Tuesday?", actor(t));

    expect(sent).toEqual([{ to: "hana.adel@example.test", subject: "Re: Demo request" }]);
    const out = await db.message.findFirstOrThrow({ where: { conversationId: conv.id, direction: "OUTBOUND" } });
    expect(out.status).toBe("SENT");
    expect((await listInbox(t.scope, { filter: "needs_reply" })).items).toHaveLength(0);
  });

  it("refuses to send when the channel isn't connected", async () => {
    const t = await makeTenant("Offline Co");
    const conv = await conversation(t, { name: "Manual Lead", channel: "MANUAL", inbound: "Called about pricing" });
    expect((await getThread(t.scope, conv.id)).reply.blocked).toBe("integration_not_configured");
    await expect(replyToConversation(t.scope, conv.id, "hello", actor(t))).rejects.toMatchObject({ code: "integration_not_configured" });
  });

  it("closing moves a conversation out of the open list; replying reopens it", async () => {
    const t = await makeTenant("Close Co");
    const conv = await conversation(t, { name: "Lina Kamal", channel: "EMAIL", inbound: "Thanks, all good" });
    await setConversationStatus(t.scope, conv.id, "CLOSED", actor(t));
    expect((await listInbox(t.scope)).items).toHaveLength(0);
    expect((await listInbox(t.scope, { filter: "closed" })).items.map((i) => i.id)).toEqual([conv.id]);
    expect((await inboxCounts(t.scope)).needsReply).toBe(0);

    setMailer(fakeMailer);
    await replyToConversation(t.scope, conv.id, "One more thing…", actor(t));
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe("OPEN");
  });
});
