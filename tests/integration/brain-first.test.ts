import { describe, expect, it } from "vitest";
import "@/server/agents/jobs";
import { db } from "@/server/db/client";
import { tenantDb } from "@/server/db/tenant";
import { can } from "@/server/rbac";
import type { TenantContext } from "@/server/context";
import type { KnowledgeSourceType } from "@/generated/prisma/enums";
import { executeRun } from "@/server/agents/runtime";
import { aiStructured } from "@/server/ai";
import { withCommandAttribution } from "@/server/ai/attribution";
import { createLead } from "@/server/sales/service";
import { commandStatus, executeCommand, planExecution } from "@/server/command/service";
import { intentDef, INTENTS, NO_AI_INTENTS } from "@/server/command/registry";
import { brainVersion, compactContext, dedupeChunks, estimateTokens, retrieveCompanyContext, stripBoilerplate, TOKEN_BUDGETS } from "@/server/knowledge/company-context";
import { z } from "zod";
import { makeTenant } from "../support/factory";

/** Company-Brain-first Command Center: local → brain → AI; selective context; budgets; cache; isolation. */
type Tenant = Awaited<ReturnType<typeof makeTenant>>;
function ctxFor(t: Tenant): TenantContext {
  return {
    user: { id: t.user.id, email: t.user.email, name: t.user.name, locale: "en", isPlatformAdmin: false, emailVerifiedAt: new Date() },
    sessionId: "s",
    organization: { id: t.organization.id, name: t.organization.name, slug: t.organization.slug, onboardingStatus: "COMPLETED", timezone: "UTC", locale: "ar", isDemo: false },
    workspace: { id: t.workspace.id, name: "W" },
    role: "OWNER",
    db: tenantDb(t.scope),
    can: (p) => can("OWNER", p),
  } as TenantContext;
}
const me = (t: Tenant) => ({ type: "USER" as const, id: t.user.id, label: "Owner" });
let n = 0;
const cmd = (ctx: TenantContext, text: string) => executeCommand(ctx, { text, locale: "ar", idempotencyKey: `b-${Date.now()}-${n++}` });
const aiCalls = (t: Tenant) => db.aiRun.count({ where: { organizationId: t.organization.id } });

async function seedBrain(t: Tenant) {
  await db.companyProfile.update({
    where: { workspaceId: t.workspace.id },
    data: { name: "DMS", industry: "Digital agency", summary: "DMS builds websites and runs digital marketing for SMEs in KSA.", audience: [{ name: "SMEs in KSA", description: "Owners who need leads online" }], valueProps: ["Fast delivery", "Arabic-first design"], contentPillars: ["Education", "Case studies"] },
  });
  await db.brandKit.update({ where: { workspaceId: t.workspace.id }, data: { tone: "professional, direct", voiceTraits: ["clear"], dontSay: ["guaranteed #1 on Google"] } });
  await db.offering.createMany({
    data: [
      { ...t.scope, type: "SERVICE", name: "Web development", description: "Company websites and landing pages", priceText: "from 8,000 SAR" },
      { ...t.scope, type: "SERVICE", name: "Digital marketing", description: "Ads and social media management" },
    ],
  });
}

async function addKnowledge(t: Tenant, type: KnowledgeSourceType, chunks: string[], title = "Knowledge") {
  const source = await db.knowledgeSource.create({ data: { ...t.scope, type, title, status: "READY" } });
  const doc = await db.knowledgeDocument.create({ data: { ...t.scope, sourceId: source.id, title, content: chunks.join("\n"), contentHash: `${source.id}-h` } });
  await db.knowledgeChunk.createMany({ data: chunks.map((content, index) => ({ ...t.scope, documentId: doc.id, sourceId: source.id, index, content, tokenCount: Math.ceil(content.length / 4), metadata: { title, sourceType: type } })) });
  return { source, doc };
}

