import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { runImport, setBrainFetcher } from "@/server/brain/imports";
import { executeRun } from "@/server/agents/runtime";
import "@/server/agents/jobs";
import {
  analyzeWebsite,
  applyWebsite,
  buildStrategyPreview,
  finishSetup,
  loadSetup,
  saveAudience,
  saveBrand,
  saveBusiness,
  saveGoals,
  setStep,
  websiteFindings,
} from "@/server/onboarding/setup";
import type { SetupAnswers } from "@/lib/onboarding-setup";

/** Guided setup → Company Brain, saved live, owner-scoped, never duplicated. */

afterEach(() => setBrainFetcher(null));
const actor = (t: Awaited<ReturnType<typeof makeTenant>>) => ({ userId: t.user.id });
const answersOf = async (orgId: string) => ((await db.organization.findUniqueOrThrow({ where: { id: orgId } })).onboardingData ?? {}) as SetupAnswers;

const SITE_HTML = `<!doctype html><html><head><title>Acme Agency | Web &amp; Marketing</title>
<meta name="description" content="Acme Agency builds websites and runs digital marketing for SMEs in Saudi Arabia."></head>
<body><main><h2>Our services</h2><ul><li>Website development</li><li>Digital marketing</li><li>SEO audits</li></ul>
<h2>Pricing</h2><p>Landing page package: 8,000 SAR per project for small businesses.</p>
<h2>Refund policy</h2><p>Deposits are refundable within 14 days of signing if work has not started.</p></main></body></html>`;

