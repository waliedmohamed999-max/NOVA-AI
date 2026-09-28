import { afterEach, describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import "@/server/agents/jobs";
import { db } from "@/server/db/client";
import { tenantDb } from "@/server/db/tenant";
import { can } from "@/server/rbac";
import type { TenantContext } from "@/server/context";
import { saveUpload } from "@/server/storage";
import { createLead } from "@/server/sales/service";
import { applyImport, createFileImport, createUrlImport, detectPlatform, previewCustomers, runImport, setBrainFetcher } from "@/server/brain/imports";
import { parseDocx, parsePdf, parseXlsx, readZip } from "@/server/brain/parsers";
import { decideFact, saveEntity, setEntityStatus, upsertFact, revisions } from "@/server/brain/core";
import { customerInsights, customerOverview, suggestSegments } from "@/server/brain/customers";
import { draftStrategy, saveAnswer, setStrategyStatus } from "@/server/brain/strategy";
import { analyzeCompetitors, importCompetitor, setCompetitorFetcher } from "@/server/brain/competitors";
import { brainHealth, loadBrainState, nextQuestion, questionStates } from "@/server/brain/health";
import { listSources, setSourcePaused, sourceHealth } from "@/server/brain/sources";
import { searchBrain } from "@/server/brain/search";
import { compactContext, retrieveCompanyContext } from "@/server/knowledge/company-context";
import { executeCommand } from "@/server/command/service";
import type { ImportField } from "@/server/sales/intelligence";
import { makeTenant } from "../support/factory";

/** Company Intelligence OS: imports → review → brain; structured-first retrieval; privacy; isolation. */
type Tenant = Awaited<ReturnType<typeof makeTenant>>;
const actor = (t: Tenant) => ({ userId: t.user.id });
const me = (t: Tenant) => ({ type: "USER" as const, id: t.user.id, label: "Owner" });
function ctxFor(t: Tenant): TenantContext {
  return {
    user: { id: t.user.id, email: t.user.email, name: t.user.name, locale: "ar", isPlatformAdmin: false, emailVerifiedAt: new Date() },
    sessionId: "s",
    organization: { id: t.organization.id, name: t.organization.name, slug: t.organization.slug, onboardingStatus: "COMPLETED", timezone: "UTC", locale: "ar", isDemo: false },
    workspace: { id: t.workspace.id, name: "W" },
    role: "OWNER",
    db: tenantDb(t.scope),
    can: (p) => can("OWNER", p),
  } as TenantContext;
}

// ── Fixtures ──

type Page = { status?: number; contentType?: string; body: string; url?: string };
function fixtures(pages: Record<string, Page>) {
  return async (url: string) => {
    const p = pages[url] ?? pages[url.replace(/\/$/, "")];
    if (!p) return { url, status: 404, contentType: "text/html", body: "" };
    return { url: p.url ?? url, status: p.status ?? 200, contentType: p.contentType ?? "text/html", body: p.body };
  };
}
afterEach(() => {
  setBrainFetcher(null);
});

/** Minimal ZIP writer (deflate) — builds real DOCX/XLSX files for the parsers. */
function makeZip(files: Record<string, string>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const comp = deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const docx = (paragraphs: string[]) =>
  makeZip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`,
  });

function xlsx(rows: string[][]) {
  const strings: string[] = [];
  const idx = (s: string) => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1);
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheet = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (/^\d+(\.\d+)?$/.test(v) ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${idx(v)}</v></c>`)).join("")}</row>`).join("");
  return makeZip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types/>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook/>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${sheet}</sheetData></worksheet>`,
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`,
  });
}

/** A small valid PDF with one text line per row (Helvetica, uncompressed content). */
function makePdf(lines: string[]) {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = `BT /F1 11 Tf 50 780 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

async function upload(t: Tenant, fileName: string, data: Buffer) {
  return saveUpload({ organizationId: t.organization.id, workspaceId: t.workspace.id, userId: t.user.id, fileName, data, purpose: "brain_import" });
}

