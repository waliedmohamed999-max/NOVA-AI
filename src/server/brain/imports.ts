import { Prisma } from "@/generated/prisma/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { enqueue } from "../jobs/queue";
import { storage } from "../storage";
import { logger } from "../logger";
import { NotFoundError, UserFacingError } from "../errors";
import { normalizeUrl, safeFetchText } from "../net/safe-fetch";
import { extractPage, pickInterestingLinks } from "../knowledge/extract";
import { addKnowledgeSource } from "../knowledge/service";
import { guessMapping, IMPORT_FIELDS, type ImportField } from "../sales/intelligence";
import { importLeads, importRow, MAX_IMPORT, previewImport, type ImportRow } from "../sales/operations";
import type { SourceKind } from "@/lib/brain-fields";
import { detectLanguage, parseFile } from "./parsers";
import { candidatesFromStructured, dedupeCandidates, extractLocal, extractWithAi, structuredSignals, type Candidate } from "./extract";
import { saveEntity, saveProfile, upsertFact } from "./core";
import { aggregateSummary, customerOverview, refreshSegmentSizes, suggestSegments } from "./customers";

/**
 * Company Brain import jobs: Upload → Parsing → Extracting → Review required → Imported / Failed.
 * Local parsing first; AI only for entity extraction from documents/pages (when configured);
 * customer rows go to the CRM (never embedded, never sent to a model).
 */

export type ImportKind = "website" | "store" | "csv" | "excel" | "pdf" | "docx" | "txt";
type Actor = { userId: string | null };

// Public fetches go through the SSRF-safe fetcher; tests inject fixtures.
type Fetcher = (url: string) => Promise<{ url: string; status: number; contentType: string; body: string }>;

/**
 * E2E only: `*.fixture.test` pages served from tests/e2e/fixtures/web when BRAIN_FETCH_FIXTURES=true
 * outside production. Every other URL (and every production request) goes through the SSRF-safe fetcher.
 */
export const publicFetch: Fetcher = async (url) => {
  const u = new URL(url);
  if (process.env.NODE_ENV !== "production" && process.env.BRAIN_FETCH_FIXTURES === "true" && u.hostname.endsWith(".fixture.test")) {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const rel = `${u.hostname}${u.pathname === "/" ? "/index" : u.pathname.replace(/\/$/, "")}`.replace(/\.\./g, "");
    for (const ext of [".html", ".json"]) {
      try {
        const body = await readFile(path.join(process.cwd(), "tests/e2e/fixtures/web", `${rel}${ext}`), "utf8");
        return { url, status: 200, contentType: ext === ".json" ? "application/json" : "text/html", body };
      } catch {
        /* next extension */
      }
    }
    return { url, status: 404, contentType: "text/html", body: "" };
  }
  return safeFetchText(url, { timeoutMs: 10_000, maxBytes: 3_000_000 });
};
let fetcher: Fetcher = publicFetch;
export function setBrainFetcher(f: Fetcher | null) {
  fetcher = f ?? publicFetch;
}

const setStatus = (scope: TenantScope, id: string, data: Prisma.BrainImportUpdateInput) => tenantDb(scope).brainImport.update({ where: { id }, data });

// ── Create ──

export async function createFileImport(scope: TenantScope, actor: Actor, fileId: string) {
  const t = tenantDb(scope);
  const file = await t.fileObject.findFirst({ where: { id: fileId, deletedAt: null } });
  if (!file) throw new NotFoundError("item");
  const ext = file.fileName.split(".").pop()?.toLowerCase() ?? "";
  const kind: ImportKind | null =
    file.mimeType === "text/csv" || ext === "csv" ? "csv" : ext === "xlsx" ? "excel" : file.mimeType === "application/pdf" ? "pdf" : ext === "docx" ? "docx" : file.mimeType.startsWith("text/") ? "txt" : null;
  if (!kind) throw new UserFacingError("file_type");
  const imp = await t.brainImport.create({ data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, kind, title: file.fileName, fileId: file.id, createdById: actor.userId } });
  await enqueue("brain.import", { ...scope, importId: imp.id }, { ...scope, dedupeKey: `brain.import:${imp.id}` });
  return imp;
}

