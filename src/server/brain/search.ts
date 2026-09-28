import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";

/**
 * "Search the Company Brain": structured records first (facts, products, FAQs, objections, strategy,
 * competitors, segments, ICPs, sources), then a few knowledge chunks. Keyword only — no AI, no customer rows.
 */

export type BrainHit = { kind: "fact" | "offering" | "faq" | "objection" | "strategy" | "competitor" | "segment" | "icp" | "source" | "chunk"; id: string; title: string; snippet: string | null; tab: string };

export async function searchBrain(scope: TenantScope, q: string, limit = 30): Promise<BrainHit[]> {
  const query = q.trim().slice(0, 120);
  if (query.length < 2) return [];
  const t = tenantDb(scope);
  const c = { contains: query, mode: "insensitive" as const };
  const take = 6;
  const [facts, offerings, faqs, objections, strategies, competitors, segments, icps, sources] = await Promise.all([
    t.brainFact.findMany({ where: { status: { not: "rejected" }, OR: [{ key: c }, { value: c }] }, take }),
    t.offering.findMany({ where: { OR: [{ name: c }, { description: c }, { category: c }] }, take }),
    t.brainFaq.findMany({ where: { status: { not: "rejected" }, OR: [{ question: c }, { answer: c }] }, take }),
    t.brainObjection.findMany({ where: { OR: [{ objection: c }, { response: c }] }, take }),
    t.strategy.findMany({ where: { status: { not: "ARCHIVED" }, OR: [{ title: c }, { objective: c }, { positioning: c }] }, take }),
    t.competitor.findMany({ where: { OR: [{ name: c }, { positioning: c }, { notes: c }] }, take }),
    t.customerSegment.findMany({ where: { status: { not: "rejected" }, OR: [{ name: c }, { definition: c }] }, take }),
    t.idealCustomerProfile.findMany({ where: { OR: [{ name: c }, { industry: c }, { location: c }] }, take }),
    t.knowledgeSource.findMany({ where: { OR: [{ title: c }, { url: c }] }, take }),
  ]);
  const chunks = await db.$queryRaw<{ id: string; content: string; sourceId: string }[]>`
    SELECT c."id", c."content", c."sourceId" FROM "knowledge_chunks" c JOIN "knowledge_sources" s ON s."id" = c."sourceId"
    WHERE c."organizationId" = ${scope.organizationId} AND c."workspaceId" = ${scope.workspaceId} AND s."pausedAt" IS NULL
      AND c."content" ILIKE ${`%${query.replace(/[%_]/g, "")}%`}
    LIMIT 5`;
  const cut = (s: string | null | undefined) => (s ? s.slice(0, 160) : null);
  const hits: BrainHit[] = [
    ...facts.map((f) => ({ kind: "fact" as const, id: f.id, title: f.key, snippet: cut(f.value), tab: "profile" })),
    ...offerings.map((o) => ({ kind: "offering" as const, id: o.id, title: o.name, snippet: cut(o.description), tab: "products" })),
    ...faqs.map((f) => ({ kind: "faq" as const, id: f.id, title: f.question, snippet: cut(f.answer), tab: "faq" })),
    ...objections.map((o) => ({ kind: "objection" as const, id: o.id, title: o.objection, snippet: cut(o.response), tab: "sales" })),
    ...strategies.map((s) => ({ kind: "strategy" as const, id: s.id, title: s.title, snippet: cut(s.objective), tab: "strategy" })),
    ...competitors.map((x) => ({ kind: "competitor" as const, id: x.id, title: x.name, snippet: cut(x.positioning), tab: "market" })),
    ...segments.map((x) => ({ kind: "segment" as const, id: x.id, title: x.name, snippet: cut(x.definition), tab: "customers" })),
    ...icps.map((x) => ({ kind: "icp" as const, id: x.id, title: x.name, snippet: cut(x.industry), tab: "customers" })),
    ...sources.map((x) => ({ kind: "source" as const, id: x.id, title: x.title, snippet: x.url, tab: "sources" })),
    ...chunks.map((x) => ({ kind: "chunk" as const, id: x.sourceId, title: query, snippet: cut(x.content.slice(Math.max(0, x.content.toLowerCase().indexOf(query.toLowerCase()) - 60))), tab: "sources" })),
  ];
  return hits.slice(0, limit);
}
