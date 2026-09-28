import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { tenantDb } from "@/server/db/tenant";
import { can } from "@/server/rbac";
import type { TenantContext } from "@/server/context";
import { makeTenant } from "../support/factory";
import { createLead, moveLeadStage, scheduleFollowUp } from "@/server/sales/service";
import { deskSummary, leadDrawer, leadWhere, resolveSearch, loadActivity, loadConversations, loadFollowUps, loadForecast, loadHotLeads, loadPipeline } from "@/server/sales/desk";
import { completeFollowUp, createOpportunity, createQuote, importLeads, previewImport, quoteNeedsApproval, runSalesCycle, sendQuote, setFollowUpPaused, snoozeFollowUp } from "@/server/sales/operations";
import { decideApproval } from "@/server/approvals/service";
import { UserFacingError } from "@/server/errors";

/** Sales Desk: every number from the DB, every action real, tenant-isolated. */
type Tenant = Awaited<ReturnType<typeof makeTenant>>;
function ctxFor(t: Tenant): TenantContext {
  return {
    user: { id: t.user.id, email: t.user.email, name: t.user.name, locale: "en", isPlatformAdmin: false, emailVerifiedAt: new Date() },
    sessionId: "s",
    organization: { id: t.organization.id, name: t.organization.name, slug: t.organization.slug, onboardingStatus: "COMPLETED", timezone: "UTC", locale: "en", isDemo: false },
    workspace: { id: t.workspace.id, name: "W" },
    role: "OWNER",
    db: tenantDb(t.scope),
    can: (p) => can("OWNER", p),
  } as TenantContext;
}
const me = (t: Tenant) => ({ type: "USER" as const, id: t.user.id, label: "Owner" });
const DAY = 86_400_000;

describe("Sales Desk — leads, opportunities, pipeline", () => {
  it("empty workspace shows Getting started; numbers stay unknown instead of 0", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    const s = await deskSummary(ctx, {});
    expect(s.gettingStarted.show).toBe(true);
    expect(s.hero).toEqual({ customers: 0, openOpportunities: 0, overdue: 0 });
    const f = await loadForecast(ctx, {});
    expect(f).toMatchObject({ pipeline: null, weighted: null, won: null });
    expect(s.channels.find((c) => c.key === "crm")?.state).toBe("connected");
    expect(s.channels.find((c) => c.key === "whatsapp")?.state).toBe("not_configured");
  });

  it("add lead → opportunity → move stages (timeline) → won; forecast from real values only", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    const lead = await createLead(t.scope, { name: "Falcon Group", company: "Falcon", email: "cfo@falcon.test" }, me(t), { qualify: false });
    const opp = await createOpportunity(t.scope, { leadId: lead.id, title: "ERP Implementation", value: 45000, currency: "SAR", kind: "DEAL", nextStep: "Send the proposal" }, me(t));
    expect(opp.valueCents).toBe(4_500_000);
    await moveLeadStage(t.scope, lead.id, "QUALIFIED", me(t));
    await moveLeadStage(t.scope, lead.id, "PROPOSAL", me(t));

    const pipe = await loadPipeline(ctx, {});
    const proposal = pipe.columns.find((c) => c.stage === "PROPOSAL")!;
    expect(proposal.count).toBe(1);
    expect(proposal.cards[0]).toMatchObject({ name: "Falcon Group", title: "ERP Implementation", value: { cents: 4_500_000, currency: "SAR" }, nextAction: "Send the proposal" });

    // Weighted = 45,000 × 55% (PROPOSAL probability from pipeline_stages).
    await db.lead.update({ where: { id: lead.id }, data: { currency: "SAR" } });
    const f = await loadForecast(ctx, {});
    expect(f.pipeline).toEqual({ cents: 4_500_000, currency: "SAR" });
    expect(f.weighted).toEqual({ cents: Math.round(4_500_000 * 0.55), currency: "SAR" });
    expect(f.won).toBeNull();

    await moveLeadStage(t.scope, lead.id, "WON", me(t));
    expect((await db.salesOpportunity.findUniqueOrThrow({ where: { id: opp.id } })).status).toBe("WON");
    const f2 = await loadForecast(ctx, {});
    expect(f2.won).toEqual({ cents: 4_500_000, currency: "SAR" });
    expect(f2.pipeline).toBeNull();

    const log = await loadActivity(ctx, {}, 1, true);
    expect(log.items.filter((e) => e.type === "STATUS_CHANGE").map((e) => `${e.from}→${e.to}`)).toEqual(["PROPOSAL→WON", "QUALIFIED→PROPOSAL", "NEW→QUALIFIED"]);
    expect(log.items.find((e) => e.type === "OPPORTUNITY")?.valueChange).toEqual({ from: null, to: 4_500_000, currency: "SAR" });
    const s = await deskSummary(ctx, {});
    expect(s.kpis).toMatchObject({ won: 1, lost: 0 });
  });

  it("B2B opportunity creates the company customer; an unknown value stays unknown", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    const opp = await createOpportunity(t.scope, { kind: "B2B", company: "Nile Logistics", contactName: "Hany", industry: "Logistics", need: "Fleet tracking", title: "Fleet tracking rollout", decisionMaker: "COO", stage: "QUALIFIED" }, me(t));
    expect(opp).toMatchObject({ kind: "B2B", valueCents: null, industry: "Logistics", decisionMaker: "COO" });
    const lead = await db.lead.findUniqueOrThrow({ where: { id: opp.leadId } });
    expect(lead).toMatchObject({ name: "Hany", company: "Nile Logistics", stage: "QUALIFIED" });
    const col = (await loadPipeline(ctx, {})).columns.find((c) => c.stage === "QUALIFIED")!;
    expect(col.cards[0].value).toBeNull();
    expect(col.value).toBeNull();
    expect((await loadForecast(ctx, {})).pipeline).toBeNull();
    await expect(createOpportunity(t.scope, { kind: "B2B", title: "No company" }, me(t))).rejects.toBeInstanceOf(UserFacingError);
  });
});