export async function createUrlImport(scope: TenantScope, actor: Actor, kind: "website" | "store", rawUrl: string) {
  let url: string;
  try {
    url = normalizeUrl(rawUrl).toString();
  } catch {
    throw new UserFacingError("website_unreachable");
  }
  const imp = await tenantDb(scope).brainImport.create({ data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, kind, title: new URL(url).hostname, url, createdById: actor.userId } });
  await enqueue("brain.import", { ...scope, importId: imp.id }, { ...scope, dedupeKey: `brain.import:${imp.id}` });
  return imp;
}

// ── Run (job) ──

/** Masks personal data in the few sample rows shown in the mapping step (the full file is never stored). */
const mask = (v: string) => (/@/.test(v) ? v.replace(/^(.).*(@.*)$/, "$1***$2") : /\d{6,}/.test(v.replace(/\D/g, "")) ? v.replace(/\d(?=\d{3})/g, "•") : v);

export async function runImport(scope: TenantScope, importId: string) {
  const t = tenantDb(scope);
  const imp = await t.brainImport.findUnique({ where: { id: importId } });
  if (!imp || ["REVIEW", "IMPORTED"].includes(imp.status)) return { skipped: true };
  await setStatus(scope, imp.id, { status: "PARSING", error: null });
  try {
    if (imp.kind === "website") return await runWebsite(scope, imp.id, imp.url!);
    if (imp.kind === "store") return await runStore(scope, imp.id, imp.url!);
    const file = await t.fileObject.findFirst({ where: { id: imp.fileId ?? "", deletedAt: null } });
    if (!file) throw new UserFacingError("item_not_found");
    const parsed = await parseFile(await storage.get(file.storageKey), file.fileName, file.mimeType);
    if (parsed.rows) {
      // Spreadsheet → customers. Columns detected locally (no AI for obvious headers).
      const [headers = [], ...rows] = parsed.rows;
      if (!headers.length || !rows.length) throw new UserFacingError("csv_empty");
      const mapping = guessMapping(headers);
      await setStatus(scope, imp.id, { status: "REVIEW", mapping: mapping as Prisma.InputJsonValue, preview: { headers, rowCount: Math.min(rows.length, MAX_IMPORT), truncated: rows.length > MAX_IMPORT, sample: rows.slice(0, 5).map((r) => r.map(mask)) } as Prisma.InputJsonValue });
      return { rows: rows.length };
    }
    const text = parsed.text ?? "";
    if (text.trim().length < 20) throw new UserFacingError("document_empty");
    await setStatus(scope, imp.id, { status: "EXTRACTING", preview: { excerpt: text.slice(0, 3000), chars: text.length, language: detectLanguage(text) } as Prisma.InputJsonValue });
    const local = extractLocal(text);
    const ai = await extractWithAi(scope, text).catch((err) => {
      logger.warn({ err, importId }, "ai extraction failed; local extraction only");
      return [] as Candidate[];
    });
    const candidates = dedupeCandidates([...local, ...ai]);
    await setStatus(scope, imp.id, { status: "REVIEW", candidates: candidates as unknown as Prisma.InputJsonValue, stats: { local: local.length, ai: ai.length } as Prisma.InputJsonValue });
    return { candidates: candidates.length };
  } catch (err) {
    const code = err instanceof UserFacingError ? err.code : "unexpected";
    if (!(err instanceof UserFacingError)) logger.error({ err, importId }, "brain import failed");
    await setStatus(scope, imp.id, { status: "FAILED", error: code });
    return { failed: code };
  }
}