describe("routing: local and brain commands make zero AI calls", () => {
  it("local: counts, pipeline value, stage moves, navigation — no AI", async () => {
    const t = await makeTenant("Local Co");
    const ctx = ctxFor(t);
    const lead = await createLead(t.scope, { name: "Falcon Group", estimatedValueCents: 1_000_000 }, me(t), { qualify: false });
    const open = await cmd(ctx, "كم صفقة مفتوحة؟");
    expect(open).toMatchObject({ intent: "sales_summary", mode: "local", status: "completed" });
    const value = await cmd(ctx, "كم قيمة الـPipeline؟");
    expect(value).toMatchObject({ intent: "pipeline_value", mode: "local", status: "completed", message: { key: "pipelineValue" } });
    const moved = await cmd(ctx, "انقل Falcon لمرحلة التفاوض");
    expect(moved).toMatchObject({ intent: "move_stage", mode: "local", status: "completed", message: { key: "stageMoved", values: { stage: "NEGOTIATION" } } });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("NEGOTIATION");
    expect(await cmd(ctx, "افتح المبيعات")).toMatchObject({ mode: "local", navigation: "/sales" });
    expect(await cmd(ctx, "من العملاء المتأخرين؟")).toMatchObject({ intent: "overdue_followups", mode: "local" });
    expect(await cmd(ctx, "إيه مواعيدي بكرة؟")).toMatchObject({ intent: "calendar_lookup", mode: "local" });
    expect(await cmd(ctx, "إيه حالة الحسابات المربوطة؟")).toMatchObject({ intent: "integrations_status", mode: "local" });
    expect(await cmd(ctx, "إيه آخر نشاط مع Falcon")).toMatchObject({ intent: "lead_activity", mode: "local", status: "completed" });
    expect(await aiCalls(t)).toBe(0);
    const logs = await db.commandExecution.findMany({ where: { organizationId: t.organization.id } });
    expect(logs.every((l) => l.mode === "local" && !l.aiUsed && (l.inputTokens ?? 0) === 0)).toBe(true);
  });

  it("brain: 'ما الخدمات التي نقدمها؟' answers from the Company Brain — formatted, sourced, no AI", async () => {
    const t = await makeTenant("DMS");
    await seedBrain(t);
    const r = await cmd(ctxFor(t), "ما الخدمات التي نقدمها؟");
    expect(r).toMatchObject({ intent: "brain_services", mode: "brain", status: "completed", message: { key: "brainFound", values: { topic: "brain_services" } } });
    expect(r.items?.map((i) => i.title)).toEqual(["Web development", "Digital marketing"]);
    expect(r.items?.[0].badge).toBe("from 8,000 SAR");
    expect(r.sources).toBeGreaterThan(0);
    expect(await aiCalls(t)).toBe(0);
    for (const q of ["ما الجمهور المستهدف؟", "ما مميزات الشركة؟", "ما سياسة الأسعار؟", "ما نبرة العلامة؟"]) {
      const a = await cmd(ctxFor(t), q);
      expect(a.mode, q).toBe("brain");
      expect(a.status, q).toBe("completed");
    }
    expect(await aiCalls(t)).toBe(0);
  });

  it("brain doesn't invent: missing topic → says so and points to the Company Brain", async () => {
    const t = await makeTenant("Empty Co");
    const r = await cmd(ctxFor(t), "ما المنتجات؟");
    expect(r).toMatchObject({ intent: "brain_products", mode: "brain", status: "needs_input", message: { key: "brainMissing" } });
    expect(r.items ?? []).toHaveLength(0);
  });

  it("brain questions: high confidence → extractive answer; medium → best facts + ask; low + no AI → AI unavailable", async () => {
    const t = await makeTenant("FAQ Co");
    await addKnowledge(t, "FAQ", ["Our working hours are Sunday to Thursday from 9am to 5pm at the Riyadh office.", "Delivery of a company website usually takes four weeks after the kickoff meeting."], "FAQ");
    const hi = await cmd(ctxFor(t), "What are your working hours?");
    expect(hi).toMatchObject({ intent: "brain_question", mode: "brain", status: "completed", message: { key: "brainAnswer" } });
    expect(hi.text).toContain("9am to 5pm");
    const mid = await cmd(ctxFor(t), "How long does delivery of mobile apps take in Jeddah?");
    expect(mid).toMatchObject({ intent: "brain_question", status: "needs_input", message: { key: "brainPartial" } });
    const low = await cmd(ctxFor(t), "هل عندكم فرع في القاهرة؟");
    expect(low).toMatchObject({ intent: "brain_question", status: "ai_unavailable", message: { key: "aiRequired" } });
    expect(await aiCalls(t)).toBe(0);
  });
});

describe("cache by brain version", () => {
  it("second identical brain answer is cached; editing the brain invalidates it", async () => {
    const t = await makeTenant("Cache Co");
    await seedBrain(t);
    const ctx = ctxFor(t);
    const v1 = await brainVersion(t.scope);
    const first = await cmd(ctx, "ما الخدمات التي نقدمها؟");
    const second = await cmd(ctx, "اي الخدمات بتاعتنا؟");
    expect(second.items).toEqual(first.items);
    expect((await db.commandExecution.findUniqueOrThrow({ where: { id: first.executionId } })).cacheHit).toBe(false);
    expect((await db.commandExecution.findUniqueOrThrow({ where: { id: second.executionId } })).cacheHit).toBe(true);

    await db.offering.create({ data: { ...t.scope, type: "SERVICE", name: "Mobile apps" } });
    expect(await brainVersion(t.scope)).not.toBe(v1);
    const third = await cmd(ctx, "ما الخدمات التي نقدمها؟");
    expect((await db.commandExecution.findUniqueOrThrow({ where: { id: third.executionId } })).cacheHit).toBe(false);
    expect(third.items?.map((i) => i.title)).toContain("Mobile apps");

    // Knowledge changes also move the version.
    const v2 = await brainVersion(t.scope);
    await addKnowledge(t, "FAQ", ["We answer support tickets within one business day, every day."]);
    expect(await brainVersion(t.scope)).not.toBe(v2);
  });

  it("customer-specific and time-sensitive answers are never cached", async () => {
    const t = await makeTenant("NoCache Co");
    const ctx = ctxFor(t);
    await cmd(ctx, "من العملاء اللي محتاجين متابعة اليوم؟");
    await cmd(ctx, "من العملاء اللي محتاجين متابعة اليوم؟");
    expect(await db.commandCache.count({ where: { organizationId: t.organization.id } })).toBe(0);
  });
});

