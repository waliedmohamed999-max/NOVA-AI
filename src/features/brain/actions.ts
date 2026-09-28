"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { UserFacingError } from "@/server/errors";
import { BRAIN_ENTITY_TYPES, STRATEGY_TYPES } from "@/lib/brain-fields";
import { decideFact, deleteEntity, revisions, saveContentKnowledge, saveEntity, saveProfile, saveSalesKnowledge, setEntityStatus, upsertFact } from "@/server/brain/core";
import { applyImport, createFileImport, createUrlImport, previewCustomers } from "@/server/brain/imports";
import { refreshSegmentSizes, sizeSegment, suggestSegments, type SegmentCriteria } from "@/server/brain/customers";
import { draftStrategy, saveAnswer, setStrategyStatus } from "@/server/brain/strategy";
import { analyzeCompetitors, importCompetitor } from "@/server/brain/competitors";
import { refreshSource, setSourcePaused } from "@/server/brain/sources";
import { searchBrain } from "@/server/brain/search";
import { IMPORT_FIELDS } from "@/server/sales/intelligence";
import type { TenantContext } from "@/server/context";

const scopeOf = (ctx: TenantContext) => ({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
const actor = (ctx: TenantContext) => ({ userId: ctx.user.id });
const locale = (ctx: TenantContext) => (ctx.organization.locale === "ar" ? ("ar" as const) : ("en" as const));
const refresh = () => revalidatePath("/knowledge");
const MANAGE = "knowledge:manage" as const;
/** Approving critical knowledge (pricing, policies, strategy) is a manager decision. */
const APPROVE = "content:approve" as const;

const entityType = z.enum(BRAIN_ENTITY_TYPES as [string, ...string[]]);

export const saveEntityAction = tenantAction({ name: "brain.entity_save", permission: MANAGE, rateLimit: 120 }, z.object({ type: entityType, id: z.string().max(40).optional(), data: z.record(z.string(), z.unknown()) }), async ({ type, id, data }, ctx) => {
  const row = await saveEntity(scopeOf(ctx), type as never, { id, data }, actor(ctx));
  refresh();
  return { id: String(row.id) };
});

export const entityStatusAction = tenantAction({ name: "brain.entity_status", permission: APPROVE, rateLimit: 120 }, z.object({ type: entityType, id: z.string().max(40), status: z.enum(["approved", "rejected"]) }), async ({ type, id, status }, ctx) => {
  await setEntityStatus(scopeOf(ctx), type as never, id, status, actor(ctx));
  refresh();
  return { ok: true };
});

export const deleteEntityAction = tenantAction({ name: "brain.entity_delete", permission: MANAGE, rateLimit: 60 }, z.object({ type: entityType, id: z.string().max(40) }), async ({ type, id }, ctx) => {
  await deleteEntity(scopeOf(ctx), type as never, id, actor(ctx));
  refresh();
  return { ok: true };
});

const record = z.record(z.string(), z.unknown());
export const saveProfileAction = tenantAction({ name: "brain.profile_save", permission: MANAGE, rateLimit: 60 }, record, async (data, ctx) => {
  await saveProfile(scopeOf(ctx), data, actor(ctx));
  refresh();
  return { ok: true };
});
export const saveSalesAction = tenantAction({ name: "brain.sales_save", permission: MANAGE, rateLimit: 60 }, record, async (data, ctx) => {
  await saveSalesKnowledge(scopeOf(ctx), data, actor(ctx));
  refresh();
  return { ok: true };
});
export const saveContentAction = tenantAction({ name: "brain.content_save", permission: MANAGE, rateLimit: 60 }, record, async (data, ctx) => {
  await saveContentKnowledge(scopeOf(ctx), data, actor(ctx));
  refresh();
  revalidatePath("/brand");
  return { ok: true };
});

// ── Facts ──
export const addFactAction = tenantAction({ name: "brain.fact_add", permission: MANAGE, rateLimit: 60 }, z.object({ key: z.string().max(120), value: z.string().trim().min(1).max(2000), category: z.string().trim().min(2).max(40) }), async (f, ctx) => {
  const r = await upsertFact(scopeOf(ctx), { ...f, sourceKind: "manual" }, actor(ctx));
  refresh();
  return { id: r.fact.id };
});
export const decideFactAction = tenantAction({ name: "brain.fact_decide", permission: APPROVE, rateLimit: 120 }, z.object({ id: z.string().max(40), decision: z.enum(["approved", "rejected"]), value: z.string().max(2000).optional() }), async ({ id, decision, value }, ctx) => {
  await decideFact(scopeOf(ctx), id, decision, actor(ctx), value);
  refresh();
  return { ok: true };
});

// ── Questions & strategy ──
export const answerQuestionAction = tenantAction({ name: "brain.answer", permission: MANAGE, rateLimit: 60 }, z.object({ key: z.string().max(40), value: z.string().trim().min(1).max(2000) }), async ({ key, value }, ctx) => {
  await saveAnswer(scopeOf(ctx), key, value, actor(ctx));
  refresh();
  return { ok: true };
});
export const draftStrategyAction = tenantAction({ name: "brain.strategy_draft", permission: MANAGE, rateLimit: 6 }, z.object({ type: z.enum(STRATEGY_TYPES), fromData: z.boolean().default(false) }), async ({ type, fromData }, ctx) => {
  const s = await draftStrategy(scopeOf(ctx), actor(ctx), { type, fromData, locale: locale(ctx) });
  refresh();
  return { id: s.id, generatedBy: s.generatedBy };
});
export const strategyStatusAction = tenantAction({ name: "brain.strategy_status", permission: MANAGE, rateLimit: 60 }, z.object({ id: z.string().max(40), status: z.enum(["DRAFT", "REVIEW", "APPROVED", "ARCHIVED"]) }), async ({ id, status }, ctx) => {
  if (status === "APPROVED" && !ctx.can(APPROVE)) throw new UserFacingError("forbidden");
  await setStrategyStatus(scopeOf(ctx), id, status, actor(ctx));
  refresh();
  return { ok: true };
});

// ── Imports ──
export const importFileAction = tenantAction({ name: "brain.import_file", permission: MANAGE, rateLimit: 10 }, z.object({ fileId: z.string().max(40) }), async ({ fileId }, ctx) => {
  const imp = await createFileImport(scopeOf(ctx), actor(ctx), fileId);
  refresh();
  return { id: imp.id };
});
export const importUrlAction = tenantAction({ name: "brain.import_url", permission: MANAGE, rateLimit: 10 }, z.object({ kind: z.enum(["website", "store"]), url: z.string().trim().min(3).max(500) }), async ({ kind, url }, ctx) => {
  const imp = await createUrlImport(scopeOf(ctx), actor(ctx), kind, url);
  refresh();
  return { id: imp.id };
});
export const importStatusAction = tenantAction({ name: "brain.import_status", permission: "workspace:read", rateLimit: 300 }, z.object({ id: z.string().max(40) }), async ({ id }, ctx) => {
  const imp = await ctx.db.brainImport.findUnique({ where: { id } });
  if (!imp) throw new UserFacingError("item_not_found");
  return { id: imp.id, kind: imp.kind, status: imp.status, title: imp.title, error: imp.error, preview: imp.preview, candidates: imp.candidates, mapping: imp.mapping, stats: imp.stats };
});
const mapping = z.record(z.string(), z.enum(IMPORT_FIELDS).nullable());
export const previewCustomersAction = tenantAction({ name: "brain.import_preview", permission: MANAGE, rateLimit: 30 }, z.object({ id: z.string().max(40), mapping }), async ({ id, mapping: m }, ctx) => previewCustomers(scopeOf(ctx), id, m));
export const applyImportAction = tenantAction({ name: "brain.import_apply", permission: MANAGE, rateLimit: 10 }, z.object({ id: z.string().max(40), selectedIds: z.array(z.string().max(60)).max(500).optional(), mapping: mapping.optional() }), async ({ id, selectedIds, mapping: m }, ctx) => {
  const r = await applyImport(scopeOf(ctx), actor(ctx), id, { selectedIds, mapping: m, locale: locale(ctx) });
  refresh();
  revalidatePath("/sales");
  return r;
});

// ── Customers ──
export const suggestSegmentsAction = tenantAction({ name: "brain.segments_suggest", permission: MANAGE, rateLimit: 10 }, z.object({}), async (_, ctx) => {
  const r = await suggestSegments(scopeOf(ctx), locale(ctx));
  await refreshSegmentSizes(scopeOf(ctx));
  refresh();
  return r;
});
const criteria = z.object({ city: z.string().max(120).optional(), country: z.string().max(80).optional(), minOrders: z.number().int().min(0).max(100000).optional(), maxOrders: z.number().int().min(0).max(100000).optional(), minSpendCents: z.number().int().min(0).optional(), category: z.string().max(120).optional(), tag: z.string().max(60).optional(), source: z.string().max(80).optional(), b2b: z.boolean().optional() }).strict();
export const segmentCriteriaAction = tenantAction({ name: "brain.segment_criteria", permission: MANAGE, rateLimit: 60 }, z.object({ id: z.string().max(40), criteria }), async ({ id, criteria: c }, ctx) => {
  const size = await sizeSegment(scopeOf(ctx), c as SegmentCriteria);
  await ctx.db.customerSegment.update({ where: { id }, data: { criteria: c, size, sizedAt: new Date() } });
  refresh();
  return { size };
});

// ── Competitors ──
export const competitorUrlAction = tenantAction({ name: "brain.competitor_url", permission: MANAGE, rateLimit: 10 }, z.object({ url: z.string().trim().min(3).max(500) }), async ({ url }, ctx) => {
  const c = await importCompetitor(scopeOf(ctx), actor(ctx), url);
  refresh();
  return { id: c.id };
});
export const analyzeCompetitorsAction = tenantAction({ name: "brain.competitor_analysis", permission: "workspace:read", rateLimit: 6 }, z.object({}), async (_, ctx) => analyzeCompetitors(scopeOf(ctx), locale(ctx)));

// ── Sources ──
export const sourcePauseAction = tenantAction({ name: "brain.source_pause", permission: MANAGE, rateLimit: 60 }, z.object({ id: z.string().max(40), paused: z.boolean() }), async ({ id, paused }, ctx) => {
  await setSourcePaused(scopeOf(ctx), id, paused, actor(ctx));
  refresh();
  return { ok: true };
});
export const sourceRefreshAction = tenantAction({ name: "brain.source_refresh", permission: MANAGE, rateLimit: 10 }, z.object({ id: z.string().max(40) }), async ({ id }, ctx) => {
  const r = await refreshSource(scopeOf(ctx), id);
  refresh();
  return r;
});

// ── Search & history ──
export const searchBrainAction = tenantAction({ name: "brain.search", permission: "workspace:read", rateLimit: 120 }, z.object({ q: z.string().max(120) }), async ({ q }, ctx) => searchBrain(scopeOf(ctx), q));
export const revisionsAction = tenantAction({ name: "brain.revisions", permission: "workspace:read", rateLimit: 120 }, z.object({ entityType: z.string().max(40), entityId: z.string().max(40) }), async (i, ctx) => {
  const rows = await revisions(scopeOf(ctx), i);
  const users = await ctx.db.organizationMember.findMany({ where: { userId: { in: rows.map((r) => r.actorId).filter(Boolean) as string[] } }, select: { userId: true, user: { select: { name: true, email: true } } } });
  return rows.map((r) => ({ id: r.id, action: r.action, before: r.before, after: r.after, sourceKind: r.sourceKind, at: r.createdAt.toISOString(), by: users.find((u) => u.userId === r.actorId)?.user.name ?? users.find((u) => u.userId === r.actorId)?.user.email ?? null }));
});
