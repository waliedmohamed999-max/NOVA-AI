import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { entityHref, listActivity } from "@/server/activity";
import { makeTenant } from "../support/factory";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;

async function log(t: Tenant, o: { summary: string; actorType?: "USER" | "AGENT" | "SYSTEM"; category?: "BUSINESS" | "SECURITY"; at?: string; actorLabel?: string; entityType?: string; entityId?: string }) {
  return db.auditLog.create({
    data: { ...t.scope, summary: o.summary, action: "test.event", actorType: o.actorType ?? "USER", actorLabel: o.actorLabel ?? null, category: o.category ?? "BUSINESS", entityType: o.entityType ?? null, entityId: o.entityId ?? null, ...(o.at ? { createdAt: new Date(o.at) } : {}) },
  });
}

describe("activity log", () => {
  it("filters by who, category, text and an inclusive date range", async () => {
    const t = await makeTenant("Activity Co");
    await db.auditLog.deleteMany({ where: { organizationId: t.organization.id } }); // provisioning entries
    await log(t, { summary: "Approved the October plan", actorLabel: "Mona", at: "2026-10-01T09:00:00Z" });
    await log(t, { summary: "Drafted 7 captions", actorType: "AGENT", actorLabel: "Content Strategist", at: "2026-10-02T09:00:00Z" });
    await log(t, { summary: "Signed in", category: "SECURITY", actorLabel: "Mona", at: "2026-10-03T23:30:00Z" });
    await log(t, { summary: "Published a post", actorType: "SYSTEM", at: "2026-10-04T09:00:00Z" });

    const s = (r: Awaited<ReturnType<typeof listActivity>>) => r.items.map((i) => i.summary);
    expect(s(await listActivity(t.scope))).toEqual(["Published a post", "Signed in", "Drafted 7 captions", "Approved the October plan"]);
    expect(s(await listActivity(t.scope, { actor: "AGENT" }))).toEqual(["Drafted 7 captions"]);
    expect(s(await listActivity(t.scope, { category: "SECURITY" }))).toEqual(["Signed in"]);
    expect(s(await listActivity(t.scope, { q: "mona" }))).toEqual(["Signed in", "Approved the October plan"]);
    expect(s(await listActivity(t.scope, { from: new Date("2026-10-02"), to: new Date("2026-10-03") }))).toEqual(["Signed in", "Drafted 7 captions"]);
  });

  it("paginates with a cursor and stays inside the workspace", async () => {
    const t = await makeTenant("Paging Co");
    const other = await makeTenant("Other Co");
    for (let i = 0; i < 55; i++) await log(t, { summary: `Event ${i}`, at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() });
    await log(other, { summary: "Other workspace secret" });

    const first = await listActivity(t.scope, { q: "Event" });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await listActivity(t.scope, { q: "Event", cursor: first.nextCursor });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect((await listActivity(t.scope, { q: "secret" })).items).toHaveLength(0);
  });

  it("links entries to the record they're about", () => {
    expect(entityHref("Lead", "l1")).toBe("/leads/l1");
    expect(entityHref("Conversation", "c1")).toBe("/inbox?c=c1");
    expect(entityHref("Approval", "a1")).toBeNull();
    expect(entityHref(null, "x")).toBeNull();
  });
});