const SITE = "https://acme-agency.test/";
const SITE_HTML = `<!doctype html><html lang="en"><head><title>Acme Agency | Web & Marketing</title>
<meta name="description" content="Acme Agency builds websites and runs digital marketing for SMEs in Saudi Arabia.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How long does a website take?","acceptedAnswer":{"@type":"Answer","text":"Most company websites are delivered in four weeks."}}]}</script>
</head><body><main>
<h2>Our services</h2><ul><li>Website development</li><li>Digital marketing</li><li>SEO audits</li></ul>
<h2>Pricing</h2><p>Landing page package: 8,000 SAR per project for small businesses.</p>
<h2>Refund policy</h2><p>Deposits are refundable within 14 days of signing if work has not started.</p>
<h2>FAQ</h2><p>Do you work with companies outside Riyadh?</p><p>Yes, we work with clients across Saudi Arabia and the GCC.</p>
<a href="/about">About us</a></main></body></html>`;
const ABOUT_HTML = `<html><head><title>About Acme</title></head><body><main><h1>About us</h1><p>We are a team of designers and marketers helping small businesses grow online since 2018.</p></main></body></html>`;

// ── Imports ──

describe("imports: website / store / spreadsheet / documents → review → brain", () => {
  it("website: local + structured extraction → review → only selected items are imported, each linked to its source", async () => {
    const t = await makeTenant("Acme");
    setBrainFetcher(fixtures({ [SITE]: { body: SITE_HTML }, "https://acme-agency.test/about": { body: ABOUT_HTML } }));
    const imp = await createUrlImport(t.scope, actor(t), "website", "acme-agency.test");
    await runImport(t.scope, imp.id);
    const r = await db.brainImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(r.status).toBe("REVIEW");
    const cands = r.candidates as { id: string; type: string; data: Record<string, unknown>; critical: boolean; selected: boolean }[];
    const types = new Set(cands.map((c) => c.type));
    for (const k of ["offering", "faq", "pricing", "policy", "profile"]) expect(types.has(k), k).toBe(true);
    expect(cands.filter((c) => c.type === "offering").map((c) => c.data.name)).toEqual(expect.arrayContaining(["Website development", "Digital marketing"]));
    // Critical items are shown but not pre-selected.
    expect(cands.filter((c) => c.critical).every((c) => !c.selected)).toBe(true);

    const pricing = cands.find((c) => c.type === "pricing")!;
    const selected = [...cands.filter((c) => c.selected).map((c) => c.id), pricing.id];
    await applyImport(t.scope, actor(t), imp.id, { selectedIds: selected });
    const done = await db.brainImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(done.status).toBe("IMPORTED");
    const offerings = await db.offering.findMany({ where: { organizationId: t.organization.id } });
    expect(offerings.map((o) => o.name)).toEqual(expect.arrayContaining(["Website development", "Digital marketing"]));
    expect(offerings.every((o) => o.sourceId === done.sourceId && o.sourceKind === "website")).toBe(true);
    const faqs = await db.brainFaq.findMany({ where: { organizationId: t.organization.id } });
    expect(faqs.some((f) => f.question.includes("How long does a website take") && f.status === "approved" && f.sourceId === done.sourceId)).toBe(true);
    // Pricing = critical: imported as pending, never used until approved.
    const price = await db.brainFact.findFirstOrThrow({ where: { organizationId: t.organization.id, category: "pricing" } });
    expect(price).toMatchObject({ status: "pending", critical: true, sourceKind: "website", sourceId: done.sourceId });
    expect(compactContext(await retrieveCompanyContext(t.scope, { purpose: "sales" }))).not.toContain("8,000");
    // Profile description filled (it was empty) — never overwrites what the owner wrote.
    expect((await db.companyProfile.findFirstOrThrow({ where: { organizationId: t.organization.id } })).description).toContain("builds websites");
    // A second apply is refused (idempotent).
    await expect(applyImport(t.scope, actor(t), imp.id, {})).rejects.toThrow();
  });

  it("store: public catalogue only (Shopify products.json + JSON-LD); a login wall → requires official integration", async () => {
    const t = await makeTenant("Store");
    const home = `<html><head><title>Luma Shop</title><meta name="description" content="Clean skincare for dry skin."><script src="https://cdn.shopify.com/s/files/theme.js"></script>
      <script type="application/ld+json">{"@type":"Product","name":"Barrier Serum","offers":{"price":"180","priceCurrency":"AED"},"aggregateRating":{"ratingValue":"4.8","reviewCount":"120"},"review":[{"reviewBody":"My skin feels calm after one week","reviewRating":{"ratingValue":"5"}}]}</script></head><body><main><p>Shop</p></main></body></html>`;
    const products = JSON.stringify({ products: [{ title: "Barrier Serum", product_type: "Serums", variants: [{ price: "180.00", compare_at_price: "220.00" }] }, { title: "Gentle Cleanser", product_type: "Cleansers", variants: [{ price: "95.00" }] }] });
    setBrainFetcher(fixtures({ "https://luma-shop.test/": { body: home }, "https://luma-shop.test/products.json?limit=250": { body: products, contentType: "application/json" } }));
    expect(detectPlatform(home, "https://luma-shop.test/")).toBe("shopify");
    const imp = await createUrlImport(t.scope, actor(t), "store", "https://luma-shop.test/");
    await runImport(t.scope, imp.id);
    const r = await db.brainImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(r.status).toBe("REVIEW");
    const p = r.preview as { platform: string; categories: { name: string }[]; priceRange: { min: number; max: number }; offers: { pct: number }[]; rating: { value: number }; customersRequireIntegration: boolean };
    expect(p).toMatchObject({ platform: "shopify", priceRange: { min: 95, max: 180 }, customersRequireIntegration: true });
    expect(p.categories.map((c) => c.name)).toEqual(expect.arrayContaining(["Serums", "Cleansers"]));
    expect(p.offers[0].pct).toBe(18);
    const cands = r.candidates as { type: string; data: Record<string, unknown> }[];
    expect(cands.some((c) => c.type === "fact" && c.data.key === "customer.language")).toBe(true);

    setBrainFetcher(fixtures({ "https://private-shop.test/": { status: 302, url: "https://private-shop.test/account/login", body: "" } }));
    const locked = await createUrlImport(t.scope, actor(t), "store", "https://private-shop.test/");
    await runImport(t.scope, locked.id);
    expect(await db.brainImport.findUniqueOrThrow({ where: { id: locked.id } })).toMatchObject({ status: "FAILED", error: "requires_integration" });
  });

  it("CSV customers: detect columns → map → preview duplicates (id / email / phone) → import to the CRM → segments; PII stays out of the brain", async () => {
    const t = await makeTenant("Shop CSV", "ar");
    await createLead(t.scope, { name: "Existing", email: "dup@x.test" }, me(t), { qualify: false });
    const header = "Customer ID,Name,Email,Phone,City,Orders,Total spend,Last order,Category";
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => `R${i},Riyadh ${i},r${i}@x.test,05000000${i},Riyadh,${i < 6 ? 3 : 1},${1000 + i * 100},2026-08-0${(i % 8) + 1},Serums`),
      ...Array.from({ length: 5 }, (_, i) => `J${i},Jeddah ${i},j${i}@x.test,05100000${i},Jeddah,1,200,2026-07-1${i},Cleansers`),
      "D1,Dup Email,dup@x.test,0520000000,Riyadh,1,100,2026-06-01,Serums",
      "R0,Dup In File,other@x.test,0530000000,Riyadh,1,100,2026-06-01,Serums",
    ];
    const file = await upload(t, "customers.csv", Buffer.from([header, ...rows].join("\n")));
    const imp = await createFileImport(t.scope, actor(t), file.id);
    await runImport(t.scope, imp.id);
    const r = await db.brainImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(r.status).toBe("REVIEW");
    const mapping = r.mapping as Record<string, ImportField | null>;
    expect(Object.values(mapping)).toEqual(expect.arrayContaining(["externalId", "name", "email", "phone", "city", "ordersCount", "totalSpend", "lastOrder", "category"]));
    // Sample rows shown in the mapping step are masked; the full file is never stored on the job.
    expect(JSON.stringify(r.preview)).not.toContain("r1@x.test");
    expect(await db.lead.count({ where: { organizationId: t.organization.id } })).toBe(1); // nothing imported before preview + confirm

    const preview = await previewCustomers(t.scope, imp.id, mapping);
    expect(preview).toMatchObject({ total: 14, ok: 12, duplicates: 2 });
    const res = await applyImport(t.scope, actor(t), imp.id, { mapping, locale: "ar" });
    expect(res).toMatchObject({ created: 12 });
    const riyadh = await db.lead.findFirstOrThrow({ where: { organizationId: t.organization.id, externalId: "R1" } });
    expect(riyadh).toMatchObject({ city: "Riyadh", ordersCount: 3, totalSpendCents: 110_000, purchaseCategories: ["Serums"] });

    const o = await customerOverview(t.scope);
    expect(o).toMatchObject({ total: 13 });
    expect(o.topCities[0]).toEqual({ key: "Riyadh", count: 7 });
    const insights = await customerInsights(t.scope);
    expect(insights.some((i) => i.kind === "city_category" && i.values.city === "Riyadh" && i.values.category === "Serums")).toBe(true);
    const segs = await db.customerSegment.findMany({ where: { organizationId: t.organization.id } });
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.every((s) => s.status === "suggested" && (s.size ?? 0) >= 5)).toBe(true);
    expect(segs.map((s) => s.name)).toContain("العملاء المتكررون");

    // PII isolation: the only customer text in the brain is aggregated and anonymous.
    const src = await db.knowledgeSource.findFirstOrThrow({ where: { organizationId: t.organization.id, type: "SPREADSHEET" } });
    expect(src.rawText).toContain("Riyadh");
    for (const pii of ["r1@x.test", "050000001", "Riyadh 1", "Existing"]) expect(src.rawText).not.toContain(pii);
    for (const purpose of ["sales", "content", "support"] as const) expect(compactContext(await retrieveCompanyContext(t.scope, { purpose, query: "Riyadh customers" }))).not.toMatch(/r\d@x\.test|0500000/);
  });

  it("Excel: a real .xlsx is parsed locally (no AI) and imported through the same review", async () => {
    const t = await makeTenant("Excel");
    const book = xlsx([["Name", "Email", "City", "Orders"], ["Sara", "sara@x.test", "Dammam", "2"], ["Omar", "omar@x.test", "Dammam", "4"]]);
    expect(parseXlsx(book)).toEqual([["Name", "Email", "City", "Orders"], ["Sara", "sara@x.test", "Dammam", "2"], ["Omar", "omar@x.test", "Dammam", "4"]]);
    const file = await upload(t, "clients.xlsx", book);
    expect(file.mimeType).toContain("spreadsheetml");
    const imp = await createFileImport(t.scope, actor(t), file.id);
    await runImport(t.scope, imp.id);
    const r = await db.brainImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(r).toMatchObject({ kind: "excel", status: "REVIEW" });
    await applyImport(t.scope, actor(t), imp.id, { mapping: r.mapping as Record<string, ImportField | null> });
    expect(await db.lead.count({ where: { organizationId: t.organization.id, city: "Dammam" } })).toBe(2);
    expect(await db.aiRun.count({ where: { organizationId: t.organization.id } })).toBe(0);
  });

  it("PDF and DOCX: parse → preview text → FAQs / policies extracted → approve", async () => {
    const t = await makeTenant("Docs");
    const lines = ["Frequently asked questions", "Do you offer a warranty on websites?", "Yes, every website includes 3 months of free fixes.", "Refund policy", "Deposits are refundable within 14 days if work has not started."];
    const pdf = makePdf(lines);
    expect(await parsePdf(pdf)).toContain("Do you offer a warranty on websites?");
    const file = await upload(t, "handbook.pdf", pdf);
    const imp = await createFileImport(t.scope, actor(t), file.id);
    await runImport(t.scope, imp.id);
    const r = await db.brainImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(r.status).toBe("REVIEW");
    expect((r.preview as { excerpt: string }).excerpt).toContain("warranty");
    const cands = r.candidates as { id: string; type: string; data: Record<string, unknown>; critical: boolean }[];
    const faq = cands.find((c) => c.type === "faq")!;
    const policy = cands.find((c) => c.type === "policy")!;
    expect(faq.data.question).toBe("Do you offer a warranty on websites?");
    expect(policy.critical).toBe(true);
    await applyImport(t.scope, actor(t), imp.id, { selectedIds: [faq.id, policy.id] });
    const savedFaq = await db.brainFaq.findFirstOrThrow({ where: { organizationId: t.organization.id } });
    expect(savedFaq).toMatchObject({ status: "approved", sourceKind: "document" });
    expect(savedFaq.sourceId).toBeTruthy();
    const pol = await db.brainFact.findFirstOrThrow({ where: { organizationId: t.organization.id, category: "policy" } });
    expect(pol.status).toBe("pending");
    await decideFact(t.scope, pol.id, "approved", actor(t));
    expect((await db.brainFact.findUniqueOrThrow({ where: { id: pol.id } })).status).toBe("approved");

    const word = docx(["Our services", "Brand identity", "Social media management", "What is your payment schedule?", "50% on signing and 50% on delivery."]);
    expect(parseDocx(word)).toContain("Brand identity");
    expect(readZip(word).has("word/document.xml")).toBe(true);
    const wf = await upload(t, "profile.docx", word);
    const wi = await createFileImport(t.scope, actor(t), wf.id);
    await runImport(t.scope, wi.id);
    const wr = await db.brainImport.findUniqueOrThrow({ where: { id: wi.id } });
    const wc = wr.candidates as { type: string; data: Record<string, unknown> }[];
    expect(wc.filter((c) => c.type === "offering").map((c) => c.data.name)).toEqual(expect.arrayContaining(["Brand identity", "Social media management"]));
    expect(wc.some((c) => c.type === "faq" && c.data.question === "What is your payment schedule?")).toBe(true);
  });
});