async function runWebsite(scope: TenantScope, id: string, url: string) {
  const home = await fetcher(url);
  if (home.status >= 400 || !home.contentType.includes("html")) throw new UserFacingError("website_unreachable");
  const first = extractPage(home.body, home.url);
  const pages = [{ page: first, html: home.body }];
  for (const link of pickInterestingLinks(first.links, 4)) {
    const r = await fetcher(link).catch(() => null);
    if (r && r.status < 400 && r.contentType.includes("html")) pages.push({ page: extractPage(r.body, r.url), html: r.body });
  }
  await setStatus(scope, id, { status: "EXTRACTING", preview: { title: first.title, description: first.description, language: first.language ?? detectLanguage(first.text), platform: detectPlatform(home.body, home.url), pages: pages.map((p) => ({ url: p.page.url, title: p.page.title })) } as Prisma.InputJsonValue });
  const structured = pages.flatMap((p) => candidatesFromStructured(structuredSignals(p.html)));
  const local = pages.flatMap((p) => extractLocal(p.page.text));
  const text = pages.map((p) => `${p.page.title}\n${p.page.text}`).join("\n\n");
  const ai = await extractWithAi(scope, text).catch(() => [] as Candidate[]);
  if (first.description) structured.push({ id: crypto.randomUUID(), type: "profile", data: { description: first.description }, critical: false, origin: "structured", selected: true, evidence: first.description });
  const candidates = dedupeCandidates([...structured, ...local, ...ai]);
  await setStatus(scope, id, { status: "REVIEW", candidates: candidates as unknown as Prisma.InputJsonValue, stats: { pages: pages.length, structured: structured.length, local: local.length, ai: ai.length } as Prisma.InputJsonValue });
  return { candidates: candidates.length };
}

// ── Store (public data only) ──

type Platform = "shopify" | "woocommerce" | "salla" | "zid" | "generic";
export function detectPlatform(html: string, url: string): Platform {
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(html)) return "shopify";
  if (/woocommerce|wp-content\/plugins\/woocommerce/i.test(html)) return "woocommerce";
  if (/salla\.(sa|network)|cdn\.salla|salla-/i.test(html) || /salla\.sa/i.test(url)) return "salla";
  if (/zid\.(store|sa)|zidcdn|zid-/i.test(html) || /zid\.store/i.test(url)) return "zid";
  return "generic";
}

type StoreProduct = { name: string; category: string | null; price: number | null; compareAt: number | null; currency: string | null };

async function storeProducts(platform: Platform, origin: string): Promise<StoreProduct[]> {
  try {
    if (platform === "shopify") {
      const r = await fetcher(`${origin}/products.json?limit=250`);
      if (r.status >= 400) return [];
      const j = JSON.parse(r.body) as { products?: { title: string; product_type?: string; variants?: { price?: string; compare_at_price?: string | null }[] }[] };
      return (j.products ?? []).map((p) => ({ name: p.title, category: p.product_type || null, price: Number(p.variants?.[0]?.price) || null, compareAt: Number(p.variants?.[0]?.compare_at_price) || null, currency: null }));
    }
    if (platform === "woocommerce") {
      const r = await fetcher(`${origin}/wp-json/wc/store/v1/products?per_page=50`);
      if (r.status >= 400) return [];
      const j = JSON.parse(r.body) as { name: string; categories?: { name: string }[]; prices?: { price?: string; regular_price?: string; currency_code?: string; currency_minor_unit?: number } }[];
      return j.map((p) => {
        const unit = 10 ** (p.prices?.currency_minor_unit ?? 2);
        return { name: p.name, category: p.categories?.[0]?.name ?? null, price: p.prices?.price ? Number(p.prices.price) / unit : null, compareAt: p.prices?.regular_price ? Number(p.prices.regular_price) / unit : null, currency: p.prices?.currency_code ?? null };
      });
    }
  } catch (err) {
    logger.debug({ err }, "store catalogue not public");
  }
  return [];
}

