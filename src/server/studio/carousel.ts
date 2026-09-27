import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { aiStructured, toUserFacing } from "../ai";
import { STUDIO_RULES, arabicGuide, promptRef } from "../ai/prompts";
import { UserFacingError } from "../errors";
import { audit } from "../audit";
import { deleteFile, saveUpload, signedFileUrl, storage } from "../storage";
import { renderTemplate } from "../design/templates";
import { contextBlock, studioContext } from "./context";
import { requireContentAi } from "./content";

/**
 * Carousel generation: topic → outline → slides (headline + body + visual direction per slide) →
 * brand template → preview → approve (the content item's normal approval). Each slide keeps its own
 * history, so one slide can be rewritten or restored without touching the others.
 */
export const MIN_SLIDES = 3;
export const MAX_SLIDES = 10;

const slideSchema = z.object({
  headline: z.string().min(1).max(90),
  body: z.string().max(280),
  visualDirection: z.string().max(300),
});
export const carouselSchema = z.object({
  outline: z.array(z.string()).min(MIN_SLIDES).max(MAX_SLIDES),
  slides: z.array(slideSchema).min(MIN_SLIDES).max(MAX_SLIDES),
  caption: z.string(),
  cta: z.string(),
});
type SlideDraft = z.infer<typeof slideSchema>;
export type SlideHistoryEntry = SlideDraft & { version: number; at: string; source: "ai" | "manual" | "restore"; promptVersion?: string };

/** A slide's rendered preview is derived data: drop the old file whenever the slide changes. */
async function dropPreview(scope: TenantScope, assetId: string | null) {
  if (assetId) await deleteFile(scope.organizationId, assetId).catch(() => undefined);
}

const ai = (scope: TenantScope) => ({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "CONTENT_STRATEGIST" as const });

async function carouselItem(scope: TenantScope, id: string) {
  const item = await db.contentItem.findFirst({ where: { id, ...scope } });
  if (!item) throw new UserFacingError("content_not_found");
  if (item.format !== "CAROUSEL") throw new UserFacingError("invalid_transition");
  if (item.status === "PUBLISHED" || item.status === "PUBLISHING") throw new UserFacingError("invalid_transition");
  return item;
}

export async function listSlides(scope: TenantScope, contentItemId: string) {
  const slides = await tenantDb(scope).carouselSlide.findMany({ where: { contentItemId }, orderBy: { position: "asc" } });
  return slides.map((s) => ({ ...s, previewUrl: s.assetId ? signedFileUrl(s.assetId) : null, history: (s.history as SlideHistoryEntry[]) ?? [] }));
}

