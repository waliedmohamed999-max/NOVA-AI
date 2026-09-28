import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parse } from "node-html-parser";
import { aiStructured, contentAiConfigured } from "../ai";
import type { TenantScope } from "../db/tenant";
import { redact } from "../security/redact";
import { stripBoilerplate } from "../knowledge/company-context";
import { similarity } from "../studio/context";

/**
 * Extraction for Company Brain imports. Local, deterministic rules first (JSON-LD, FAQ patterns,
 * prices, policy sections, service lists); AI only when configured, only on the document text (never
 * on customer rows), and everything lands as a *candidate* that a human reviews before it enters the brain.
 */

export type CandidateType = "offering" | "faq" | "policy" | "pricing" | "case_study" | "segment" | "objection" | "strategy_note" | "fact" | "profile";
export type Candidate = {
  id: string;
  type: CandidateType;
  data: Record<string, unknown>;
  /** pricing / policy / discount: imported as pending, needs explicit approval. */
  critical: boolean;
  origin: "structured" | "local" | "ai";
  selected: boolean;
  evidence?: string;
};

const cand = (type: CandidateType, data: Record<string, unknown>, origin: Candidate["origin"], evidence?: string): Candidate => ({
  id: randomUUID(),
  type,
  data,
  critical: type === "pricing" || type === "policy",
  origin,
  // Critical items are shown but not pre-selected; everything else starts selected.
  selected: !(type === "pricing" || type === "policy"),
  evidence: evidence?.slice(0, 280),
});

const PRICE = /(?:(\d[\d,.]*)\s*(SAR|AED|USD|EGP|KWD|QAR|BHD|OMR|ر\.?\s?س|ريال|درهم|جنيه|\$|€))|(?:(SAR|AED|USD|EGP|\$|€)\s*(\d[\d,.]*))/i;
const POLICY_HEAD = /(policy|terms|refund|return|shipping|delivery|warranty|privacy|سياسة|سياسه|الشروط|الاسترجاع|الإرجاع|الارجاع|الاستبدال|الشحن|التوصيل|الضمان|الخصوصية)/i;
const SERVICES_HEAD = /^(our )?(services|products|solutions|what we do|offerings)\b|^(خدماتنا|منتجاتنا|حلولنا|الخدمات|المنتجات|ماذا نقدم)/i;
const CASE_HEAD = /(case stud|success stor|testimonial|clients say|قصص نجاح|قصة نجاح|دراسة حالة|آراء العملاء|اراء العملاء|عملاؤنا)/i;
const FAQ_HEAD = /(faq|frequently asked|questions|الأسئلة الشائعة|الاسئلة الشائعة|أسئلة|اسئلة)/i;
const OBJECTION = /(too expensive|price is high|not now|no budget|already have|غالي|السعر مرتفع|مش دلوقتي|ليس الآن|لا توجد ميزانية|عندنا مزود)/i;

const isQuestion = (l: string) => /[?؟]\s*$/.test(l) && l.length >= 8 && l.length <= 220;

