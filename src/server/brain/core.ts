import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { redact } from "../security/redact";
import {
  BRAIN_ENTITIES,
  CONTENT_FIELDS,
  isCriticalCategory,
  PROFILE_FIELDS,
  SALES_FIELDS,
  SOURCE_TRUST,
  type BrainEntityType,
  type FieldDef,
  type SourceKind,
} from "@/lib/brain-fields";

/**
 * Company Brain core: structured entities, the facts layer (provenance + trust + approval) and the
 * edit history. Everything goes through tenantDb — organization + workspace scoped by construction.
 */

type Actor = { userId: string | null };
type Delegate = {
  findUnique(a: unknown): Promise<Record<string, unknown> | null>;
  create(a: unknown): Promise<Record<string, unknown>>;
  update(a: unknown): Promise<Record<string, unknown>>;
  delete(a: unknown): Promise<unknown>;
};

// ── Edit history ──

export async function recordRevision(
  scope: TenantScope,
  r: { entityType: string; entityId: string; action: "create" | "update" | "delete" | "approve" | "reject"; before?: unknown; after?: unknown; sourceKind?: string; actorId?: string | null },
) {
  const clean = (v: unknown) => (v == null ? Prisma.DbNull : (JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))) as Prisma.InputJsonValue));
  await tenantDb(scope).brainRevision.create({
    data: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      before: clean(r.before),
      after: clean(r.after),
      sourceKind: r.sourceKind ?? "manual",
      actorId: r.actorId ?? null,
    },
  });
}

/** Only the fields that changed (before/after pairs stay small). */
function diff(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after[k] ?? null)) {
      b[k] = before?.[k] ?? null;
      a[k] = after[k];
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}

// ── Field validation (from the shared definitions) ──

function zodFor(fields: FieldDef[], partial = false) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    let s: z.ZodType;
    if (f.kind === "list") s = z.array(z.string().trim().min(1).max(f.max ?? 300)).max(30);
    else if (f.kind === "select") s = z.enum(f.options as [string, ...string[]]);
    else {
      const str = z.string().trim().max(f.max ?? 2000);
      s = f.required ? str.min(1) : str.transform((v) => v || null).nullable();
    }
    shape[f.name] = partial || !f.required ? s.optional() : s;
  }
  return z.object(shape).strict();
}

// ── Entities ──

const HAS_SOURCE_KIND = new Set<BrainEntityType>(["faq", "objection", "competitor", "offering"]);

export async function saveEntity(scope: TenantScope, type: BrainEntityType, input: { id?: string; data: Record<string, unknown> }, actor: Actor, sourceKind: SourceKind = "manual") {
  const def = BRAIN_ENTITIES[type];
  const data = zodFor([...def.fields], Boolean(input.id)).parse(input.data) as Record<string, unknown>;
  const t = tenantDb(scope) as unknown as Record<string, Delegate>;
  const delegate = t[def.model];
  if (type === "offering" && typeof data.status === "string") data.isActive = data.status === "active";
  // "from 8,000 SAR" → 800000 cents, so "highest-value products" is computed locally (null if no number).
  if (type === "offering" && "priceText" in data) {
    const n = typeof data.priceText === "string" ? Number(data.priceText.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).match(/\d[\d,.]*/)?.[0]?.replace(/,/g, "")) : NaN;
    data.priceCents = Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  if ("currency" in data && typeof data.currency === "string") data.currency = data.currency.toUpperCase();
  if (input.id) {
    const before = await delegate.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundError("item");
    const updated = await delegate.update({ where: { id: input.id }, data: { ...data, ...("updatedById" in before ? { updatedById: actor.userId } : {}) } });
    const d = diff(before, data);
    if (d.changed) await recordRevision(scope, { entityType: type, entityId: input.id, action: "update", before: d.before, after: d.after, sourceKind, actorId: actor.userId });
    return updated;
  }
  const extra: Record<string, unknown> = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  if (HAS_SOURCE_KIND.has(type)) extra.sourceKind = sourceKind;
  if (type !== "offering") extra.updatedById = actor.userId;
  const created = await delegate.create({ data: { ...data, ...extra } });
  await recordRevision(scope, { entityType: type, entityId: String(created.id), action: "create", after: data, sourceKind, actorId: actor.userId });
  return created;
}