describe("retrieveCompanyContext: selective, bounded, clean, isolated", () => {
  it("sales context excludes content rules; content context excludes CRM data and sales rules", async () => {
    const t = await makeTenant("Sel Co");
    await seedBrain(t);
    await createLead(t.scope, { name: "SecretCustomerX", email: "x@secret.test", message: "our budget is 90k" }, me(t), { qualify: false });
    const sales = await retrieveCompanyContext(t.scope, { purpose: "sales" });
    const content = await retrieveCompanyContext(t.scope, { purpose: "content", query: "web development" });
    const s = compactContext(sales);
    const c = compactContext(content);
    expect(s).toContain("Sales rules");
    expect(s).toContain("discount");
    expect(s).not.toContain("Content pillars");
    expect(s).not.toContain("guaranteed #1");
    expect(c).toContain("Brand voice");
    expect(c).toContain("guaranteed #1"); // forbidden claims are content rules
    expect(c).not.toContain("Sales rules");
    for (const text of [s, c]) {
      expect(text).not.toContain("SecretCustomerX");
      expect(text).not.toContain("90k");
    }
  });

  it("top-K and token budget are enforced; duplicates and boilerplate are removed; secrets redacted", async () => {
    const t = await makeTenant("Budget Co");
    await seedBrain(t);
    const long = (i: number) => `Web development package ${i}: we design responsive websites with Arabic and English content, SEO basics and analytics. ${"Details about hosting, domains and training. ".repeat(12)}`;
    await addKnowledge(t, "SERVICE", Array.from({ length: 20 }, (_, i) => long(i)), "Services");
    const small = await retrieveCompanyContext(t.scope, { purpose: "content", query: "web development websites" });
    expect(small.chunks.length).toBeLessThanOrEqual(3);
    expect(small.contextTokens).toBeLessThanOrEqual(TOKEN_BUDGETS.small);
    const big = await retrieveCompanyContext(t.scope, { purpose: "content", query: "web development websites", budget: "large", topK: 50 });
    expect(big.chunks.length).toBeLessThanOrEqual(8);
    expect(big.contextTokens).toBeLessThanOrEqual(TOKEN_BUDGETS.large);

    const d = dedupeChunks([
      { text: "Our websites are built with Next.js and delivered in four weeks.", score: 0.9, documentId: "a", index: 0 },
      { text: "Our websites are built with Next.js and delivered in four weeks.", score: 0.5, documentId: "b", index: 0 },
      { text: "Pricing starts at 8,000 SAR for a landing page with two languages.", score: 0.7, documentId: "c", index: 0 },
      { text: "for a landing page with two languages. Hosting is included for a year.", score: 0.6, documentId: "c", index: 1 },
    ]);
    expect(d).toHaveLength(2);
    expect(d.find((x) => x.documentId === "c")?.text).toBe("Pricing starts at 8,000 SAR for a landing page with two languages. Hosting is included for a year.");
    expect(stripBoilerplate("Home | About | Contact\nWe build websites for SMEs across Saudi Arabia.\n© 2026 All rights reserved")).toBe("We build websites for SMEs across Saudi Arabia.");

    await addKnowledge(t, "FAQ", ["Admin login for the old portal: password: hunter2secret (web development team only)."], "Internal");
    const faq = await retrieveCompanyContext(t.scope, { purpose: "support", query: "web development portal login" });
    expect(compactContext(faq)).not.toContain("hunter2secret");
    expect(estimateTokens("مرحبا بكم")).toBeGreaterThan(estimateTokens("hello all"));
  });

  it("tenant isolation: another tenant's brain is never retrieved or answered from", async () => {
    const a = await makeTenant("Tenant A");
    const b = await makeTenant("Tenant B");
    await seedBrain(a);
    await addKnowledge(a, "FAQ", ["Tenant A secret discount code is ALPHA-2026 for web development clients."]);
    const ctxB = await retrieveCompanyContext(b.scope, { purpose: "support", query: "discount code web development" });
    expect(ctxB.chunks).toHaveLength(0);
    expect(compactContext(ctxB)).not.toContain("ALPHA-2026");
    const r = await cmd(ctxFor(b), "ما الخدمات التي نقدمها؟");
    expect(r.status).toBe("needs_input");
    expect(JSON.stringify(r)).not.toContain("Web development");
  });
});