async function runStore(scope: TenantScope, id: string, url: string) {
  const home = await fetcher(url);
  const loginWall = home.status === 401 || home.status === 403 || /\/(login|signin|account\/login|auth)\b/i.test(new URL(home.url).pathname);
  if (loginWall) throw new UserFacingError("requires_integration");
  if (home.status >= 400 || !home.contentType.includes("html")) throw new UserFacingError("website_unreachable");
  const origin = new URL(home.url).origin;
  const platform = detectPlatform(home.body, home.url);
  const page = extractPage(home.body, home.url);
  const signals = structuredSignals(home.body);
  // A few public product pages for JSON-LD (generic / Salla / Zid themes publish schema.org data).
  for (const link of page.links.filter((l) => /\/(products?|p|item)\//i.test(l)).slice(0, 3)) {
    const r = await fetcher(link).catch(() => null);
    if (r && r.status < 400) {
      const s = structuredSignals(r.body);
      signals.products.push(...s.products);
      signals.reviews.push(...s.reviews);
      signals.faqs.push(...s.faqs);
      signals.rating ??= s.rating;
    }
  }
  const catalogue = await storeProducts(platform, origin);
  const products: StoreProduct[] = [...catalogue, ...signals.products.map((p) => ({ name: p.name, category: p.category, price: p.price, compareAt: null, currency: p.currency }))];
  const categories = new Map<string, number>();
  for (const p of products) if (p.category) categories.set(p.category, (categories.get(p.category) ?? 0) + 1);
  const prices = products.map((p) => p.price).filter((x): x is number => x != null && x > 0);
  const currency = products.find((p) => p.currency)?.currency ?? null;
  const offers = products.filter((p) => p.compareAt && p.price && p.compareAt > p.price).map((p) => ({ name: p.name, pct: Math.round((1 - p.price! / p.compareAt!) * 100) }));
  const reviewText = signals.reviews.map((r) => r.body).join(" ");
  const preview = {
    platform,
    title: page.title,
    positioning: page.description,
    products: products.length,
    categories: [...categories].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
    priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices), currency } : null,
    rating: signals.rating,
    reviews: signals.reviews.slice(0, 5),
    offers: offers.slice(0, 5),
    language: detectLanguage(reviewText || page.text),
    // Customers / orders are never scraped: they need the platform's official API.
    customersRequireIntegration: true,
  };
  if (!products.length && !signals.faqs.length && !page.description) throw new UserFacingError("requires_integration");
  await setStatus(scope, id, { status: "EXTRACTING", preview: preview as Prisma.InputJsonValue });
  const c = (type: Candidate["type"], data: Record<string, unknown>, evidence?: string, critical = false): Candidate => ({ id: crypto.randomUUID(), type, data, critical, origin: "structured", selected: !critical, evidence });
  const candidates: Candidate[] = [
    ...products.slice(0, 15).map((p) => c("offering", { name: p.name, type: "PRODUCT", category: p.category, priceText: p.price != null ? `${p.price}${p.currency ? ` ${p.currency}` : ""}` : null }, p.name)),
    ...(categories.size ? [c("fact", { key: "store.categories", value: [...categories.keys()].slice(0, 12).join(", "), category: "catalog" })] : []),
    ...(preview.priceRange ? [c("pricing", { key: "store.price_range", value: `${preview.priceRange.min} – ${preview.priceRange.max}${currency ? ` ${currency}` : ""}` }, undefined, true)] : []),
    ...(page.description ? [c("fact", { key: "store.positioning", value: page.description, category: "positioning" })] : []),
    ...(offers.length ? [c("fact", { key: "store.offers", value: offers.map((o) => `${o.name} (−${o.pct}%)`).join("; "), category: "discount" }, undefined, true)] : []),
    ...(signals.rating ? [c("fact", { key: "store.rating", value: `${signals.rating.value} / 5 (${signals.rating.count})`, category: "reputation" })] : []),
    ...(reviewText ? [c("fact", { key: "customer.language", value: signals.reviews.slice(0, 5).map((r) => r.body.slice(0, 160)).join(" | "), category: "customer_language" })] : []),
    ...signals.faqs.slice(0, 20).map((f) => c("faq", f, f.question)),
  ];
  await setStatus(scope, id, { status: "REVIEW", candidates: dedupeCandidates(candidates) as unknown as Prisma.InputJsonValue, stats: { products: products.length, categories: categories.size, reviews: signals.reviews.length } as Prisma.InputJsonValue });
  return { candidates: candidates.length };
}

// ── Customers: mapping → preview → import ──