/** Generates (or regenerates) the whole carousel. Replaces existing slides; their history is kept on each position. */
export async function generateCarousel(scope: TenantScope, contentItemId: string, opts: { topic?: string | null; slideCount?: number; userId: string }) {
  requireContentAi();
  const item = await carouselItem(scope, contentItemId);
  const count = Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, opts.slideCount ?? 6));
  const ctx = await studioContext(scope, item);
  const ref = promptRef("carousel_generation");
  const res = await aiStructured(ai(scope), {
    task: "COPYWRITING",
    realOnly: true,
    promptRef: ref,
    schemaName: "carousel",
    schema: carouselSchema,
    system: ["You are NOVA's content team designing an educational social carousel for the company below.", STUDIO_RULES, arabicGuide(ctx.brain.locale, ctx.brain.brandKit?.tone), contextBlock(ctx)].join("\n\n"),
    prompt: [
      `Create a ${count}-slide ${item.platform} carousel${opts.topic ? ` about: ${opts.topic}` : ` for the post "${item.title}" (pillar: ${item.pillar ?? "—"})`}.`,
      `outline: exactly ${count} short lines, one per slide. slides: exactly ${count}, in the same order.`,
      "Slide 1 is the hook (a promise or a question), the middle slides deliver one idea each, the last slide is the call to action.",
      "headline: max ~8 words. body: 1–2 short sentences (may be empty on the hook slide). visualDirection: what the slide's visual should show, no text inside the image.",
      "caption: the post caption that accompanies the carousel. cta: one short, specific call to action.",
      item.caption && `Existing caption for context:\n${item.caption}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  }).catch((e) => {
    throw toUserFacing(e);
  });
  const slides = res.data.slides.slice(0, count);
  const t = tenantDb(scope);
  const now = new Date().toISOString();
  const existing = await t.carouselSlide.findMany({ where: { contentItemId } });
  for (const [i, s] of slides.entries()) {
    const position = i + 1;
    const prev = existing.find((e) => e.position === position);
    await dropPreview(scope, prev?.assetId ?? null);
    const history = [...((prev?.history as SlideHistoryEntry[]) ?? []), { ...s, version: (prev?.version ?? 0) + 1, at: now, source: "ai" as const, promptVersion: ref.version }].slice(-20);
    await t.carouselSlide.upsert({
      where: { contentItemId_position: { contentItemId, position } },
      create: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, contentItemId, position, headline: s.headline, body: s.body, visualDirection: s.visualDirection, version: 1, history: history as Prisma.InputJsonValue },
      update: { headline: s.headline, body: s.body, visualDirection: s.visualDirection, version: (prev?.version ?? 0) + 1, history: history as Prisma.InputJsonValue, assetId: null },
    });
  }
  for (const extra of existing.filter((e) => e.position > slides.length)) await dropPreview(scope, extra.assetId);
  await t.carouselSlide.deleteMany({ where: { contentItemId, position: { gt: slides.length } } });
  await audit({ ...scope, actorType: "USER", actorId: opts.userId, action: "content.carousel_generated", entityType: "ContentItem", entityId: contentItemId, summary: `Generated a ${slides.length}-slide carousel (${ref.version})` });
  return { outline: res.data.outline, caption: res.data.caption, cta: res.data.cta, slides: await listSlides(scope, contentItemId) };
}

/** Rewrites ONE slide, keeping the neighbours as context. The old version stays in that slide's history. */
export async function regenerateSlide(scope: TenantScope, slideId: string, opts: { instruction?: string | null; userId: string }) {
  requireContentAi();
  const t = tenantDb(scope);
  const slide = await t.carouselSlide.findUnique({ where: { id: slideId } });
  if (!slide) throw new UserFacingError("item_not_found");
  const item = await carouselItem(scope, slide.contentItemId);
  const all = await t.carouselSlide.findMany({ where: { contentItemId: item.id }, orderBy: { position: "asc" } });
  const ctx = await studioContext(scope, item);
  const ref = promptRef("carousel_slide");
  const res = await aiStructured(ai(scope), {
    task: "COPYWRITING",
    realOnly: true,
    promptRef: ref,
    schemaName: "carousel_slide",
    schema: slideSchema,
    system: ["You are NOVA's content team editing one slide of a carousel.", STUDIO_RULES, arabicGuide(ctx.brain.locale, ctx.brain.brandKit?.tone), contextBlock(ctx)].join("\n\n"),
    prompt: [
      `Rewrite slide ${slide.position} of ${all.length}. Keep it consistent with the other slides; don't repeat their points.`,
      `All slides:\n${all.map((s) => `${s.position}. ${s.headline} — ${s.body}`).join("\n")}`,
      `Current slide ${slide.position}: ${slide.headline} — ${slide.body}`,
      opts.instruction && `The owner asked: "${opts.instruction}"`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  }).catch((e) => {
    throw toUserFacing(e);
  });
  return saveSlide(scope, slide.id, res.data, "ai", opts.userId, ref.version);
}