describe("brain + AI: plan, budget, attribution", () => {
  it("execution plan is decided before execution and stored", async () => {
    expect(planExecution(intentDef("prepare_week_content")!)).toMatchObject({ mode: "brain_ai", tokenBudget: 1000, requiredBrainSections: expect.arrayContaining(["brandVoice", "services", "audience", "forbidden"]) });
    expect(planExecution(intentDef("draft_sales_message")!)).toMatchObject({ mode: "brain_ai", maxOutputTokens: 400, requiredBrainSections: expect.arrayContaining(["salesRules", "pricing"]) });
    expect(planExecution(intentDef("open_sales")!)).toMatchObject({ mode: "local", tokenBudget: 0, maxOutputTokens: 0 });
    // Explicit no-AI allowlist: every navigation / read / lookup / stage update.
    for (const k of ["open_sales", "sales_summary", "pipeline_value", "followups_today", "calendar_lookup", "approvals_summary", "open_entity", "move_stage", "lead_activity", "integrations_status", "brain_services"]) expect(NO_AI_INTENTS).toContain(k);
    for (const i of INTENTS) if (i.mode === "brain_ai") expect(i.brain, i.key).toBeTruthy();

    const t = await makeTenant("Plan Co");
    const r = await cmd(ctxFor(t), "اعمل بوست عن خدمات البرمجة");
    expect(r).toMatchObject({ intent: "prepare_week_content", mode: "brain_ai" });
    const log = await db.commandExecution.findUniqueOrThrow({ where: { id: r.executionId } });
    expect(log.routing).toMatchObject({ mode: "brain_ai", tokenBudget: 1000 });
  });

  it("'جهز رسالة متابعة لشركة Falcon' drafts for that one customer (brain + AI job); tokens are attributed to the command", async () => {
    const t = await makeTenant("Draft Co");
    await seedBrain(t);
    const ctx = ctxFor(t);
    await createLead(t.scope, { name: "Falcon Group" }, me(t), { qualify: false });
    await createLead(t.scope, { name: "Other Customer" }, me(t), { qualify: false });
    const r = await cmd(ctx, "جهز رسالة متابعة لشركة Falcon");
    expect(r).toMatchObject({ intent: "draft_sales_message", mode: "brain_ai", status: "queued" });
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: r.runId! } });
    expect((run.result as { params: { leadIds: string[] } }).params.leadIds).toHaveLength(1);
    await executeRun(t.scope, r.runId!);
    const done = await commandStatus(ctx, r.executionId);
    expect(done.status).toMatch(/completed|needs_approval/);
    expect(done.mode).toBe("brain_ai");
    const log = await db.commandExecution.findUniqueOrThrow({ where: { id: r.executionId } });
    expect(log.contextTokens).toBeGreaterThan(0); // the job's selective brain context is logged…
    expect(log.contextTokens!).toBeLessThanOrEqual(TOKEN_BUDGETS.small); // …and stayed inside the small budget
    const messages = await db.message.findMany({ where: { organizationId: t.organization.id } });
    expect(messages).toHaveLength(1); // only Falcon — nobody else was drafted
  });

  it("AI calls made inside a command are tagged with it", async () => {
    const t = await makeTenant("Attr Co");
    await withCommandAttribution("cmd-test-123", () =>
      aiStructured({ organizationId: t.organization.id, workspaceId: t.workspace.id }, { task: "CLASSIFICATION", schemaName: "x", schema: z.object({ ok: z.boolean() }), prompt: "x", offline: () => ({ ok: true }) }),
    );
    const runs = await db.aiRun.findMany({ where: { organizationId: t.organization.id } });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => r.commandExecutionId === "cmd-test-123")).toBe(true);
  });

  it("OpenAI off: generation says so clearly; local and brain still work", async () => {
    const t = await makeTenant("Off Co");
    await seedBrain(t);
    const ctx = ctxFor(t);
    expect(await cmd(ctx, "حسن المنشور الأخير")).toMatchObject({ status: "ai_unavailable", message: { key: "aiGenerationRequired" }, mode: "brain_ai" });
    expect(await cmd(ctx, "اكتب لي قصيدة عن القهوة والمطر في الشتاء")).toMatchObject({ status: "ai_unavailable", message: { key: "aiRequired" } });
    expect(await cmd(ctx, "ما الخدمات التي نقدمها؟")).toMatchObject({ status: "completed", mode: "brain" });
    expect(await cmd(ctx, "افتح المبيعات")).toMatchObject({ status: "completed", mode: "local" });
  });
});
