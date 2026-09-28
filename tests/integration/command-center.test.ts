import { describe, expect, it } from "vitest";
import "@/server/agents/jobs";
import { db } from "@/server/db/client";
import { tenantDb } from "@/server/db/tenant";
import { can } from "@/server/rbac";
import type { Role } from "@/generated/prisma/enums";
import type { TenantContext } from "@/server/context";
import { executeRun } from "@/server/agents/runtime";
import { createLead, scheduleFollowUp } from "@/server/sales/service";
import { commandHistory, commandStatus, commandSuggestions, executeCommand, replyToCommand, runCommand, understandCommand } from "@/server/command/service";
import { makeTenant, makeUser } from "../support/factory";

/** Command Center: real reads, real mutations/jobs, approvals, RBAC, tenant isolation, idempotency, activity log. */
type Tenant = Awaited<ReturnType<typeof makeTenant>>;
function ctxFor(t: Tenant, role: Role = "OWNER", user = t.user): TenantContext {
  return {
    user: { id: user.id, email: user.email, name: user.name, locale: "en", isPlatformAdmin: false, emailVerifiedAt: new Date() },
    sessionId: "s",
    organization: { id: t.organization.id, name: t.organization.name, slug: t.organization.slug, onboardingStatus: "COMPLETED", timezone: "UTC", locale: "en", isDemo: false },
    workspace: { id: t.workspace.id, name: "W" },
    role,
    db: tenantDb(t.scope),
    can: (p) => can(role, p),
  } as TenantContext;
}
const me = (t: Tenant) => ({ type: "USER" as const, id: t.user.id, label: "Owner" });
let n = 0;
const key = () => `k-${Date.now()}-${n++}-${Math.random().toString(36).slice(2)}`;
const cmd = (ctx: TenantContext, text: string, locale: "ar" | "en" = "ar") => executeCommand(ctx, { text, locale, idempotencyKey: key() });