export async function editSlide(scope: TenantScope, slideId: string, patch: SlideDraft, userId: string) {
  const slide = await tenantDb(scope).carouselSlide.findUnique({ where: { id: slideId } });
  if (!slide) throw new UserFacingError("item_not_found");
  await carouselItem(scope, slide.contentItemId);
  return saveSlide(scope, slideId, slideSchema.parse(patch), "manual", userId);
}

export async function restoreSlide(scope: TenantScope, slideId: string, version: number, userId: string) {
  const slide = await tenantDb(scope).carouselSlide.findUnique({ where: { id: slideId } });
  if (!slide) throw new UserFacingError("item_not_found");
  await carouselItem(scope, slide.contentItemId);
  const entry = ((slide.history as SlideHistoryEntry[]) ?? []).find((h) => h.version === version);
  if (!entry) throw new UserFacingError("item_not_found");
  return saveSlide(scope, slideId, { headline: entry.headline, body: entry.body, visualDirection: entry.visualDirection }, "restore", userId);
}

async function saveSlide(scope: TenantScope, slideId: string, s: SlideDraft, source: SlideHistoryEntry["source"], userId: string, promptVersion?: string) {
  const t = tenantDb(scope);
  const slide = await t.carouselSlide.findUniqueOrThrow({ where: { id: slideId } });
  const version = slide.version + 1;
  await dropPreview(scope, slide.assetId);
  const history = [...((slide.history as SlideHistoryEntry[]) ?? []), { ...s, version, at: new Date().toISOString(), source, promptVersion }].slice(-20);
  const updated = await t.carouselSlide.update({ where: { id: slideId }, data: { headline: s.headline, body: s.body, visualDirection: s.visualDirection, version, history: history as Prisma.InputJsonValue, assetId: null } });
  await audit({ ...scope, actorType: "USER", actorId: userId, action: `content.slide_${source}`, entityType: "ContentItem", entityId: slide.contentItemId, summary: `Slide ${slide.position} → v${version} (${source})` });
  return updated;
}

/**
 * Renders every slide with the brand template (text-only brand background — no image-generation cost)
 * and stores the PNGs as private files. Returns signed preview URLs.
 */
export async function renderCarouselPreview(scope: TenantScope, contentItemId: string, userId: string) {
  const item = await carouselItem(scope, contentItemId);
  const t = tenantDb(scope);
  const slides = await t.carouselSlide.findMany({ where: { contentItemId }, orderBy: { position: "asc" } });
  if (slides.length < MIN_SLIDES) throw new UserFacingError("validation");
  const [kit, org] = await Promise.all([db.brandKit.findFirst({ where: scope }), db.organization.findUniqueOrThrow({ where: { id: scope.organizationId }, select: { name: true } })]);
  const logoFile = kit?.logoAssetId ? await db.fileObject.findFirst({ where: { id: kit.logoAssetId, organizationId: scope.organizationId } }) : null;
  const logo = logoFile && /image\/(png|jpeg|webp)/.test(logoFile.mimeType) ? await storage.get(logoFile.storageKey).catch(() => null) : null;
  const brand = { primary: kit?.primaryColors[0] ?? "#17161c", secondary: kit?.secondaryColors[0] ?? kit?.primaryColors[1] ?? "#ffffff", logo };
  const warnings: { position: number; warnings: string[] }[] = [];
  for (const s of slides) {
    const last = s.position === slides.length;
    const { png, layout } = await renderTemplate("carousel", { headline: s.headline, body: s.body, cta: last ? item.cta : null, brandName: org.name, pageLabel: `${s.position}/${slides.length}` }, brand);
    if (layout.warnings.length) warnings.push({ position: s.position, warnings: layout.warnings });
    await dropPreview(scope, s.assetId);
    const file = await saveUpload({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId, fileName: `carousel-${item.id}-${s.position}-v${s.version}.png`, data: png, purpose: "carousel_slide" });
    await t.carouselSlide.update({ where: { id: s.id }, data: { assetId: file.id } });
  }
  return { slides: await listSlides(scope, contentItemId), warnings };
}
