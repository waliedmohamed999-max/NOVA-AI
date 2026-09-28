import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import "@/server/agents/jobs";
import { db } from "@/server/db/client";
import { tenantDb } from "@/server/db/tenant";
import { can } from "@/server/rbac";
import type { TenantContext } from "@/server/context";
import { createLead } from "@/server/sales/service";
import { saveEntity, upsertFact } from "@/server/brain/core";
import { generateDailyBrief, generateWeeklyReport } from "@/server/reports/service";
import { compactContext, estimateTokens } from "@/server/knowledge/company-context";
import { analyticsContext, briefContext, contentContext, salesContext, USE_CASE_BUDGETS } from "@/server/knowledge/use-cases";
import { executeCommand } from "@/server/command/service";
import { makeTenant } from "../support/factory";

/** Company Brain context hardening: every AI use case gets only its sections, within its budget, audited. */
type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const actor = (t: Tenant) => ({ userId: t.user.id });
const me = (t: Tenant) => ({ type: "USER" as const, id: t.user.id, label: "Owner" });
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

/** A brain with plenty of everything, so "selective" is measurable. Distinct markers per data kind. */
async function seed(t: Tenant) {
  await db.companyProfile.update({ where: { workspaceId: t.workspace.id }, data: { industry: "Skincare", summary: "Clinic-grade skincare for dry and sensitive skin.", contentPillars: ["Education"], valueProps: ["Dermatologist-made"] } });
  await db.brandKit.update({ where: { workspaceId: t.workspace.id }, data: { tone: "warm, expert", forbiddenClaims: ["cures acne"] } });
  await db.offering.createMany({
    data: [
      { ...t.scope, type: "PRODUCT", name: "Barrier Serum", category: "Serums", description: "Repairs the skin barrier overnight", priceText: "AED 180" },
      { ...t.scope, type: "PRODUCT", name: "Gentle Cleanser", category: "Cleansers", description: "Low-pH daily wash", priceText: "AED 95" },
      ...Array.from({ length: 12 }, (_, i) => ({ ...t.scope, type: "SERVICE" as const, name: `CatalogueService${i}`, description: `Long description ${"x".repeat(150)}`, priceText: `AED ${100 + i}` })),
    ],
  });
  for (let i = 0; i < 10; i++) await saveEntity(t.scope, "faq", { data: { question: `FAQSECRET question ${i}?`, answer: `FAQSECRET answer ${i}` } }, actor(t));
  await saveEntity(t.scope, "objection", { data: { objection: "The serum is expensive", response: "One bottle lasts three months." } }, actor(t));
  await upsertFact(t.scope, { key: "pricing.discount_policy", value: "No discounts above 10%", category: "discount", sourceKind: "manual" }, actor(t));
  const src = await db.knowledgeSource.create({ data: { ...t.scope, type: "DOCUMENT", title: "Handbook", status: "READY", lastSyncedAt: new Date() } });
  const doc = await db.knowledgeDocument.create({ data: { ...t.scope, sourceId: src.id, title: "Handbook", content: "x", contentHash: "h" } });
  await db.knowledgeChunk.create({ data: { ...t.scope, documentId: doc.id, sourceId: src.id, index: 0, content: "CHUNKSECRET internal handbook text about serum routines and skincare steps.", tokenCount: 20 } });
  await createLead(t.scope, { name: "CrmPersonX", email: "crm.person@secret.test", phone: "0501112233" }, me(t), { qualify: false });
  await db.contentItem.create({ data: { ...t.scope, platform: "INSTAGRAM", title: "ContentHistoryX old post", caption: "ContentHistoryX caption", status: "PUBLISHED" } });
}