// ── Facts, approvals, history, health ──

describe("facts, trust, approvals, history, health", () => {
  it("source trust: a lower-trust source can't overwrite an approved manual fact; AI-inferred critical facts wait for approval", async () => {
    const t = await makeTenant("Facts");
    await upsertFact(t.scope, { key: "service.web_development", value: "true", category: "general", sourceKind: "manual" }, actor(t));
    const r = await upsertFact(t.scope, { key: "service.web_development", value: "false", category: "general", sourceKind: "website" }, actor(t));
    expect(r.skipped).toBe("lower_trust");
    expect((await db.brainFact.findFirstOrThrow({ where: { organizationId: t.organization.id, key: "service.web_development" } })).value).toBe("true");
    const ai = await upsertFact(t.scope, { key: "discount.max", value: "30%", category: "discount", sourceKind: "ai" }, actor(t));
    expect(ai.fact).toMatchObject({ status: "pending", critical: true, confidence: 0.6 });
    const ctx = await retrieveCompanyContext(t.scope, { purpose: "sales" });
    expect(compactContext(ctx)).not.toContain("30%");
    await decideFact(t.scope, ai.fact.id, "approved", actor(t), "20% for annual contracts");
    expect(compactContext(await retrieveCompanyContext(t.scope, { purpose: "sales" }))).toContain("20% for annual contracts");
    const h = await revisions(t.scope, { entityType: "fact", entityId: ai.fact.id });
    expect(h.map((x) => x.action)).toEqual(["approve", "create"]);
    expect(h[0].before).toMatchObject({ value: "30%", status: "pending" });
  });

  it("entities: validation from shared definitions, edit history, AI-sourced FAQ needs approval", async () => {
    const t = await makeTenant("Entities");
    await expect(saveEntity(t.scope, "faq", { data: { question: "" } }, actor(t))).rejects.toThrow();
    await expect(saveEntity(t.scope, "faq", { data: { question: "Q?", answer: "A", secret: "x" } }, actor(t))).rejects.toThrow(); // unknown field
    const f = await saveEntity(t.scope, "faq", { data: { question: "Do you deliver on weekends?", answer: "Only on Saturdays." } }, actor(t), "ai");
    await db.brainFaq.update({ where: { id: String(f.id) }, data: { status: "pending" } });
    expect(compactContext(await retrieveCompanyContext(t.scope, { purpose: "support", query: "deliver weekends" }))).not.toContain("Saturdays");
    await setEntityStatus(t.scope, "faq", String(f.id), "approved", actor(t));
    expect(compactContext(await retrieveCompanyContext(t.scope, { purpose: "support", query: "deliver weekends" }))).toContain("Saturdays");
    await saveEntity(t.scope, "faq", { id: String(f.id), data: { answer: "Saturdays and Sundays." } }, actor(t));
    const h = await revisions(t.scope, { entityType: "faq", entityId: String(f.id) });
    expect(h.map((x) => x.action)).toEqual(["update", "approve", "create"]);
    expect(h[0]).toMatchObject({ before: { answer: "Only on Saturdays." }, after: { answer: "Saturdays and Sundays." } });
    const o = await saveEntity(t.scope, "offering", { data: { type: "SERVICE", name: "Website", priceText: "from 8,000 SAR" } }, actor(t));
    expect(o).toMatchObject({ priceCents: 800_000, isActive: true });
  });

  it("health + question engine: statuses and missing items from real data; answered questions aren't asked again", async () => {
    const t = await makeTenant("Health");
    let s = await loadBrainState(t.scope);
    let h = brainHealth(s);
    expect(h.overall).toBe("weak");
    expect(h.areas.find((a) => a.key === "products")!.status).toBe("empty");
    expect(h.missing.map((m) => m.key)).toEqual(expect.arrayContaining(["industry", "segments", "objections", "no_strategy"]));
    expect(nextQuestion(questionStates(s, s.answers))!.key).toBe("goal_90d");
    await saveAnswer(t.scope, "goal_90d", "20 new clients in Riyadh", actor(t));
    await db.competitor.create({ data: { ...t.scope, name: "Old rival", lastVerifiedAt: new Date(Date.now() - 400 * 86_400_000) } });
    s = await loadBrainState(t.scope);
    h = brainHealth(s);
    const q = questionStates(s, s.answers);
    expect(q.find((x) => x.key === "goal_90d")).toMatchObject({ status: "answered", value: "20 new clients in Riyadh" });
    expect(q.find((x) => x.key === "competitors")!.status).toBe("answered"); // structured data answers it
    expect(nextQuestion(q)!.key).not.toBe("goal_90d");
    expect(h.areas.find((a) => a.key === "competitors")!.status).toBe("outdated");
  });

  it("stale and paused sources: health marks them; paused sources are excluded from retrieval", async () => {
    const t = await makeTenant("Sources");
    const src = await db.knowledgeSource.create({ data: { ...t.scope, type: "FAQ", title: "Old FAQ", status: "READY", lastSyncedAt: new Date(Date.now() - 200 * 86_400_000) } });
    const doc = await db.knowledgeDocument.create({ data: { ...t.scope, sourceId: src.id, title: "Old FAQ", content: "x", contentHash: "h1" } });
    await db.knowledgeChunk.create({ data: { ...t.scope, documentId: doc.id, sourceId: src.id, index: 0, content: "Our support hotline works around the clock for enterprise clients.", tokenCount: 12 } });
    expect(sourceHealth(src)).toBe("stale");
    expect((await listSources(t.scope)).rows[0]).toMatchObject({ health: "stale", chunks: 1, usedBy: expect.arrayContaining(["support"]) });
    expect((await retrieveCompanyContext(t.scope, { purpose: "support", query: "support hotline enterprise" })).chunks.length).toBe(1);
    await setSourcePaused(t.scope, src.id, true, actor(t));
    expect((await retrieveCompanyContext(t.scope, { purpose: "support", query: "support hotline enterprise" })).chunks.length).toBe(0);
    expect((await listSources(t.scope)).rows[0].health).toBe("paused");
  });
});

