import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError } from "../errors";
import { enqueue } from "../jobs/queue";
import { STALE_DAYS } from "./health";
import { detectLanguage } from "./parsers";
import { recordRevision } from "./core";

/** Knowledge sources as the brain sees them: health, staleness, who uses them, and their extracted data. */

const DAY = 86_400_000;
type Actor = { userId: string | null };

/** Which agents read a source type (drives "Used by"). */
export const USED_BY: Record<string, string[]> = {
  WEBSITE: ["content", "sales", "support", "command"],
  DOCUMENT: ["support", "sales", "command"],
  MANUAL: ["support", "command"],
  FAQ: ["support", "sales", "command"],
  PRODUCT: ["sales", "content", "command"],
  SERVICE: ["sales", "content", "command"],
  PRICING: ["sales", "command"],
  POLICY: ["support", "sales"],
  CASE_STUDY: ["sales", "content"],
  STORE: ["content", "sales", "analytics"],
  SPREADSHEET: ["analytics", "sales"],
  CRM: ["sales", "analytics"],
  API: ["analytics"],
};

export type SourceHealth = "healthy" | "stale" | "failed" | "paused" | "processing";

export function sourceHealth(s: { status: string; pausedAt: Date | null; lastSyncedAt: Date | null; createdAt: Date }): SourceHealth {
  if (s.pausedAt) return "paused";
  if (s.status === "FAILED") return "failed";
  if (s.status === "PENDING" || s.status === "PROCESSING") return "processing";
  const seen = s.lastSyncedAt ?? s.createdAt;
  return Date.now() - seen.getTime() > STALE_DAYS.sources * DAY ? "stale" : "healthy";
}

export async function listSources(scope: TenantScope, page = 1, take = 20) {
  const t = tenantDb(scope);
  const [rows, total] = await Promise.all([
    t.knowledgeSource.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * take, take, include: { _count: { select: { documents: true } } } }),
    t.knowledgeSource.count(),
  ]);
  const chunks = await t.knowledgeChunk.groupBy({ by: ["sourceId"], where: { sourceId: { in: rows.map((r) => r.id) } }, _count: true });
  return {
    total,
    rows: rows.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      url: s.url,
      status: s.status,
      error: s.error,
      health: sourceHealth(s),
      chunks: chunks.find((c) => c.sourceId === s.id)?._count ?? 0,
      documents: s._count.documents,
      lastSync: (s.lastSyncedAt ?? s.updatedAt).toISOString(),
      language: s.language,
      usedBy: USED_BY[s.type] ?? [],
      summary: ((s.metadata as { summary?: string }) ?? {}).summary ?? null,
    })),
  };
}

export async function setSourcePaused(scope: TenantScope, id: string, paused: boolean, actor: Actor) {
  const t = tenantDb(scope);
  const s = await t.knowledgeSource.findUnique({ where: { id } });
  if (!s) throw new NotFoundError("item");
  await t.knowledgeSource.update({ where: { id }, data: { pausedAt: paused ? new Date() : null } });
  await recordRevision(scope, { entityType: "source", entityId: id, action: "update", before: { paused: Boolean(s.pausedAt) }, after: { paused }, actorId: actor.userId });
}

/** Refresh is always explicit (never automatic and costly). Paused sources are not refreshed. */
export async function refreshSource(scope: TenantScope, id: string) {
  const t = tenantDb(scope);
  const s = await t.knowledgeSource.findUnique({ where: { id } });
  if (!s) throw new NotFoundError("item");
  if (s.pausedAt) return { skipped: "paused" as const };
  await t.knowledgeSource.update({ where: { id }, data: { status: "PENDING", lastVerifiedAt: new Date() } });
  await enqueue("knowledge.ingest", { ...scope, sourceId: id }, { ...scope, dedupeKey: `knowledge.ingest:${id}:${Date.now()}` });
  return { skipped: null };
}

/** Source detail: raw excerpt, parsed documents, extracted entities (by source link), paginated chunks. */
export async function sourceDetail(scope: TenantScope, id: string, chunkPage = 1) {
  const t = tenantDb(scope);
  const s = await t.knowledgeSource.findUnique({ where: { id } });
  if (!s) return null;
  const take = 10;
  const [documents, chunks, chunkTotal, facts, faqs, objections, offerings, imports] = await Promise.all([
    t.knowledgeDocument.findMany({ where: { sourceId: id }, select: { id: true, title: true, url: true, createdAt: true }, take: 20 }),
    t.knowledgeChunk.findMany({ where: { sourceId: id }, orderBy: [{ documentId: "asc" }, { index: "asc" }], skip: (chunkPage - 1) * take, take, select: { id: true, index: true, content: true, tokenCount: true } }),
    t.knowledgeChunk.count({ where: { sourceId: id } }),
    t.brainFact.findMany({ where: { sourceId: id }, orderBy: { updatedAt: "desc" } }),
    t.brainFaq.findMany({ where: { sourceId: id }, orderBy: { updatedAt: "desc" } }),
    t.brainObjection.findMany({ where: { sourceId: id } }),
    t.offering.findMany({ where: { sourceId: id } }),
    t.brainImport.findMany({ where: { sourceId: id }, select: { id: true, kind: true, status: true, error: true, createdAt: true } }),
  ]);
  const language = s.language ?? detectLanguage(chunks.map((c) => c.content).join(" "));
  return {
    source: { id: s.id, type: s.type, title: s.title, url: s.url, status: s.status, error: s.error, health: sourceHealth(s), lastSync: s.lastSyncedAt?.toISOString() ?? null, language, summary: ((s.metadata as { summary?: string }) ?? {}).summary ?? null, raw: s.rawText?.slice(0, 3000) ?? null, usedBy: USED_BY[s.type] ?? [] },
    documents,
    chunks: { rows: chunks, total: chunkTotal, page: chunkPage, pages: Math.max(1, Math.ceil(chunkTotal / take)) },
    extracted: { facts, faqs, objections, offerings },
    errors: [s.error, ...imports.map((i) => i.error)].filter(Boolean) as string[],
  };
}