/** Local rules over plain text (documents, crawled pages). */
export function extractLocal(text: string): Candidate[] {
  // Headings and list items are short: keep them (only boilerplate lines are removed).
  const lines = stripBoilerplate(text.replace(/\r/g, ""), 2).split("\n").map((l) => l.trim()).filter(Boolean);
  const out: Candidate[] = [];
  let section: "policy" | "services" | "case" | "faq" | null = null;
  let sectionTitle = "";
  let buffer: string[] = [];
  const flush = () => {
    if (section === "policy" && buffer.length) out.push(cand("policy", { key: sectionTitle.slice(0, 80), value: buffer.join(" ").slice(0, 800) }, "local", sectionTitle));
    if (section === "case" && buffer.length) out.push(cand("case_study", { key: sectionTitle.slice(0, 80), value: buffer.join(" ").slice(0, 800) }, "local", sectionTitle));
    buffer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const heading = l.length <= 70 && !/[.!؟?]$/.test(l);
    if (heading && POLICY_HEAD.test(l)) {
      flush();
      section = "policy";
      sectionTitle = l;
      continue;
    }
    if (heading && SERVICES_HEAD.test(l)) {
      flush();
      section = "services";
      sectionTitle = l;
      continue;
    }
    if (heading && CASE_HEAD.test(l)) {
      flush();
      section = "case";
      sectionTitle = l;
      continue;
    }
    if (heading && FAQ_HEAD.test(l)) {
      flush();
      section = "faq";
      continue;
    }
    if (isQuestion(l) && lines[i + 1] && !isQuestion(lines[i + 1])) {
      out.push(cand("faq", { question: l, answer: lines[i + 1].slice(0, 1000) }, "local", l));
      i++;
      continue;
    }
    const price = l.match(PRICE);
    if (price && l.length <= 240) out.push(cand("pricing", { key: l.replace(PRICE, "").replace(/[:\-–—|]+\s*$/, "").trim().slice(0, 80) || "price", value: l.slice(0, 240) }, "local", l));
    if (OBJECTION.test(l) && l.length <= 240) out.push(cand("objection", { objection: l, response: "" }, "local", l));
    if (section === "services" && l.length >= 3 && l.length <= 70 && !price) out.push(cand("offering", { name: l, type: "SERVICE" }, "local", sectionTitle));
    else if (section === "policy" || section === "case") buffer.push(l);
  }
  flush();
  return dedupeCandidates(out);
}

type JsonLd = Record<string, unknown>;

function jsonLdBlocks(html: string): JsonLd[] {
  const root = parse(html);
  const out: JsonLd[] = [];
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const v = JSON.parse(s.text);
      const push = (x: unknown) => {
        if (Array.isArray(x)) x.forEach(push);
        else if (x && typeof x === "object") {
          const o = x as JsonLd;
          if (Array.isArray(o["@graph"])) push(o["@graph"]);
          else out.push(o);
        }
      };
      push(v);
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return out;
}

const typeOf = (o: JsonLd) => [o["@type"]].flat().map(String);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export type StructuredSignals = {
  products: { name: string; category: string | null; price: number | null; currency: string | null; description: string | null }[];
  faqs: { question: string; answer: string }[];
  reviews: { body: string; rating: number | null }[];
  rating: { value: number; count: number } | null;
  organization: { name: string | null; description: string | null } | null;
};

/** Schema.org JSON-LD: public, structured, published by the site itself. */
export function structuredSignals(html: string): StructuredSignals {
  const s: StructuredSignals = { products: [], faqs: [], reviews: [], rating: null, organization: null };
  for (const o of jsonLdBlocks(html)) {
    const types = typeOf(o);
    if (types.includes("Product")) {
      const offer = [o.offers].flat()[0] as JsonLd | undefined;
      s.products.push({ name: str(o.name), category: str(o.category) || null, price: offer ? Number(str(offer.price) || str(offer.lowPrice)) || null : null, currency: offer ? str(offer.priceCurrency) || null : null, description: str(o.description).slice(0, 300) || null });
      const agg = o.aggregateRating as JsonLd | undefined;
      if (agg) s.rating = { value: Number(str(agg.ratingValue)) || 0, count: Number(str(agg.reviewCount) || str(agg.ratingCount)) || 0 };
      for (const r of [o.review].flat().filter(Boolean) as JsonLd[]) s.reviews.push({ body: str(r.reviewBody).slice(0, 400), rating: Number(str((r.reviewRating as JsonLd | undefined)?.ratingValue)) || null });
    }
    if (types.includes("FAQPage")) {
      for (const q of [o.mainEntity].flat().filter(Boolean) as JsonLd[]) {
        const a = [q.acceptedAnswer].flat()[0] as JsonLd | undefined;
        if (str(q.name) && a) s.faqs.push({ question: str(q.name), answer: str(a.text).replace(/<[^>]+>/g, "").slice(0, 1000) });
      }
    }
    if (types.includes("Organization") || types.includes("LocalBusiness") || types.includes("Store")) s.organization = { name: str(o.name) || null, description: str(o.description).slice(0, 500) || null };
  }
  s.products = s.products.filter((p) => p.name);
  s.reviews = s.reviews.filter((r) => r.body);
  return s;
}