describe("per-use-case context: only the needed sections, within budget", () => {
  it("daily brief doesn't load the whole brain (no FAQs, catalogue, chunks or CRM) and logs its context", async () => {
    const t = await makeTenant("Brief");
    await seed(t);
    const ctx = await briefContext(t.scope);
    const text = compactContext(ctx);
    for (const marker of ["FAQSECRET", "CatalogueService", "Barrier Serum", "CHUNKSECRET", "CrmPersonX", "ContentHistoryX", "No discounts"]) expect(text).not.toContain(marker);
    expect(text).toContain("Clinic-grade skincare");
    expect(ctx.contextTokens).toBeLessThanOrEqual(USE_CASE_BUDGETS.brief);

    await generateDailyBrief(t.scope);
    const run = await db.aiRun.findFirstOrThrow({ where: { organizationId: t.organization.id, task: "SUMMARIZATION" } });
    expect(run.contextTokens).toBeLessThanOrEqual(USE_CASE_BUDGETS.brief);
    expect(run.brainVersion).toBeTruthy();
    expect(run.sourceTypes).not.toContain("faq");
    expect(run.sourceTypes).not.toContain("document");
  });

  it("analytics doesn't load CRM or the catalogue — only the products the subject is about", async () => {
    const t = await makeTenant("Analytics");
    await seed(t);
    const text = compactContext(await analyticsContext(t.scope, "Our barrier serum night routine post"));
    expect(text).toContain("Barrier Serum");
    for (const marker of ["Gentle Cleanser", "CatalogueService", "CrmPersonX", "crm.person@secret.test", "FAQSECRET", "CHUNKSECRET"]) expect(text).not.toContain(marker);
    // Nothing relevant → no products at all (never the whole catalogue as a fallback).
    expect(compactContext(await analyticsContext(t.scope, ""))).not.toMatch(/Barrier Serum|Gentle Cleanser|CatalogueService/);
    await generateWeeklyReport(t.scope);
    const run = await db.aiRun.findFirstOrThrow({ where: { organizationId: t.organization.id, agentKey: "PERFORMANCE_ANALYST" } });
    expect(run.contextTokens).toBeLessThanOrEqual(USE_CASE_BUDGETS.analytics);
  });

  it("sales context: relevant product + rules + objections; no unrelated content history, no other customers", async () => {
    const t = await makeTenant("Sales");
    await seed(t);
    const ctx = await salesContext(t.scope, { relevantTo: "interested in the barrier serum" });
    const text = compactContext(ctx);
    expect(text).toContain("Barrier Serum");
    expect(text).toContain("Sales rules");
    expect(text).toContain("The serum is expensive");
    expect(text).toContain("No discounts above 10%"); // approved discount fact
    for (const marker of ["Gentle Cleanser", "CatalogueService", "ContentHistoryX", "CrmPersonX", "FAQSECRET", "Content pillars"]) expect(text).not.toContain(marker);
    expect(compactContext(await salesContext(t.scope, { relevantTo: "" }))).not.toMatch(/Barrier Serum|CatalogueService/);
  });

  it("content context: product/audience/voice/rules; never customer PII or CRM", async () => {
    const t = await makeTenant("Content");
    await seed(t);
    const text = compactContext(await contentContext(t.scope, { relevantTo: "barrier serum education post", query: "serum routine" }));
    expect(text).toContain("Barrier Serum");
    expect(text).toContain("Brand voice");
    expect(text).toContain("cures acne"); // forbidden claim
    for (const marker of ["CrmPersonX", "crm.person@secret.test", "0501112233", "Sales rules", "No discounts", "FAQSECRET"]) expect(text).not.toContain(marker);
  });

  it("budgets are enforced for every use case even with a large brain", async () => {
    const t = await makeTenant("Budget");
    await seed(t);
    for (let i = 0; i < 40; i++) await upsertFact(t.scope, { key: `positioning.point_${i}`, value: `Positioning statement number ${i} ${"with extra words ".repeat(10)}`, category: "positioning", sourceKind: "manual" }, actor(t));
    const cases = [
      ["brief", await briefContext(t.scope)],
      ["analytics", await analyticsContext(t.scope, "serum")],
      ["sales", await salesContext(t.scope, { relevantTo: "serum", query: "serum price" })],
      ["content", await contentContext(t.scope, { relevantTo: "serum", query: "serum" })],
    ] as const;
    for (const [name, c] of cases) {
      expect(c.contextTokens, name).toBeLessThanOrEqual(USE_CASE_BUDGETS[name]);
      expect(estimateTokens(compactContext(c)), name).toBe(c.contextTokens);
    }
  });
});

describe("structured answers skip vector retrieval and AI", () => {
  it("an approved fact answers without chunk search; an approved FAQ answers without AI; OpenAI off doesn't break brain answers", async () => {
    const t = await makeTenant("Facts first");
    await upsertFact(t.scope, { key: "delivery.time", value: "We deliver within 3 working days across the UAE.", category: "general", sourceKind: "manual" }, actor(t));
    await saveEntity(t.scope, "faq", { data: { question: "Do you ship internationally?", answer: "Only within the GCC." } }, actor(t));
    const src = await db.knowledgeSource.create({ data: { ...t.scope, type: "DOCUMENT", title: "Old", status: "READY", lastSyncedAt: new Date() } });
    const doc = await db.knowledgeDocument.create({ data: { ...t.scope, sourceId: src.id, title: "Old", content: "x", contentHash: "h2" } });
    await db.knowledgeChunk.create({ data: { ...t.scope, documentId: doc.id, sourceId: src.id, index: 0, content: "Delivery time used to be two weeks in the old handbook.", tokenCount: 12 } });

    const ctx = ctxFor(t);
    const fact = await executeCommand(ctx, { text: "What is your delivery time?", locale: "en", idempotencyKey: `h1-${Date.now()}` });
    expect(fact).toMatchObject({ intent: "brain_question", mode: "brain", status: "completed", text: "We deliver within 3 working days across the UAE." });
    const log = await db.commandExecution.findUniqueOrThrow({ where: { id: fact.executionId } });
    expect(log.aiUsed).toBe(false);
    const faq = await executeCommand(ctx, { text: "Do you ship internationally?", locale: "en", idempotencyKey: `h2-${Date.now()}` });
    expect(faq).toMatchObject({ status: "completed", text: "Only within the GCC.", mode: "brain" });
    expect(await db.aiRun.count({ where: { organizationId: t.organization.id } })).toBe(0);
  });
});

describe("static guard", () => {
  it("no AI call site uses the full-profile prompt or raw chunk retrieval any more", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    walk(path.join(process.cwd(), "src/server"));
    walk(path.join(process.cwd(), "src/features"));
    const offenders = files.filter((f) => /\bbrainPrompt\s*\(|\bretrieveKnowledge\s*\(|\bformatContext\s*\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