describe("Sales Desk — follow-ups", () => {
  it("overdue / today / paused / done tabs with the reason, snooze and complete", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    const lead = await createLead(t.scope, { name: "Omar", email: "o@x.test" }, me(t), { qualify: false });
    const late = await scheduleFollowUp(t.scope, lead.id, { title: "Call back", dueAt: new Date(Date.now() - 2 * DAY), createdById: t.user.id });
    const paused = await scheduleFollowUp(t.scope, lead.id, { title: "Later", dueAt: new Date(Date.now() + 3 * DAY), createdById: t.user.id });
    await setFollowUpPaused(t.scope, paused.id, true, me(t));
    let f = await loadFollowUps(ctx, {}, "overdue");
    expect(f.counts).toMatchObject({ overdue: 1, paused: 1, done: 0 });
    expect(f.items[0].signals[0]).toMatchObject({ kind: "followup_overdue", days: 2 });
    expect((await deskSummary(ctx, {})).hero.overdue).toBe(1);

    await snoozeFollowUp(t.scope, late.id, new Date(Date.now() + DAY), me(t));
    f = await loadFollowUps(ctx, {}, "overdue");
    expect(f.counts.overdue).toBe(0);
    await completeFollowUp(t.scope, late.id, me(t));
    f = await loadFollowUps(ctx, {}, "done");
    expect(f.items.map((i) => i.title)).toEqual(["Call back"]);
  });

  it("the NOVA sales cycle creates follow-up tasks (never messages) and is idempotent", async () => {
    const t = await makeTenant();
    const hot = await createLead(t.scope, { name: "Hot one", email: "h@x.test" }, me(t), { qualify: false });
    await db.lead.update({ where: { id: hot.id }, data: { temperature: "HOT" } });
    const r = await runSalesCycle(t.scope, me(t));
    expect(r).toMatchObject({ analyzed: 1, followUpsCreated: 1, hot: 1 });
    expect(r.recommendations[0]).toMatchObject({ leadId: hot.id, signal: { kind: "hot_no_next_step" } });
    expect(await db.message.count({ where: t.scope })).toBe(0);
    const again = await runSalesCycle(t.scope, me(t));
    expect(again.followUpsCreated).toBe(0);
  });
});

describe("Sales Desk — hot leads, conversations, filters", () => {
  it("hot leads show a level with explicit reasons; conversations show preview and reply state", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    const lead = await createLead(t.scope, { name: "Sara", email: "sara@acme-corp.test", message: "We need a quote urgently this week, what's the price?" }, me(t), { qualify: false });
    await db.lead.update({ where: { id: lead.id }, data: { temperature: "HOT" } });
    const [hot] = await loadHotLeads(ctx, {});
    expect(hot.reasons).toEqual(expect.arrayContaining(["recent_reply", "buying_intent", "urgency", "business_email"]));
    expect(hot.signals.map((s) => s.kind)).toContain("hot_no_next_step");
    const conv = await loadConversations(ctx, {});
    expect(conv.items[0]).toMatchObject({ unread: true, lead: { id: lead.id }, preview: expect.stringContaining("quote") });
  });

  it("filters and search apply server-side", async () => {
    const t = await makeTenant();
    const ctx = ctxFor(t);
    await createLead(t.scope, { name: "Alpha", company: "Acme", source: "LinkedIn" }, me(t), { qualify: false });
    await createLead(t.scope, { name: "Beta", phone: "+20 100 555 1234", source: "Website" }, me(t), { qualify: false });
    const count = async (f: Parameters<typeof leadWhere>[0]) => ctx.db.lead.count({ where: leadWhere(await resolveSearch(ctx, f), t.user.id) });
    expect(await count({ q: "acme" })).toBe(1);
    expect(await count({ q: "1005551234" })).toBe(1);
    expect(await count({ source: "linked" })).toBe(1);
    expect(await count({ owner: "me" })).toBe(0);
    expect(await count({ period: "7d" })).toBe(2);
  });
});

