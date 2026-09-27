import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { tenantDb } from "@/server/db/tenant";
import { makeTenant } from "../support/factory";
import { authenticate, consumeToken, issueToken, requestPasswordReset, resetPassword, signUp, AuthError } from "@/server/auth/service";
import { createSessionRecord, validateSessionToken } from "@/server/auth/sessions";
import { rateLimit } from "@/server/rate-limit";

describe("tenant isolation", () => {
  it("never exposes one tenant's rows to another", async () => {
    const a = await makeTenant("Tenant A");
    const b = await makeTenant("Tenant B");
    const ta = tenantDb(a.scope);
    const tb = tenantDb(b.scope);

    const leadA = await ta.lead.create({ data: { name: "Alice", organizationId: "", workspaceId: "" } });
    expect(leadA.organizationId).toBe(a.organization.id);

    // Reads
    expect(await tb.lead.findUnique({ where: { id: leadA.id } })).toBeNull();
    expect(await tb.lead.findMany()).toHaveLength(0);
    expect(await tb.lead.count()).toBe(0);
    expect(await ta.lead.count()).toBe(1);

    // Writes and deletes
    await expect(tb.lead.update({ where: { id: leadA.id }, data: { name: "Hacked" } })).rejects.toThrow();
    expect((await tb.lead.updateMany({ where: { id: leadA.id }, data: { name: "Hacked" } })).count).toBe(0);
    expect((await tb.lead.deleteMany({ where: { id: leadA.id } })).count).toBe(0);
    expect((await db.lead.findUnique({ where: { id: leadA.id } }))?.name).toBe("Alice");

    // Cannot move a row into another tenant
    await ta.lead.update({ where: { id: leadA.id }, data: { name: "Alice 2", organizationId: b.organization.id } as never });
    expect((await db.lead.findUnique({ where: { id: leadA.id } }))?.organizationId).toBe(a.organization.id);

    // Organization-level models are scoped too
    expect(await tb.organizationMember.findMany()).toHaveLength(1);
    expect((await tb.organizationMember.findMany())[0].userId).toBe(b.user.id);
  });

  it("provisions every default a new organization needs", async () => {
    const t = await makeTenant("Provisioned Co");
    const where = t.scope;
    expect(await db.agent.count({ where })).toBe(6);
    expect(await db.pipelineStage.count({ where })).toBe(7);
    expect(await db.approvalPolicy.count({ where })).toBeGreaterThanOrEqual(8);
    expect(await db.designTemplate.count({ where })).toBe(5);
    expect(await db.subscription.findUnique({ where: { organizationId: t.organization.id } })).toMatchObject({ plan: "STARTER", status: "TRIALING" });
    const member = await db.organizationMember.findFirst({ where: { organizationId: t.organization.id } });
    expect(member?.role).toBe("OWNER");
  });
});

describe("authentication", () => {
  it("signs up, authenticates and rejects wrong passwords", async () => {
    const email = `Owner+${Date.now()}@Example.com`;
    const user = await signUp({ name: "Owner", email, password: "correct-horse-9", locale: "en" });
    expect(user.email).toBe(email.toLowerCase());
    expect(await authenticate(email, "correct-horse-9")).toMatchObject({ id: user.id });
    expect(await authenticate(email, "wrong-password-1")).toBeNull();
    expect(await authenticate("nobody@example.com", "whatever-123")).toBeNull();
    // passwordHash is never returned
    expect((await authenticate(email, "correct-horse-9")) as object).not.toHaveProperty("passwordHash");
    await expect(signUp({ name: "Again", email, password: "correct-horse-9" })).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects weak passwords", async () => {
    await expect(signUp({ name: "W", email: `weak${Date.now()}@example.com`, password: "short" })).rejects.toThrow();
    await expect(signUp({ name: "W", email: `weak2${Date.now()}@example.com`, password: "onlyletterslong" })).rejects.toThrow();
  });

  it("tokens are single-use and expire", async () => {
    const raw = await issueToken("MAGIC_LINK", "token@example.com");
    expect(await consumeToken("MAGIC_LINK", raw)).not.toBeNull();
    expect(await consumeToken("MAGIC_LINK", raw)).toBeNull();
    expect(await consumeToken("PASSWORD_RESET", await issueToken("MAGIC_LINK", "t2@example.com"))).toBeNull();
    const expired = await issueToken("MAGIC_LINK", "t3@example.com");
    await db.verificationToken.updateMany({ where: { email: "t3@example.com" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await consumeToken("MAGIC_LINK", expired)).toBeNull();
  });

  it("password reset revokes all sessions", async () => {
    const email = `reset${Date.now()}@example.com`;
    const user = await signUp({ name: "R", email, password: "first-password-1" });
    const { token } = await createSessionRecord(user.id, {});
    expect(await validateSessionToken(token)).not.toBeNull();
    await requestPasswordReset(email);
    const reset = await issueToken("PASSWORD_RESET", email, user.id);
    await resetPassword(reset, "second-password-2");
    expect(await validateSessionToken(token)).toBeNull();
    expect(await authenticate(email, "second-password-2")).not.toBeNull();
  });

  it("expired sessions are invalid", async () => {
    const t = await makeTenant();
    const { token } = await createSessionRecord(t.user.id, {});
    await db.session.updateMany({ where: { userId: t.user.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("rate limits by key", async () => {
    const key = `test:${Date.now()}`;
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60)).ok).toBe(true);
    expect((await rateLimit(key, 3, 60)).ok).toBe(false);
  });
});

describe("append-only history", () => {
  it("blocks updates to audit logs at the database level", async () => {
    const log = await db.auditLog.create({ data: { actorType: "SYSTEM", action: "test", summary: "immutable" } });
    await expect(db.auditLog.update({ where: { id: log.id }, data: { summary: "changed" } })).rejects.toThrow();
  });
});