describe("Command Center — pipeline", () => {
  it("1. navigation: 'افتح العملاء الساخنين' → router target, logged without AI", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    const r = await cmd(ctx, "افتح العملاء الساخنين");
    expect(r).toMatchObject({ intent: "open_hot_leads", type: "navigation", status: "completed", navigation: "/sales?view=hot", aiUsed: false });
    const log = await db.commandExecution.findUniqueOrThrow({ where: { id: r.executionId } });
    expect(log).toMatchObject({ organizationId: t.organization.id, userId: t.user.id, intent: "open_hot_leads", status: "completed", aiUsed: false, approvalRequired: false });
    expect(log.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("2. 'who needs a follow-up today' reads real follow-ups (today + overdue, one row per customer)", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    expect((await cmd(ctx, "من العملاء اللي محتاجين متابعة اليوم؟")).message.key).toBe("noFollowups");
    const a = await createLead(t.scope, { name: "Falcon Group" }, me(t), { qualify: false });
    const b = await createLead(t.scope, { name: "Nour Café" }, me(t), { qualify: false });
    await scheduleFollowUp(t.scope, a.id, { title: "Call", dueAt: new Date(Date.now() - 3 * 86_400_000) });
    await scheduleFollowUp(t.scope, b.id, { title: "Send menu", dueAt: new Date(Date.now() + 60_000) });
    await scheduleFollowUp(t.scope, b.id, { title: "Later", dueAt: new Date(Date.now() + 9 * 86_400_000) });
    const r = await cmd(ctx, "من العملاء اللي محتاجين متابعة اليوم؟");
    expect(r).toMatchObject({ intent: "followups_today", type: "read", status: "completed", message: { key: "followupsFound", values: { count: 2 } } });
    expect(r.stats).toEqual(expect.arrayContaining([{ key: "overdue", value: 1 }]));
    expect(r.items?.map((i) => i.title).sort()).toEqual(["Falcon Group", "Nour Café"]);
    expect(r.actions?.[0]).toMatchObject({ label: "openFollowups", href: "/sales?view=followups&tab=today" });
  });

  it("3. 'لخص لي حالة المبيعات' returns real metrics", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    expect((await cmd(ctx, "لخص لي حالة المبيعات")).message.key).toBe("noSalesData");
    await createLead(t.scope, { name: "A", estimatedValueCents: 500_000 }, me(t), { qualify: false });
    const hot = await createLead(t.scope, { name: "B" }, me(t), { qualify: false });
    await db.lead.update({ where: { id: hot.id }, data: { temperature: "HOT" } });
    const r = await cmd(ctx, "لخص لي حالة المبيعات");
    expect(r).toMatchObject({ intent: "sales_summary", status: "completed", message: { key: "salesSummary", values: { open: 2, hot: 1 } } });
    expect(r.stats?.find((s) => s.key === "pipelineValue")).toBeTruthy();
  });

  it("4. 'جهز 5 منشورات للأسبوع القادم' queues the content job; status goes Started → Completed with real items", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    const r = await cmd(ctx, "جهز 5 منشورات للأسبوع القادم");
    expect(r).toMatchObject({ intent: "prepare_week_content", status: "queued", message: { key: "started" } });
    expect(r.runId).toBeTruthy();
    const before = await commandStatus(ctx, r.executionId);
    expect(before.status).toBe("queued"); // never "done" before the job is
    await executeRun(t.scope, r.runId!);
    const after = await commandStatus(ctx, r.executionId);
    expect(after).toMatchObject({ status: "completed", message: { key: "contentCreated", values: { count: 5 } } });
    expect(await db.contentItem.count({ where: { organizationId: t.organization.id, status: "PENDING_APPROVAL" } })).toBeGreaterThanOrEqual(0);
    expect(await db.contentItem.count({ where: { organizationId: t.organization.id } })).toBe(5);
    expect(after.stats?.reduce((a, s) => a + Number(s.value), 0)).toBe(5);
  });

  it("partial success: 4 of 5 created is reported as partial, not failure", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    const r = await cmd(ctx, "جهز 5 منشورات للأسبوع القادم");
    await executeRun(t.scope, r.runId!);
    const one = await db.contentItem.findFirstOrThrow({ where: { organizationId: t.organization.id } });
    await db.contentItem.delete({ where: { id: one.id } });
    const after = await commandStatus(ctx, r.executionId);
    expect(after).toMatchObject({ status: "partial", message: { key: "contentPartial", values: { created: 4, requested: 5 } } });
  });

  it("large batch: preview first, nothing starts until confirmed; the cap is stated", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    const r = await cmd(ctx, "جهز 20 منشور");
    expect(r.status).toBe("needs_confirmation");
    expect(r.preview?.map((p) => p.key)).toEqual(expect.arrayContaining(["previewPosts", "previewCapped", "previewApproval"]));
    expect(await db.agentRun.count({ where: { organizationId: t.organization.id } })).toBe(0);
    const go = await replyToCommand(ctx, { executionId: r.executionId, confirm: true });
    expect(go.status).toBe("queued");
    expect(await db.agentRun.count({ where: { organizationId: t.organization.id, kind: "content_plan" } })).toBe(1);
    // A second confirmation (double click) doesn't start a second batch.
    await replyToCommand(ctx, { executionId: r.executionId, confirm: true });
    expect(await db.agentRun.count({ where: { organizationId: t.organization.id, kind: "content_plan" } })).toBe(1);
  });

  it("5. 'افتح الموافقات' navigates", async () => {
    const t = await makeTenant();
    expect(await cmd(ctxFor(t), "افتح الموافقات")).toMatchObject({ intent: "open_approvals", status: "completed", navigation: "/approvals" });
  });

  it("6. unknown command with AI not configured → clear AI-unavailable state (the offline dev provider is not used)", async () => {
    const t = await makeTenant();
    const r = await cmd(ctxFor(t), "اكتب لي قصيدة عن القهوة والمطر في الشتاء");
    expect(r).toMatchObject({ intent: null, type: "unknown", status: "ai_unavailable", message: { key: "aiRequired" }, aiUsed: false });
    expect(await db.aiRun.count({ where: { organizationId: t.organization.id } })).toBe(0);
  });

  it("7. unauthorized: a viewer can read but cannot create; nothing is written", async () => {
    const t = await makeTenant();
    const lead = await createLead(t.scope, { name: "Falcon Group" }, me(t), { qualify: false });
    const viewer = await makeUser();
    await db.organizationMember.create({ data: { organizationId: t.organization.id, userId: viewer.id, role: "VIEWER" } });
    const ctx = ctxFor(t, "VIEWER", viewer);
    const r = await cmd(ctx, "اعمل متابعة لشركة Falcon بكرة");
    expect(r).toMatchObject({ intent: "create_followup", status: "denied", reason: "forbidden" });
    expect(await db.salesActivity.count({ where: { leadId: lead.id } })).toBe(0);
    expect((await cmd(ctx, "لخص المبيعات")).status).toBe("completed");
    expect((await cmd(ctx, "وافق على الكل")).status).toBe("completed"); // nothing pending → nothing to approve
  });

  it("8. cross-tenant: names resolve only inside the tenant; another tenant's execution can't be replied to", async () => {
    const a = await makeTenant("Tenant A");
    const b = await makeTenant("Tenant B");
    await createLead(a.scope, { name: "Falcon Group" }, me(a), { qualify: false });
    await createLead(a.scope, { name: "Falcon Trading" }, me(a), { qualify: false });
    const rb = await cmd(ctxFor(b), "اعمل متابعة لشركة Falcon بكرة");
    expect(rb).toMatchObject({ status: "needs_input", message: { key: "leadNotFound" } });
    expect(await db.salesActivity.count({ where: { organizationId: b.organization.id } })).toBe(0);

    const ra = await cmd(ctxFor(a), "اعمل متابعة لشركة Falcon بكرة");
    expect(ra.status).toBe("needs_choice");
    await expect(replyToCommand(ctxFor(b), { executionId: ra.executionId, choice: 0 })).rejects.toThrow();
    await expect(commandStatus(ctxFor(b), ra.executionId)).rejects.toThrow();
    expect(await db.salesActivity.count({ where: { organizationId: a.organization.id } })).toBe(0);
  });
});