export function candidatesFromStructured(sig: StructuredSignals, origin: Candidate["origin"] = "structured"): Candidate[] {
  const out: Candidate[] = [];
  for (const p of sig.products.slice(0, 30)) out.push(cand("offering", { name: p.name, type: "PRODUCT", category: p.category, description: p.description, priceText: p.price != null ? `${p.price} ${p.currency ?? ""}`.trim() : null }, origin, p.name));
  for (const f of sig.faqs.slice(0, 40)) out.push(cand("faq", { question: f.question, answer: f.answer }, origin, f.question));
  if (sig.organization?.description) out.push(cand("profile", { description: sig.organization.description }, origin, sig.organization.description));
  return out;
}

export function dedupeCandidates(list: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  const text = (c: Candidate) => String(c.data.question ?? c.data.name ?? c.data.objection ?? c.data.value ?? "");
  for (const c of list) if (!out.some((o) => o.type === c.type && similarity(text(o), text(c)) > 0.85)) out.push(c);
  return out;
}

// ── AI extraction (optional) ──

const extractionSchema = z.object({
  offerings: z.array(z.object({ name: z.string(), type: z.enum(["SERVICE", "PRODUCT"]), description: z.string().nullable(), targetCustomer: z.string().nullable(), priceText: z.string().nullable() })).max(20),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).max(30),
  policies: z.array(z.object({ title: z.string(), text: z.string() })).max(15),
  pricing: z.array(z.object({ item: z.string(), price: z.string() })).max(20),
  caseStudies: z.array(z.object({ title: z.string(), summary: z.string() })).max(10),
  personas: z.array(z.object({ name: z.string(), description: z.string() })).max(8),
  objections: z.array(z.object({ objection: z.string(), response: z.string() })).max(15),
  strategyNotes: z.array(z.string()).max(10),
});

/**
 * One bounded AI call per document (text truncated, output capped). Returns candidates marked "ai" —
 * they are never facts until a human accepts them, and critical ones need approval afterwards too.
 */
export async function extractWithAi(scope: TenantScope, text: string): Promise<Candidate[]> {
  if (!contentAiConfigured()) return [];
  const body = redact(text, 12_000) ?? "";
  const res = await aiStructured(
    { organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "CONTENT_STRATEGIST" },
    {
      task: "ANALYSIS",
      realOnly: true,
      maxTokens: 1500,
      schemaName: "brain_extraction",
      schema: extractionSchema,
      system: "Extract only what is explicitly stated in the document about the company itself. Never invent, never generalize, keep the document's language. Empty arrays when absent.",
      prompt: body,
    },
  );
  const d = res.data;
  return [
    ...d.offerings.map((o) => cand("offering", o, "ai", o.name)),
    ...d.faqs.map((f) => cand("faq", f, "ai", f.question)),
    ...d.policies.map((p) => cand("policy", { key: p.title, value: p.text }, "ai", p.title)),
    ...d.pricing.map((p) => cand("pricing", { key: p.item, value: p.price }, "ai", p.item)),
    ...d.caseStudies.map((c) => cand("case_study", { key: c.title, value: c.summary }, "ai", c.title)),
    ...d.personas.map((p) => cand("segment", { name: p.name, definition: p.description }, "ai", p.name)),
    ...d.objections.map((o) => cand("objection", o, "ai", o.objection)),
    ...d.strategyNotes.map((n) => cand("strategy_note", { value: n }, "ai", n)),
  ];
}