describe("guided setup — live Company Brain sync", () => {
  it("business answers land in the profile, facts and offerings (no duplicates; removals only undo the setup's own)", async () => {
    const t = await makeTenant("Setup Co");
    const org = t.organization.id;
    await saveBusiness(org, actor(t), { companyName: "Setup Co Renamed", website: "setupco.com", industry: "Information technology", businessType: "SERVICES", customerType: "B2B", country: "SA", markets: "Riyadh", description: "We build websites." });
    const profile = await db.companyProfile.findFirstOrThrow({ where: t.scope });
    expect(profile).toMatchObject({ name: "Setup Co Renamed", industry: "Information technology", website: "https://setupco.com/", countries: ["Saudi Arabia"], markets: ["Riyadh"], description: "We build websites.", businessModel: "Services · Businesses" });
    expect((profile.fieldSources as Record<string, { source: string }>).industry.source).toBe("manual");
    expect((await db.organization.findUniqueOrThrow({ where: { id: org } })).name).toBe("Setup Co Renamed");
    const facts = await db.brainFact.findMany({ where: { organizationId: org } });
    expect(facts.find((f) => f.key === "company.name")).toMatchObject({ value: "Setup Co Renamed", sourceKind: "manual", status: "approved" });
    expect(facts.find((f) => f.key === "audience.customer_type")?.value).toBe("Businesses");
    // Customer type creates the ideal customer profile once.
    expect(await db.idealCustomerProfile.count({ where: { organizationId: org } })).toBe(1);

    await saveBusiness(org, actor(t), { offerings: ["Web design", "SEO"] });
    await saveBusiness(org, actor(t), { offerings: ["Web design", "SEO", "web design"] }); // same name, other case
    expect((await db.offering.findMany({ where: t.scope })).map((o) => o.name).sort()).toEqual(["SEO", "Web design"]);
    await saveBusiness(org, actor(t), { offerings: ["Web design"] });
    expect((await db.offering.findMany({ where: t.scope })).map((o) => o.name)).toEqual(["Web design"]);
    expect((await answersOf(org)).offerings).toEqual(["Web design"]);
  });

  it("audience → one ICP updated in place + the strategy answer; invalid ranges are rejected", async () => {
    const t = await makeTenant("Audience Co");
    const org = t.organization.id;
    await saveBusiness(org, actor(t), { customerType: "BOTH" });
    await saveAudience(org, actor(t), { customers: "Clinics in Jeddah", locations: "Jeddah", industries: ["Healthcare"], companySize: "small", budget: "mid", ageMin: 25, ageMax: 45 });
    await saveAudience(org, actor(t), { painPoints: ["No online bookings"], decisionMaker: "Clinic owner" });
    const icps = await db.idealCustomerProfile.findMany({ where: { organizationId: org } });
    expect(icps).toHaveLength(1);
    expect(icps[0]).toMatchObject({ kind: "B2B", industry: "Healthcare", companySize: "11–50 employees", location: "Jeddah", budget: "Mid-range", painPoints: ["No online bookings"], decisionMaker: "Clinic owner" });
    const facts = await db.brainFact.findMany({ where: { organizationId: org } });
    expect(facts.find((f) => f.key === "q.best_customer")?.value).toBe("Clinics in Jeddah");
    expect(facts.find((f) => f.key === "audience.age_range")?.value).toBe("25–45");
    const profile = await db.companyProfile.findFirstOrThrow({ where: t.scope });
    expect((profile.audience as { description: string; source: string }[])[0]).toMatchObject({ description: "Clinics in Jeddah", source: "owner" });

    await expect(saveAudience(org, actor(t), { ageMin: 50, ageMax: 20 })).rejects.toThrow();
    await expect(saveAudience(org, actor(t), { ageMin: 5 })).rejects.toThrow();
  });

  it("brand → brand kit (tone, traits, style, CTA, colors)", async () => {
    const t = await makeTenant("Brand Co", "ar");
    await saveBrand(t.organization.id, actor(t), { tones: ["warm", "professional"], colors: ["#112233", "#ef5a2a"], visualStyle: "elegant", ctaStyle: "direct", contentStyles: ["educational"] });
    const kit = await db.brandKit.findFirstOrThrow({ where: t.scope });
    expect(kit).toMatchObject({ tone: "دافئ، احترافي", voiceTraits: ["دافئ", "احترافي"], imageStyle: "أنيق وفاخر", ctaStyle: "واضحة ومباشرة", primaryColors: ["#112233", "#ef5a2a"] });
    await expect(saveBrand(t.organization.id, actor(t), { colors: ["red"] })).rejects.toThrow();
    const snap = await loadSetup(t.organization.id);
    expect(snap.answers.brand?.tones).toEqual(["warm", "professional"]);
  });

  it("strategy preview is a DRAFT; rebuilding replaces the draft instead of piling up", async () => {
    const t = await makeTenant("Plan Co");
    const org = t.organization.id;
    await saveAudience(org, actor(t), { customers: "Busy parents" });
    await saveGoals(org, actor(t), { goals: ["leads", "sales"], goal90: "40 leads in 90 days", channels: ["INSTAGRAM", "WHATSAPP"] });
    expect((await db.companyProfile.findFirstOrThrow({ where: t.scope })).goals).toEqual(["More leads", "Increase sales"]);
    const first = await buildStrategyPreview(org, actor(t));
    expect(first.status).toBe("DRAFT");
    expect(first.objective ?? "").toContain("40 leads");
    const second = await buildStrategyPreview(org, actor(t));
    const all = await db.strategy.findMany({ where: { organizationId: org } });
    expect(all.map((s) => s.id)).toEqual([second.id]);
    expect(all[0].status).toBe("DRAFT");
    expect((await answersOf(org)).setup?.strategyId).toBe(second.id);
  });

  it("website: safe fetch → findings (offerings, industry, customer type) → owner picks → brain; critical items stay out unless chosen", async () => {
    const t = await makeTenant("Acme");
    const org = t.organization.id;
    setBrainFetcher(async (url) => (url.startsWith("https://acme-agency.test") ? { url, status: 200, contentType: "text/html", body: url.endsWith("/") ? SITE_HTML : "" } : { url, status: 404, contentType: "text/html", body: "" }));
    const { importId } = await analyzeWebsite(org, actor(t), "acme-agency.test");
    await runImport(t.scope, importId);
    const f = await websiteFindings(org, importId);
    expect(f.status).toBe("REVIEW");
    expect(f.offerings.map((o) => o.name)).toEqual(expect.arrayContaining(["Website development", "Digital marketing", "SEO audits"]));
    expect(f.industry).toBe("Information technology");
    expect(f.critical).toBeGreaterThan(0);
    expect(f.platform).toBe("generic");

    const keep = f.offerings.filter((o) => o.name !== "SEO audits").map((o) => o.id);
    const res = await applyWebsite(org, actor(t), importId, keep);
    expect(res.offerings).toEqual(expect.arrayContaining(["Website development", "Digital marketing"]));
    expect(res.offerings).not.toContain("SEO audits");
    // Pricing / refund policy were not chosen → no critical facts were stored.
    expect(await db.brainFact.count({ where: { organizationId: org, critical: true } })).toBe(0);
    expect((await websiteFindings(org, importId)).imported).toBe(true);
    const snap = await loadSetup(org);
    expect(snap.websiteImport?.status).toBe("IMPORTED");
    expect(await db.knowledgeSource.count({ where: { organizationId: org, type: "WEBSITE" } })).toBe(1);
  });

  it("a failed website read is reported honestly (no fake findings)", async () => {
    const t = await makeTenant("Down Co");
    setBrainFetcher(async (url) => ({ url, status: 503, contentType: "text/html", body: "" }));
    const { importId } = await analyzeWebsite(t.organization.id, actor(t), "down.test");
    await runImport(t.scope, importId);
    const f = await websiteFindings(t.organization.id, importId);
    expect(f.status).toBe("FAILED");
    expect(f.error).toBe("website_unreachable");
    expect(f.offerings).toEqual([]);
  });

  it("resume: the current step and completed steps are stored; setup data is tenant-isolated", async () => {
    const a = await makeTenant("Tenant A");
    const b = await makeTenant("Tenant B");
    await saveBusiness(a.organization.id, actor(a), { industry: "Retail", businessType: "PRODUCTS", customerType: "B2C" });
    await setStep(a.organization.id, "audience", "business");
    const snapA = await loadSetup(a.organization.id);
    expect(snapA.answers.setup).toMatchObject({ currentStep: "audience", completed: ["business"] });
    expect(snapA.answers.setup?.updatedAt).toBeTruthy();
    const snapB = await loadSetup(b.organization.id);
    expect(snapB.answers.industry).toBeUndefined();
    expect((await db.companyProfile.findFirstOrThrow({ where: b.scope })).industry).toBeNull();
    expect(await db.idealCustomerProfile.count({ where: { organizationId: b.organization.id } })).toBe(0);
  });

  it("finish requires the required answers, then runs the team setup keeping the owner's choices", async () => {
    const t = await makeTenant("Finish Co");
    const org = t.organization.id;
    await expect(finishSetup(org, actor(t))).rejects.toThrow();
    await saveBusiness(org, actor(t), { industry: "Food & restaurants", businessType: "PRODUCTS", customerType: "B2C", description: "Artisan bakery." });
    await saveAudience(org, actor(t), { customers: "Families", locations: "Cairo" });
    await saveBrand(org, actor(t), { tones: ["warm"] });
    await saveGoals(org, actor(t), { goals: ["sales"] });
    const { runId } = await finishSetup(org, actor(t));
    await executeRun(t.scope, runId);
    expect((await db.organization.findUniqueOrThrow({ where: { id: org } })).onboardingStatus).toBe("COMPLETED");
    const profile = await db.companyProfile.findFirstOrThrow({ where: t.scope });
    expect(profile.industry).toBe("Food & restaurants");
    expect(profile.description).toBe("Artisan bakery.");
    expect((profile.audience as { source?: string }[])[0].source).toBe("owner");
    expect((await db.brandKit.findFirstOrThrow({ where: t.scope })).voiceTraits).toEqual(["Warm"]);
  });
});
