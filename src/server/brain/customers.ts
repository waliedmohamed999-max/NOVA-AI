import { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";

/**
 * Customer intelligence over the CRM. Aggregates only: no customer row is copied into the brain,
 * embedded, or sent to a model. Every number is computed from real rows; when data is missing the
 * metric is null (never a guess).
 */

export type SegmentCriteria = { city?: string; country?: string; minOrders?: number; maxOrders?: number; minSpendCents?: number; category?: string; tag?: string; source?: string; b2b?: boolean };

/** Segment criteria → a Prisma filter on CRM leads (tenant-scoped by tenantDb). */
export function segmentWhere(c: SegmentCriteria): Prisma.LeadWhereInput {
  const w: Prisma.LeadWhereInput[] = [];
  if (c.city) w.push({ city: { equals: c.city, mode: "insensitive" } });
  if (c.country) w.push({ country: { equals: c.country, mode: "insensitive" } });
  if (c.minOrders != null) w.push({ ordersCount: { gte: c.minOrders } });
  if (c.maxOrders != null) w.push({ ordersCount: { lte: c.maxOrders } });
  if (c.minSpendCents != null) w.push({ totalSpendCents: { gte: c.minSpendCents } });
  if (c.category) w.push({ purchaseCategories: { has: c.category } });
  if (c.tag) w.push({ tags: { has: c.tag } });
  if (c.source) w.push({ source: { equals: c.source, mode: "insensitive" } });
  if (c.b2b) w.push({ company: { not: null } });
  return w.length ? { AND: w } : { id: "__none__" };
}

export async function sizeSegment(scope: TenantScope, criteria: SegmentCriteria) {
  return tenantDb(scope).lead.count({ where: segmentWhere(criteria) });
}

/** Re-sizes every approved/suggested segment from the CRM (cheap counts). */
export async function refreshSegmentSizes(scope: TenantScope) {
  const t = tenantDb(scope);
  const segs = await t.customerSegment.findMany({ where: { status: { not: "rejected" } } });
  for (const s of segs) await t.customerSegment.update({ where: { id: s.id }, data: { size: await sizeSegment(scope, (s.criteria ?? {}) as SegmentCriteria), sizedAt: new Date() } });
}

const MIN_SUPPORT = 5;

export type CustomerOverview = {
  total: number;
  withOrders: number;
  repeat: number | null;
  avgSpendCents: number | null;
  currency: string | null;
  topCities: { key: string; count: number }[];
  topCountries: { key: string; count: number }[];
  topCategories: { key: string; count: number }[];
  b2b: number;
  coverage: { city: number; spend: number; orders: number; category: number };
};

export async function customerOverview(scope: TenantScope): Promise<CustomerOverview> {
  const where = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const [total, withOrders, repeat, withSpend, spendAgg, cities, countries, withCity, b2b, withCategory, currency] = await Promise.all([
    db.lead.count({ where }),
    db.lead.count({ where: { ...where, ordersCount: { not: null } } }),
    db.lead.count({ where: { ...where, ordersCount: { gte: 2 } } }),
    db.lead.count({ where: { ...where, totalSpendCents: { not: null } } }),
    db.lead.aggregate({ where: { ...where, totalSpendCents: { not: null } }, _avg: { totalSpendCents: true } }),
    db.lead.groupBy({ by: ["city"], where: { ...where, city: { not: null } }, _count: true, orderBy: { _count: { city: "desc" } }, take: 6 }),
    db.lead.groupBy({ by: ["country"], where: { ...where, country: { not: null } }, _count: true, orderBy: { _count: { country: "desc" } }, take: 6 }),
    db.lead.count({ where: { ...where, city: { not: null } } }),
    db.lead.count({ where: { ...where, company: { not: null } } }),
    db.lead.count({ where: { ...where, purchaseCategories: { isEmpty: false } } }),
    db.lead.groupBy({ by: ["currency"], where, _count: true, orderBy: { _count: { currency: "desc" } }, take: 1 }),
  ]);
  const cats = await db.$queryRaw<{ key: string; count: number }[]>`
    SELECT c AS "key", count(*)::int AS "count" FROM "leads", unnest("purchaseCategories") AS c
    WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId}
    GROUP BY c ORDER BY count(*) DESC LIMIT 6`;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return {
    total,
    withOrders,
    // Repeat rate / average spend only when most customers actually have the data.
    repeat: withOrders >= Math.max(MIN_SUPPORT, total * 0.6) ? repeat : null,
    avgSpendCents: withSpend >= Math.max(MIN_SUPPORT, total * 0.6) ? Math.round(spendAgg._avg.totalSpendCents ?? 0) : null,
    currency: currency[0]?.currency ?? null,
    topCities: cities.map((c) => ({ key: c.city!, count: c._count })),
    topCountries: countries.map((c) => ({ key: c.country!, count: c._count })),
    topCategories: cats,
    b2b,
    coverage: { city: pct(withCity), spend: pct(withSpend), orders: pct(withOrders), category: pct(withCategory) },
  };
}

export type CustomerInsight = { kind: "city_category" | "repeat_share" | "top_city"; values: Record<string, string | number> };

/**
 * Insights computed on aggregates only (never raw rows to a model). An insight is reported only when
 * the data supports it: minimum support and a meaningful lift over the overall share.
 */
export async function customerInsights(scope: TenantScope): Promise<CustomerInsight[]> {
  const rows = await db.$queryRaw<{ city: string; category: string; n: number }[]>`
    SELECT "city", c AS "category", count(*)::int AS n FROM "leads", unnest("purchaseCategories") AS c
    WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} AND "city" IS NOT NULL
    GROUP BY "city", c`;
  const byCity = new Map<string, number>();
  const byCat = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    byCity.set(r.city, (byCity.get(r.city) ?? 0) + r.n);
    byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.n);
    total += r.n;
  }
  const out: CustomerInsight[] = [];
  for (const r of rows) {
    const cityTotal = byCity.get(r.city)!;
    if (r.n < MIN_SUPPORT || cityTotal < MIN_SUPPORT) continue;
    const shareInCity = r.n / cityTotal;
    const overall = byCat.get(r.category)! / total;
    if (shareInCity >= overall * 1.5 && shareInCity >= 0.3) out.push({ kind: "city_category", values: { city: r.city, category: r.category, share: Math.round(shareInCity * 100), overall: Math.round(overall * 100) } });
  }
  const o = await customerOverview(scope);
  if (o.repeat != null && o.withOrders) out.push({ kind: "repeat_share", values: { repeat: o.repeat, share: Math.round((o.repeat / o.withOrders) * 100) } });
  if (o.topCities[0] && o.topCities[0].count >= MIN_SUPPORT && o.total) out.push({ kind: "top_city", values: { city: o.topCities[0].key, share: Math.round((o.topCities[0].count / o.total) * 100) } });
  return out.slice(0, 6);
}