async function mappedRows(scope: TenantScope, importId: string, mapping: Record<string, ImportField | null>) {
  const t = tenantDb(scope);
  const imp = await t.brainImport.findUnique({ where: { id: importId } });
  if (!imp || !["csv", "excel"].includes(imp.kind)) throw new NotFoundError("item");
  const file = await t.fileObject.findFirst({ where: { id: imp.fileId ?? "", deletedAt: null } });
  if (!file) throw new NotFoundError("item");
  const parsed = await parseFile(await storage.get(file.storageKey), file.fileName, file.mimeType);
  const [, ...rows] = parsed.rows ?? [];
  const valid = Object.fromEntries(Object.entries(mapping).filter(([, f]) => f && (IMPORT_FIELDS as readonly string[]).includes(f)));
  const out: ImportRow[] = rows.slice(0, MAX_IMPORT).map((cells) => {
    const row: Record<string, string> = {};
    for (const [i, f] of Object.entries(valid)) if (cells[Number(i)]?.trim()) row[f as string] = cells[Number(i)].trim();
    return importRow.parse(row);
  });
  return { imp, rows: out };
}

/** Duplicate check before anything is written (email / phone / external id). */
export async function previewCustomers(scope: TenantScope, importId: string, mapping: Record<string, ImportField | null>) {
  const { rows } = await mappedRows(scope, importId, mapping);
  const p = await previewImport(scope, rows);
  await tenantDb(scope).brainImport.update({ where: { id: importId }, data: { mapping: mapping as Prisma.InputJsonValue } });
  return {
    total: p.length,
    ok: p.filter((x) => x.status === "ok").length,
    duplicates: p.filter((x) => x.status === "duplicate").length,
    invalid: p.filter((x) => x.status === "invalid").length,
    sample: p.slice(0, 8).map((x) => ({ status: x.status, reason: x.reason ?? null, name: x.row.name ?? x.row.company ?? "—", city: x.row.city ?? null, orders: x.row.ordersCount ?? null })),
  };
}

// ── Apply (after review) ──

const slug = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "item";