describe("Sales Desk — quotes & approvals", () => {
  it("a discounted quote needs approval, can't be sent until approved, then is sent and moves the stage", async () => {
    const t = await makeTenant();
    const lead = await createLead(t.scope, { name: "Mona", email: "m@x.test" }, me(t), { qualify: false });
    const q = await createQuote(t.scope, { leadId: lead.id, title: "Website package", items: [{ description: "Design", quantity: 1, unitPrice: 1000 }, { description: "Hosting", quantity: 12, unitPrice: 20 }], discount: 100, taxPercent: 10 }, me(t));
    expect(q).toMatchObject({ status: "NEEDS_APPROVAL", subtotalCents: 124_000, discountCents: 10_000, taxCents: 11_400, totalCents: 125_400 });
    const approval = await db.approval.findFirstOrThrow({ where: { entityType: "Quote", entityId: q.id } });
    expect(approval).toMatchObject({ category: "PRICING", action: "discount", status: "PENDING" });
    await expect(sendQuote(t.scope, q.id, me(t), { manual: true })).rejects.toMatchObject({ code: "requires_approval" });

    await decideApproval(t.scope, approval.id, "APPROVED", { userId: t.user.id, label: "Owner" });
    const approved = await db.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(approved).toMatchObject({ status: "DRAFT", approvedById: t.user.id });
    await sendQuote(t.scope, q.id, me(t), { manual: true });
    expect(await db.quote.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({ status: "SENT", sentVia: "manual" });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("PROPOSAL");
    expect((await deskSummary(ctxFor(t), {})).kpis.quotesSent).toBe(1);
  });

  it("a plain quote by a human needs no approval; anything the AI drafts does", async () => {
    expect(quoteNeedsApproval({ createdByAgent: false, discountCents: 0, terms: null })).toBe(false);
    expect(quoteNeedsApproval({ createdByAgent: true, discountCents: 0, terms: null })).toBe(true);
    expect(quoteNeedsApproval({ createdByAgent: false, discountCents: 0, terms: "Net 90" })).toBe(true);
  });
});

describe("Sales Desk — import & tenant isolation", () => {
  it("CSV import previews duplicates/invalid rows and imports only the good ones", async () => {
    const t = await makeTenant();
    await createLead(t.scope, { name: "Existing", email: "exists@x.test" }, me(t), { qualify: false });
    const rows = [
      { name: "New One", email: "new@x.test", value: "1,500" },
      { name: "Dup", email: "EXISTS@x.test" },
      { name: "In file", email: "new@x.test" },
      { email: "not-an-email" },
      { company: "Only company" },
    ];
    const p = await previewImport(t.scope, rows);
    expect(p.map((r) => r.status)).toEqual(["ok", "duplicate", "duplicate", "invalid", "ok"]);
    const res = await importLeads(t.scope, rows, me(t));
    expect(res).toMatchObject({ created: 2, skipped: 3 });
    const imported = await db.lead.findFirstOrThrow({ where: { ...t.scope, email: "new@x.test" } });
    expect(imported.estimatedValueCents).toBe(150_000);
    expect(await db.leadEvent.count({ where: { leadId: imported.id, type: "IMPORTED" } })).toBe(1);
  });

  it("another workspace can't read or write this workspace's customers", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const lead = await createLead(a.scope, { name: "Private", email: "p@x.test" }, me(a), { qualify: false });
    expect(await leadDrawer(ctxFor(b), lead.id)).toBeNull();
    await expect(createOpportunity(b.scope, { leadId: lead.id, title: "steal", kind: "DEAL" }, me(b))).rejects.toBeInstanceOf(UserFacingError);
    await expect(createQuote(b.scope, { leadId: lead.id, title: "x", items: [{ description: "x", quantity: 1, unitPrice: 1 }] }, me(b))).rejects.toBeInstanceOf(UserFacingError);
    // Regression: follow-ups used to be attachable to another tenant's lead.
    await expect(scheduleFollowUp(b.scope, lead.id, { title: "x", dueAt: new Date() })).rejects.toBeInstanceOf(UserFacingError);
    expect(await db.salesActivity.count({ where: { leadId: lead.id } })).toBe(0);
    expect((await loadPipeline(ctxFor(b), {})).columns.every((c) => c.count === 0)).toBe(true);
  });
});