/**
 * Rule-based segment suggestions (no AI). Saved as "suggested" — the owner approves or rejects.
 * Only suggested when the CRM has enough customers matching each rule.
 */
const SEGMENT_NAMES = {
  en: { repeat: "Repeat customers", repeatDef: "2+ orders", once: "One-time buyers", onceDef: "exactly 1 order", high: "High-value customers", highDef: "spend ≥ 2× average", city: (c: string) => `Customers in ${c}`, cityDef: (c: string) => `city = ${c}`, b2b: "B2B companies", b2bDef: "customers with a company" },
  ar: { repeat: "العملاء المتكررون", repeatDef: "طلبان أو أكثر", once: "مشترو المرة الواحدة", onceDef: "طلب واحد فقط", high: "العملاء الأعلى قيمة", highDef: "إنفاق ≥ ضعف المتوسط", city: (c: string) => `عملاء ${c}`, cityDef: (c: string) => `المدينة = ${c}`, b2b: "الشركات (B2B)", b2bDef: "عملاء لديهم شركة" },
};

export async function suggestSegments(scope: TenantScope, locale: "ar" | "en" = "en") {
  const N = SEGMENT_NAMES[locale];
  const t = tenantDb(scope);
  const o = await customerOverview(scope);
  const candidates: { name: string; definition: string; criteria: SegmentCriteria }[] = [];
  if (o.repeat != null && o.repeat >= MIN_SUPPORT) candidates.push({ name: N.repeat, definition: N.repeatDef, criteria: { minOrders: 2 } });
  if (o.withOrders >= MIN_SUPPORT) candidates.push({ name: N.once, definition: N.onceDef, criteria: { minOrders: 1, maxOrders: 1 } });
  if (o.avgSpendCents != null) candidates.push({ name: N.high, definition: N.highDef, criteria: { minSpendCents: o.avgSpendCents * 2 } });
  for (const c of o.topCities.slice(0, 2)) if (c.count >= MIN_SUPPORT) candidates.push({ name: N.city(c.key), definition: N.cityDef(c.key), criteria: { city: c.key } });
  if (o.b2b >= MIN_SUPPORT) candidates.push({ name: N.b2b, definition: N.b2bDef, criteria: { b2b: true } });
  const existing = await t.customerSegment.findMany({ select: { name: true } });
  let created = 0;
  for (const c of candidates) {
    if (existing.some((e) => e.name.toLowerCase() === c.name.toLowerCase())) continue;
    const size = await sizeSegment(scope, c.criteria);
    if (size < MIN_SUPPORT) continue;
    await t.customerSegment.create({ data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, name: c.name, definition: c.definition, criteria: c.criteria as Prisma.InputJsonValue, size, sizedAt: new Date(), source: "rules", status: "suggested" } });
    created++;
  }
  return { created };
}

/** A PII-free text summary of the customer base — the only customer data that may be embedded. */
export function aggregateSummary(o: CustomerOverview) {
  const list = (xs: { key: string; count: number }[]) => xs.map((x) => `${x.key} (${x.count})`).join(", ");
  return [
    `Customers: ${o.total}.`,
    o.repeat != null ? `Repeat customers (2+ orders): ${o.repeat}.` : null,
    o.topCities.length ? `Top cities: ${list(o.topCities)}.` : null,
    o.topCountries.length ? `Top countries: ${list(o.topCountries)}.` : null,
    o.topCategories.length ? `Top purchase categories: ${list(o.topCategories)}.` : null,
    o.b2b ? `B2B customers (with a company): ${o.b2b}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