// ── Strategy & competitors ──

describe("strategy builder and competitors", () => {
  it("strategy: needs answers → draft (never auto-approved) → review → approve; approved strategy reaches agents", async () => {
    const t = await makeTenant("Strategy");
    await expect(draftStrategy(t.scope, actor(t), { type: "marketing", locale: "en" })).rejects.toThrow();
    await saveAnswer(t.scope, "goal_90d", "Win 10 B2B retainers", actor(t));
    await saveAnswer(t.scope, "current_channels", "LinkedIn, referrals", actor(t));
    const s = await draftStrategy(t.scope, actor(t), { type: "marketing", locale: "en" });
    expect(s.status).toBe("DRAFT");
    expect(["offline", "template"]).toContain(s.generatedBy);
    await expect(setStrategyStatus(t.scope, s.id, "APPROVED", actor(t))).rejects.toThrow(); // must be reviewed first
    await setStrategyStatus(t.scope, s.id, "REVIEW", actor(t));
    expect(compactContext(await retrieveCompanyContext(t.scope, { purpose: "content" }))).not.toContain("Approved strategy");
    await setStrategyStatus(t.scope, s.id, "APPROVED", actor(t));
    expect(compactContext(await retrieveCompanyContext(t.scope, { purpose: "content" }))).toContain("Approved strategy");
    const fromData = await draftStrategy(t.scope, actor(t), { type: "sales", fromData: true, locale: "en" });
    expect(fromData.inputs).toMatchObject({ sales: { won: 0, lost: 0 } });
  });

  it("competitor from one public page (no crawling); analysis is labeled as based on the added sources", async () => {
    const t = await makeTenant("Market");
    setCompetitorFetcher(async (url) => ({
      url,
      status: 200,
      contentType: "text/html",
      body: `<html><head><title>Rival Studio - Web Design</title><meta name="description" content="Premium web design for enterprises in Riyadh."></head><body><main><h1>Rival Studio</h1><h2>Enterprise websites</h2><h2>Brand strategy</h2><a href="https://instagram.com/rival">IG</a></main></body></html>`,
    }));
    const c = await importCompetitor(t.scope, actor(t), "rival.test");
    expect(c).toMatchObject({ name: "Rival Studio", positioning: "Premium web design for enterprises in Riyadh.", sourceKind: "public_web", channels: ["instagram"] });
    expect(c.services).toEqual(["Enterprise websites", "Brand strategy"]);
    const a = await analyzeCompetitors(t.scope, "en");
    expect(a).toMatchObject({ basis: "added_sources", ai: false, analysis: null });
    expect(a.table[0].name).toBe("Rival Studio");
  });
});