export async function applyImport(scope: TenantScope, actor: Actor, importId: string, input: { selectedIds?: string[]; mapping?: Record<string, ImportField | null>; locale?: "ar" | "en" }) {
  const t = tenantDb(scope);
  const imp = await t.brainImport.findUnique({ where: { id: importId } });
  if (!imp) throw new NotFoundError("item");
  if (imp.status !== "REVIEW") throw new UserFacingError("invalid_transition");
  const claimed = await t.brainImport.updateMany({ where: { id: imp.id, status: "REVIEW" }, data: { status: "PARSING" } });
  if (!claimed.count) throw new UserFacingError("invalid_transition");

  try {
    if (imp.kind === "csv" || imp.kind === "excel") {
      const { rows } = await mappedRows(scope, imp.id, input.mapping ?? ((imp.mapping ?? {}) as Record<string, ImportField | null>));
      // Customers go to the CRM (the single customer record). The brain only keeps aggregates.
      const r = await importLeads(scope, rows, { type: "USER", id: actor.userId, label: "Company Brain import" });
      const o = await customerOverview(scope);
      const summary = aggregateSummary(o);
      const src = await addKnowledgeSource(scope, { type: "SPREADSHEET", title: `${imp.title} — aggregated`, rawText: summary, metadata: { importId: imp.id, piiFree: true } });
      const seg = await suggestSegments(scope, input.locale ?? "en");
      await refreshSegmentSizes(scope);
      await t.brainImport.update({ where: { id: imp.id }, data: { status: "IMPORTED", importedAt: new Date(), sourceId: src.id, stats: { ...r, segmentsSuggested: seg.created } as Prisma.InputJsonValue } });
      return { ...r, segmentsSuggested: seg.created };
    }

    const candidates = (imp.candidates as unknown as Candidate[]) ?? [];
    const chosen = candidates.filter((c) => (input.selectedIds ? input.selectedIds.includes(c.id) : c.selected));
    // Every accepted item keeps a link to its source.
    let sourceId: string;
    if (imp.kind === "website") {
      // One source per site: re-importing the same website reuses its source instead of adding a duplicate.
      const same = await t.knowledgeSource.findFirst({ where: { type: "WEBSITE", url: imp.url } });
      sourceId = same?.id ?? (await addKnowledgeSource(scope, { type: "WEBSITE", title: imp.title, url: imp.url })).id;
    }
    else if (imp.kind === "store") {
      const p = imp.preview as { title?: string; positioning?: string; categories?: { name: string }[]; priceRange?: { min: number; max: number; currency: string | null } | null };
      const text = [p.title, p.positioning, p.categories?.length ? `Categories: ${p.categories.map((c) => c.name).join(", ")}` : null, p.priceRange ? `Price range: ${p.priceRange.min} – ${p.priceRange.max} ${p.priceRange.currency ?? ""}` : null].filter(Boolean).join("\n");
      sourceId = (await addKnowledgeSource(scope, { type: "STORE", title: imp.title, url: imp.url, rawText: text || imp.title })).id;
    } else {
      const file = await t.fileObject.findFirst({ where: { id: imp.fileId ?? "" } });
      const parsed = file ? await parseFile(await storage.get(file.storageKey), file.fileName, file.mimeType) : null;
      sourceId = (await addKnowledgeSource(scope, { type: "DOCUMENT", title: imp.title, rawText: (parsed?.text ?? "").slice(0, 200_000) || imp.title, fileId: imp.fileId })).id;
    }
    const kindOf = (c: Candidate): SourceKind => (c.origin === "ai" ? "ai" : imp.kind === "website" ? "website" : imp.kind === "store" ? "public_web" : "document");
    const counts: Record<string, number> = {};
    const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
    const profile = await t.companyProfile.findFirst({ select: { description: true } });
    for (const c of chosen) {
      const sk = kindOf(c);
      const d = c.data;
      try {
        if (c.type === "offering") {
          const row = await saveEntity(scope, "offering", { data: { type: d.type === "PRODUCT" ? "PRODUCT" : "SERVICE", name: String(d.name).slice(0, 120), ...(d.description ? { description: String(d.description) } : {}), ...(d.category ? { category: String(d.category) } : {}), ...(d.priceText ? { priceText: String(d.priceText).slice(0, 60) } : {}), ...(d.targetCustomer ? { targetCustomer: String(d.targetCustomer) } : {}), status: sk === "ai" ? "draft" : "active" } }, actor, sk);
          await t.offering.update({ where: { id: String(row.id) }, data: { sourceId } });
        } else if (c.type === "faq" || c.type === "objection") {
          const data = c.type === "faq" ? { question: String(d.question).slice(0, 500), answer: String(d.answer || "—").slice(0, 4000) } : { objection: String(d.objection).slice(0, 300), response: String(d.response || "—").slice(0, 2000) };
          const row = await saveEntity(scope, c.type, { data }, actor, sk);
          // AI-inferred answers are not used automatically until approved.
          const patch = { where: { id: String(row.id) }, data: { sourceId, status: sk === "ai" ? "pending" : "approved" } };
          if (c.type === "faq") await t.brainFaq.update(patch);
          else await t.brainObjection.update(patch);
        } else if (c.type === "policy" || c.type === "pricing" || c.type === "case_study" || c.type === "strategy_note" || c.type === "fact") {
          const category = c.type === "case_study" ? "proof" : c.type === "strategy_note" ? "strategy" : c.type === "fact" ? String(d.category ?? "general") : c.type;
          const key = c.type === "fact" ? String(d.key) : `${category}.${slug(String(d.key ?? d.value ?? "note"))}`;
          await upsertFact(scope, { key, value: String(d.value), category, sourceKind: sk, sourceId, confidence: c.origin === "ai" ? 0.6 : 0.9 }, actor);
        } else if (c.type === "segment") {
          await t.customerSegment.create({ data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, name: String(d.name).slice(0, 120), definition: d.definition ? String(d.definition).slice(0, 1000) : null, source: c.origin === "ai" ? "ai" : "rules", status: "suggested", updatedById: actor.userId } });
        } else if (c.type === "profile" && d.description && !profile?.description) {
          // Never overwrite what the owner wrote; only fill an empty description.
          await saveProfile(scope, { description: String(d.description).slice(0, 2000) }, actor, sk);
        } else continue;
        bump(c.type);
      } catch (err) {
        logger.warn({ err, candidate: c.type }, "import candidate skipped");
      }
    }
    await t.brainImport.update({ where: { id: imp.id }, data: { status: "IMPORTED", importedAt: new Date(), sourceId, stats: { ...((imp.stats as object) ?? {}), imported: counts } as Prisma.InputJsonValue } });
    return { imported: counts };
  } catch (err) {
    await t.brainImport.update({ where: { id: imp.id }, data: { status: "REVIEW" } });
    throw err;
  }
}
