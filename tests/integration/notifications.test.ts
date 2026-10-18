import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { setMailer, type Mailer } from "@/server/email/mailer";
import { notify } from "@/server/notifications/service";
import { makeTenant, makeUser } from "../support/factory";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;

const emails: { to: string; subject: string }[] = [];
const mailer: Mailer = {
  name: "fake",
  configured: true,
  async send(m) {
    emails.push({ to: m.to, subject: m.subject });
    return { messageId: "m" };
  },
  async testConnection() {
    return { ok: true, detail: "fake" };
  },
};
// notify() delivers email in the background; let those promises settle.
const settle = () => new Promise((r) => setTimeout(r, 20));

async function member(t: Tenant, role: "ADMIN" | "MANAGER" | "MEMBER" | "VIEWER", name: string) {
  const user = await makeUser({ name, email: `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@notif.test` });
  await db.organizationMember.create({ data: { organizationId: t.organization.id, userId: user.id, role } });
  return user;
}

afterEach(() => {
  setMailer(null);
  emails.length = 0;
});

describe("notifications", () => {
  it("goes to owners, admins and managers by default — not members or viewers", async () => {
    const t = await makeTenant("Notify Co");
    const admin = await member(t, "ADMIN", "Admin");
    const manager = await member(t, "MANAGER", "Manager");
    const plain = await member(t, "MEMBER", "Member");
    const viewer = await member(t, "VIEWER", "Viewer");
    setMailer(mailer);

    const created = await notify({ ...t.scope, type: "REPORT_READY", title: "Weekly report ready", link: "/reports/x" });
    const to = new Set(created.map((n) => n.userId));
    expect(to).toEqual(new Set([t.user.id, admin.id, manager.id]));
    expect(to.has(plain.id) || to.has(viewer.id)).toBe(false);
    await settle();
    expect(emails).toHaveLength(0); // REPORT_READY isn't an email-by-default type
  });

  it("explicit recipients and roles override the default audience", async () => {
    const t = await makeTenant("Target Co");
    const plain = await member(t, "MEMBER", "Member");
    expect((await notify({ ...t.scope, type: "AI_RECOMMENDATION", title: "For you", userIds: [plain.id] })).map((n) => n.userId)).toEqual([plain.id]);
    expect((await notify({ ...t.scope, type: "AI_RECOMMENDATION", title: "Owners only", roles: ["OWNER"] })).map((n) => n.userId)).toEqual([t.user.id]);
  });

  it("emails urgent types by default and follows each person's preferences", async () => {
    const t = await makeTenant("Prefs Co");
    const admin = await member(t, "ADMIN", "Quiet");
    setMailer(mailer);
    // Owner: default (PUBLISHING_FAILED emails by default). Admin: in-app off, email off.
    await db.notificationPreference.create({ data: { organizationId: t.organization.id, userId: admin.id, type: "PUBLISHING_FAILED", inApp: false, email: false } });

    const created = await notify({ ...t.scope, type: "PUBLISHING_FAILED", title: "Post couldn't be published" });
    expect(created.map((n) => n.userId)).toEqual([t.user.id]);
    await settle();
    expect(emails).toEqual([{ to: t.user.email, subject: "Post couldn't be published" }]);
  });

  it("a failing email never breaks the in-app notification", async () => {
    const t = await makeTenant("Mail Down Co");
    setMailer({ ...mailer, async send() { throw new Error("SMTP down"); } });
    const created = await notify({ ...t.scope, type: "HOT_OPPORTUNITY", title: "Hot lead" });
    await settle();
    expect(created).toHaveLength(1);
  });

  it("never reaches another organization's members", async () => {
    const a = await makeTenant("Org A");
    const b = await makeTenant("Org B");
    await notify({ ...a.scope, type: "REPORT_READY", title: "A only", userIds: [b.user.id] });
    expect(await db.notification.count({ where: { userId: b.user.id, title: "A only" } })).toBe(0);
  });
});