describe("Command Center — entities, actions, approvals", () => {
  it("entity resolution: several matches → choose (server-side candidates), then a real follow-up tomorrow", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    await createLead(t.scope, { name: "Falcon Group" }, me(t), { qualify: false });
    const trading = await createLead(t.scope, { name: "Falcon Trading" }, me(t), { qualify: false });
    const r = await cmd(ctx, "اعمل متابعة لشركة Falcon بكرة");
    expect(r).toMatchObject({ status: "needs_choice", message: { key: "whichLead" } });
    expect(r.choices).toHaveLength(2);
    const idx = r.choices!.findIndex((c) => c.title === "Falcon Trading");
    const done = await replyToCommand(ctx, { executionId: r.executionId, choice: idx });
    expect(done).toMatchObject({ status: "completed", message: { key: "followupCreated" } });
    const act = await db.salesActivity.findFirstOrThrow({ where: { leadId: trading.id } });
    expect(act.dueAt!.getTime()).toBeGreaterThan(Date.now() + 2 * 3_600_000);
    const log = await db.commandExecution.findUniqueOrThrow({ where: { id: r.executionId } });
    expect(log.receipt).toMatchObject({ action: "followup.created", entity: "SalesActivity", entityId: act.id });
    expect(await db.auditLog.count({ where: { organizationId: t.organization.id, action: "command.create_followup", entityId: act.id } })).toBe(1);
    // The response the user sees carries no technical ids.
    expect(JSON.stringify(done)).not.toContain(act.id);
  });

  it("idempotency: the same key twice runs once", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    await createLead(t.scope, { name: "Nour Café" }, me(t), { qualify: false });
    const k = key();
    const first = await executeCommand(ctx, { text: "اعمل متابعة لـNour Café بكرة", locale: "ar", idempotencyKey: k });
    const again = await executeCommand(ctx, { text: "اعمل متابعة لـNour Café بكرة", locale: "ar", idempotencyKey: k });
    expect(again.executionId).toBe(first.executionId);
    expect(await runCommand(ctx, first.executionId)).toMatchObject({ status: "completed" });
    expect(await db.salesActivity.count({ where: { organizationId: t.organization.id } })).toBe(1);
  });

  it("create customer (+ duplicate confirmation) and B2B opportunity", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    expect((await cmd(ctx, "أضف أول عميل")).status).toBe("needs_input");
    const r = await cmd(ctx, "أضف عميل اسمه سارة محمد 0501234567");
    expect(r).toMatchObject({ intent: "create_lead", status: "completed", message: { key: "leadCreated", values: { name: "سارة محمد" } } });
    expect(await db.lead.findFirst({ where: { organizationId: t.organization.id, phone: "0501234567" } })).toBeTruthy();
    const dup = await cmd(ctx, "أضف عميل اسمه سارة محمد");
    expect(dup.status).toBe("needs_confirmation");
    await replyToCommand(ctx, { executionId: dup.executionId, cancel: true });
    expect(await db.lead.count({ where: { organizationId: t.organization.id } })).toBe(1);

    const b2b = await cmd(ctx, "أنشئ فرصة B2B لشركة Atlas Logistics بقيمة 50000");
    expect(b2b).toMatchObject({ intent: "create_b2b_opportunity", status: "completed" });
    const opp = await db.salesOpportunity.findFirstOrThrow({ where: { organizationId: t.organization.id } });
    expect(opp).toMatchObject({ kind: "B2B", valueCents: 5_000_000 });
  });

  it("high-risk: close deal needs confirmation; publish/discount go to approvals; delete is refused", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    const lead = await createLead(t.scope, { name: "Falcon Group" }, me(t), { qualify: false });
    const close = await cmd(ctx, "أغلق صفقة Falcon");
    expect(close).toMatchObject({ intent: "close_deal", status: "needs_confirmation" });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("NEW");
    expect(await replyToCommand(ctx, { executionId: close.executionId, confirm: true })).toMatchObject({ status: "completed", message: { key: "markedWon" } });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("WON");

    const pub = await cmd(ctx, "انشر المحتوى");
    expect(pub).toMatchObject({ status: "needs_approval" });
    expect(await db.socialPublication.count({ where: { organizationId: t.organization.id } })).toBe(0);
    expect((await cmd(ctx, "أرسل خصم 20% لـFalcon")).status).toBe("needs_approval");
    expect((await cmd(ctx, "احذف كل العملاء")).status).toBe("denied");
    expect(await db.lead.count({ where: { organizationId: t.organization.id } })).toBe(1);
    const log = await db.commandExecution.findFirstOrThrow({ where: { organizationId: t.organization.id, intent: "publish_content" } });
    expect(log.approvalRequired).toBe(true);
  });

  it("send message: prepared for approval, never sent directly", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    const lead = await createLead(t.scope, { name: "Nour Café", email: "nour@example.com" }, me(t), { qualify: false });
    const r = await cmd(ctx, "ابعت رسالة لـNour: نشكركم، العرض جاهز للمراجعة");
    expect(r).toMatchObject({ intent: "send_message", status: "needs_approval", message: { key: "messageForApproval" } });
    const m = await db.message.findFirstOrThrow({ where: { organizationId: t.organization.id, conversation: { leadId: lead.id } } });
    expect(m).toMatchObject({ status: "PENDING_APPROVAL", authorType: "USER", body: "نشكركم، العرض جاهز للمراجعة" });
    expect(await db.approval.count({ where: { organizationId: t.organization.id, entityId: m.id, status: "PENDING" } })).toBe(1);
  });

  it("approve all: explicit confirmation with counts; only categories the role may decide", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    const r = await cmd(ctx, "جهز 2 منشورات");
    await executeRun(t.scope, r.runId!);
    const pending = await db.approval.count({ where: { organizationId: t.organization.id, status: "PENDING" } });
    const all = await cmd(ctx, "وافق على الكل");
    if (pending === 0) {
      expect(all.message.key).toBe("noApprovals");
      return;
    }
    expect(all).toMatchObject({ status: "needs_confirmation", message: { key: "confirmApproveAll", values: { count: pending } } });
    expect(await db.approval.count({ where: { organizationId: t.organization.id, status: "PENDING" } })).toBe(pending);
    const done = await replyToCommand(ctx, { executionId: all.executionId, confirm: true });
    expect(done.status).toBe("completed");
    expect(await db.approval.count({ where: { organizationId: t.organization.id, status: "PENDING" } })).toBe(0);
  });

  it("AI-only work says so; secrets are redacted from the log; history and suggestions come from real data", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    expect(await cmd(ctx, "حسن المنشور الأخير")).toMatchObject({ status: "ai_unavailable", reason: "content_ai_not_configured" });
    expect(await cmd(ctx, "اعمل تصميم للبوست")).toMatchObject({ status: "ai_unavailable", reason: "image_not_configured" });

    const r = await cmd(ctx, "افتح الإعدادات password: hunter2 sk-abcdefghijklmnop");
    const log = await db.commandExecution.findUniqueOrThrow({ where: { id: r.executionId } });
    expect(log.text).not.toContain("hunter2");
    expect(log.text).not.toContain("abcdefghijklmnop");

    const s1 = (await commandSuggestions(ctx)).map((s) => s.key);
    expect(s1).toContain("addFirstCustomer");
    expect(s1).not.toContain("reviewOverdue");
    const lead = await createLead(t.scope, { name: "Late Co" }, me(t), { qualify: false });
    await scheduleFollowUp(t.scope, lead.id, { title: "Call", dueAt: new Date(Date.now() - 3 * 86_400_000) });
    const s2 = (await commandSuggestions(ctx)).map((s) => s.key);
    expect(s2).toContain("reviewOverdue");
    expect(s2).not.toContain("addFirstCustomer");

    await cmd(ctx, "افتح الموافقات");
    await cmd(ctx, "افتح الموافقات");
    const h = await commandHistory(ctx);
    expect(h[0].text).toBe("افتح الموافقات");
    expect(h.filter((x) => x.text === "افتح الموافقات")).toHaveLength(1);
  });

  it("understand + run are separate steps; running twice executes once", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    await createLead(t.scope, { name: "Nour Café" }, me(t), { qualify: false });
    const u = await understandCommand(ctx, { text: "اعمل متابعة لـNour Café بكرة", locale: "ar", idempotencyKey: key() });
    expect(u).toMatchObject({ status: "understood", intent: "create_followup" });
    await Promise.all([runCommand(ctx, u.executionId), runCommand(ctx, u.executionId)]);
    expect(await db.salesActivity.count({ where: { organizationId: t.organization.id } })).toBe(1);
  });
});