export async function setEntityStatus(scope: TenantScope, type: BrainEntityType, id: string, status: "approved" | "rejected", actor: Actor) {
  const def = BRAIN_ENTITIES[type];
  if (!("approvable" in def && def.approvable)) throw new UserFacingError("validation");
  const delegate = (tenantDb(scope) as unknown as Record<string, Delegate>)[def.model];
  const before = await delegate.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("item");
  await delegate.update({ where: { id }, data: { status } });
  await recordRevision(scope, { entityType: type, entityId: id, action: status === "approved" ? "approve" : "reject", before: { status: before.status }, after: { status }, actorId: actor.userId });
}

export async function deleteEntity(scope: TenantScope, type: BrainEntityType, id: string, actor: Actor) {
  const delegate = (tenantDb(scope) as unknown as Record<string, Delegate>)[BRAIN_ENTITIES[type].model];
  const before = await delegate.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("item");
  await delegate.delete({ where: { id } });
  await recordRevision(scope, { entityType: type, entityId: id, action: "delete", before, actorId: actor.userId });
}

// ── Single-record sections: profile / sales knowledge / content knowledge ──

export async function saveProfile(scope: TenantScope, input: Record<string, unknown>, actor: Actor, sourceKind: SourceKind = "manual") {
  const data = zodFor(PROFILE_FIELDS, true).parse(input) as Record<string, unknown>;
  const t = tenantDb(scope);
  const before = await t.companyProfile.findFirst();
  if (!before) throw new NotFoundError("item");
  const d = diff(before as unknown as Record<string, unknown>, data);
  if (!d.changed) return before;
  // Per-field provenance: which source set it, when and who.
  const now = new Date().toISOString();
  const sources = { ...((before.fieldSources as Record<string, unknown>) ?? {}) };
  for (const k of Object.keys(d.after)) sources[k] = { source: sourceKind, at: now, by: actor.userId };
  const updated = await t.companyProfile.update({ where: { id: before.id }, data: { ...(data as Prisma.CompanyProfileUpdateInput), fieldSources: sources as Prisma.InputJsonValue, ...(typeof data.description === "string" && !before.summary ? { summary: data.description } : {}) } });
  await recordRevision(scope, { entityType: "profile", entityId: before.id, action: "update", before: d.before, after: d.after, sourceKind, actorId: actor.userId });
  return updated;
}

export async function saveSalesKnowledge(scope: TenantScope, input: Record<string, unknown>, actor: Actor) {
  const data = zodFor(SALES_FIELDS, true).parse(input) as Record<string, unknown>;
  const t = tenantDb(scope);
  const before = await t.salesKnowledge.findFirst();
  const row = before
    ? await t.salesKnowledge.update({ where: { id: before.id }, data: { ...data, updatedById: actor.userId } })
    : await t.salesKnowledge.create({ data: { ...(data as object), organizationId: scope.organizationId, workspaceId: scope.workspaceId, updatedById: actor.userId } });
  const d = diff(before as unknown as Record<string, unknown> | null, data);
  if (d.changed) await recordRevision(scope, { entityType: "sales", entityId: row.id, action: before ? "update" : "create", before: d.before, after: d.after, actorId: actor.userId });
  return row;
}