// ── Retrieval, commands, isolation ──

describe("retrieval order, brain commands, tenant isolation", () => {
  it("structured first: facts → entities → chunks; a matching approved FAQ answers without chunk search", async () => {
    const t = await makeTenant("Retrieval");
    await upsertFact(t.scope, { key: "market.saudi", value: "We serve Saudi Arabia only", category: "general", sourceKind: "manual" }, actor(t));
    await saveEntity(t.scope, "faq", { data: { question: "What are your working hours?", answer: "Sunday to Thursday, 9am to 5pm." } }, actor(t));
    const src = await db.knowledgeSource.create({ data: { ...t.scope, type: "FAQ", title: "Hours page", status: "READY", lastSyncedAt: new Date() } });
    const doc = await db.knowledgeDocument.create({ data: { ...t.scope, sourceId: src.id, title: "Hours", content: "x", contentHash: "h" } });
    await db.knowledgeChunk.create({ data: { ...t.scope, documentId: doc.id, sourceId: src.id, index: 0, content: "Working hours page text with office working hours details.", tokenCount: 10 } });
    const ctx = await retrieveCompanyContext(t.scope, { purpose: "support", query: "What are your working hours?" });
    expect(ctx.faqMatch?.answer).toBe("Sunday to Thursday, 9am to 5pm.");
    expect(ctx.chunks).toHaveLength(0); // the structured answer made the chunk search unnecessary
    const text = compactContext(ctx);
    expect(text.indexOf("Facts:")).toBe(0);
    expect(text).toContain("market.saudi: We serve Saudi Arabia only");

    const c = ctxFor(t);
    const r = await executeCommand(c, { text: "What are your working hours?", locale: "en", idempotencyKey: `k-${Date.now()}` });
    expect(r).toMatchObject({ intent: "brain_question", mode: "brain", status: "completed", text: "Sunday to Thursday, 9am to 5pm." });
    await db.idealCustomerProfile.create({ data: { ...t.scope, name: "SME owners in Riyadh", industry: "Retail", painPoints: ["no online sales"] } });
    await saveEntity(t.scope, "objection", { data: { objection: "The price is high", response: "We offer phased delivery." } }, actor(t));
    expect(await executeCommand(c, { text: "مين عميلنا المثالي؟", locale: "ar", idempotencyKey: `k1-${Date.now()}` })).toMatchObject({ intent: "brain_icp", mode: "brain", status: "completed" });
    expect(await executeCommand(c, { text: "ما أهم اعتراضات العملاء؟", locale: "ar", idempotencyKey: `k2-${Date.now()}` })).toMatchObject({ intent: "brain_objections", mode: "brain", status: "completed" });
    expect(await db.aiRun.count({ where: { organizationId: t.organization.id } })).toBe(0);
  });

  it("tenant isolation: imports, facts, search and retrieval never cross organizations", async () => {
    const a = await makeTenant("Tenant A");
    const b = await makeTenant("Tenant B");
    await upsertFact(a.scope, { key: "secret.discount", value: "ALPHA-40", category: "general", sourceKind: "manual" }, actor(a));
    await saveEntity(a.scope, "faq", { data: { question: "Secret question alpha?", answer: "Alpha answer" } }, actor(a));
    setBrainFetcher(fixtures({ [SITE]: { body: SITE_HTML } }));
    const imp = await createUrlImport(a.scope, actor(a), "website", SITE);
    await runImport(a.scope, imp.id);
    await expect(applyImport(b.scope, actor(b), imp.id, {})).rejects.toThrow();
    expect(await searchBrain(b.scope, "alpha")).toEqual([]);
    expect((await searchBrain(a.scope, "alpha")).length).toBeGreaterThan(0);
    expect(compactContext(await retrieveCompanyContext(b.scope, { purpose: "sales" }))).not.toContain("ALPHA-40");
    await expect(saveEntity(b.scope, "faq", { id: (await db.brainFaq.findFirstOrThrow({ where: { organizationId: a.organization.id } })).id, data: { answer: "hijack" } }, actor(b))).rejects.toThrow();
    expect(await suggestSegments(b.scope)).toEqual({ created: 0 });
  });
});
