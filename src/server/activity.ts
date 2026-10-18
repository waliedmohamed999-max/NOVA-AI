import type { ActorType, AuditCategory, Prisma } from "@/generated/prisma/client";
import { tenantDb, type TenantScope } from "./db/tenant";

/** The workspace's activity log (audit trail), filterable and paginated. Read-only: entries are never edited. */

export type ActivityFilters = { category?: AuditCategory | null; actor?: ActorType | null; q?: string | null; from?: Date | null; to?: Date | null; cursor?: string | null };
const PAGE = 50;

/** Where an entry's record lives in the app (null when there's nothing to open). */
export function entityHref(entityType: string | null, entityId: string | null) {
  if (!entityType || !entityId) return null;
  const map: Record<string, string> = {
    Lead: `/leads/${entityId}`,
    ContentItem: `/content/${entityId}`,
    Campaign: `/campaigns/${entityId}`,
    Conversation: `/inbox?c=${entityId}`,
    Report: `/reports/${entityId}`,
    SocialPost: `/analytics/posts/${entityId}`,
  };
  return map[entityType] ?? null;
}

export async function listActivity(scope: TenantScope, f: ActivityFilters = {}) {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (f.category) and.push({ category: f.category });
  if (f.actor) and.push({ actorType: f.actor });
  if (f.from) and.push({ createdAt: { gte: f.from } });
  if (f.to) and.push({ createdAt: { lt: new Date(f.to.getTime() + 86_400_000) } }); // inclusive end day
  const q = f.q?.trim();
  if (q) and.push({ OR: [{ summary: { contains: q, mode: "insensitive" } }, { actorLabel: { contains: q, mode: "insensitive" } }, { action: { contains: q, mode: "insensitive" } }] });
  const rows = await tenantDb(scope).auditLog.findMany({
    where: and.length ? { AND: and } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    select: { id: true, category: true, actorType: true, actorLabel: true, action: true, summary: true, entityType: true, entityId: true, ip: true, createdAt: true },
  });
  const page = rows.slice(0, PAGE);
  return { items: page.map((r) => ({ ...r, href: entityHref(r.entityType, r.entityId) })), nextCursor: rows.length > PAGE ? page[page.length - 1].id : null };
}