export async function saveContentKnowledge(scope: TenantScope, input: Record<string, unknown>, actor: Actor) {
  const data = zodFor(CONTENT_FIELDS, true).parse(input) as Record<string, unknown>;
  const t = tenantDb(scope);
  const { contentPillars, ...brand } = data;
  const [kit, profile] = await Promise.all([t.brandKit.findFirst(), t.companyProfile.findFirst()]);
  if (!kit || !profile) throw new NotFoundError("item");
  const d = diff({ ...(kit as unknown as Record<string, unknown>), contentPillars: profile.contentPillars }, data);
  if (!d.changed) return;
  if (Object.keys(brand).length) await t.brandKit.update({ where: { id: kit.id }, data: brand as Prisma.BrandKitUpdateInput });
  if (contentPillars) await t.companyProfile.update({ where: { id: profile.id }, data: { contentPillars: contentPillars as string[] } });
  await recordRevision(scope, { entityType: "content", entityId: kit.id, action: "update", before: d.before, after: d.after, actorId: actor.userId });
}

// ── Facts: key → value with provenance, trust and approval ──

export type FactInput = { key: string; value: string; category: string; sourceKind: SourceKind; sourceId?: string | null; confidence?: number };

const factKey = z.string().trim().min(2).max(120).regex(/^[\p{L}\p{N}_.:-]+$/u);

/**
 * Upserts a fact. A lower-trust source never overwrites an approved higher-trust fact (e.g. an AI
 * inference can't replace what the owner typed). Critical categories from any non-manual source
 * start as "pending" and are not used by agents until approved.
 */
export async function upsertFact(scope: TenantScope, f: FactInput, actor: Actor) {
  const key = factKey.parse(f.key.toLowerCase());
  const value = redact(f.value.trim(), 2000) ?? "";
  if (!value) throw new UserFacingError("validation");
  const t = tenantDb(scope);
  const critical = isCriticalCategory(f.category);
  const status = f.sourceKind === "manual" ? "approved" : critical || f.sourceKind === "ai" ? "pending" : "approved";
  const existing = await t.brainFact.findFirst({ where: { key } });
  if (existing && existing.status === "approved" && SOURCE_TRUST[existing.sourceKind as SourceKind] > SOURCE_TRUST[f.sourceKind]) {
    return { fact: existing, skipped: "lower_trust" as const };
  }
  const data = { value, category: f.category, sourceKind: f.sourceKind, sourceId: f.sourceId ?? null, confidence: f.confidence ?? (f.sourceKind === "ai" ? 0.6 : 1), status, critical, verifiedAt: f.sourceKind === "manual" ? new Date() : null, updatedById: actor.userId };
  const fact = existing ? await t.brainFact.update({ where: { id: existing.id }, data }) : await t.brainFact.create({ data: { ...data, key, organizationId: scope.organizationId, workspaceId: scope.workspaceId } });
  await recordRevision(scope, { entityType: "fact", entityId: fact.id, action: existing ? "update" : "create", before: existing ? { value: existing.value, sourceKind: existing.sourceKind, status: existing.status } : null, after: { key, value, sourceKind: f.sourceKind, status }, sourceKind: f.sourceKind, actorId: actor.userId });
  return { fact, skipped: null };
}

export async function decideFact(scope: TenantScope, id: string, decision: "approved" | "rejected", actor: Actor, editedValue?: string) {
  const t = tenantDb(scope);
  const fact = await t.brainFact.findUnique({ where: { id } });
  if (!fact) throw new NotFoundError("item");
  const value = editedValue?.trim() ? (redact(editedValue.trim(), 2000) ?? fact.value) : fact.value;
  await t.brainFact.update({ where: { id }, data: { status: decision, value, verifiedAt: decision === "approved" ? new Date() : fact.verifiedAt, updatedById: actor.userId } });
  await recordRevision(scope, { entityType: "fact", entityId: id, action: decision === "approved" ? "approve" : "reject", before: { status: fact.status, value: fact.value }, after: { status: decision, value }, actorId: actor.userId });
}

/** Revisions for one entity (or the latest across the brain), newest first. */
export function revisions(scope: TenantScope, opts: { entityType?: string; entityId?: string; take?: number } = {}) {
  return db.brainRevision.findMany({
    where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, ...(opts.entityType ? { entityType: opts.entityType } : {}), ...(opts.entityId ? { entityId: opts.entityId } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 20,
  });
}
