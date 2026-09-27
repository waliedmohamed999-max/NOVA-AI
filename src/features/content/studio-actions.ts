"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { adaptForPlatforms, applyVersion, checkCurrentVersion, improveContent, proposeWeek, weekProposalSchema } from "@/server/studio/content";
import { requestImage, selectAsset } from "@/server/studio/images";
import { startRun } from "@/server/agents/runtime";
import { CONTENT_PLAN_STEPS } from "@/server/agents/workflows/content";
import { signedFileUrl } from "@/server/storage";
import { QUALITY_DIMENSIONS } from "@/server/studio/context";

const scopeOf = (ctx: { organization: { id: string }; workspace: { id: string } }) => ({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
const refresh = (id?: string) => {
  revalidatePath("/content");
  if (id) revalidatePath(`/content/${id}`);
};

/** "Improve content" → a suggestion to compare; nothing is saved yet. */
export const improveAction = tenantAction(
  { name: "studio.improve", permission: "content:create", rateLimit: 10 },
  z.object({ id: z.string(), instruction: z.string().trim().max(500).optional() }),
  async ({ id, instruction }, ctx) => improveContent(scopeOf(ctx), id, { instruction }),
);

const qualitySchema = z.array(z.object({ dimension: z.enum(QUALITY_DIMENSIONS), status: z.enum(["good", "needs_attention"]), reason: z.string().max(240) })).max(6);

/** Use / merge / edit a suggestion → a new content version (the original stays in history). */
export const applyVersionAction = tenantAction(
  { name: "studio.apply", permission: "content:create", rateLimit: 30 },
  z.object({
    id: z.string(),
    fields: z.object({ hook: z.string().max(300).nullable(), caption: z.string().min(1).max(2200), cta: z.string().max(200).nullable(), hashtags: z.array(z.string().max(60)).max(15) }),
    source: z.enum(["ai_improve", "ai_merge", "ai_edit", "manual"]),
    reasons: z.array(z.string().max(220)).max(3).optional(),
    platformNotes: z.string().max(400).nullable().optional(),
    visualDirection: z.string().max(600).nullable().optional(),
    quality: qualitySchema.nullable().optional(),
    promptVersion: z.string().max(60).nullable().optional(),
  }),
  async ({ id, fields, source, ...meta }, ctx) => {
    const version = await applyVersion(scopeOf(ctx), id, fields, { source, ...meta }, { userId: ctx.user.id });
    refresh(id);
    return { version };
  },
);

export const adaptAction = tenantAction(
  { name: "studio.adapt", permission: "content:create", rateLimit: 6 },
  z.object({ id: z.string(), platforms: z.array(z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "TIKTOK"])).min(1).max(3) }),
  async ({ id, platforms }, ctx) => {
    const ids = await adaptForPlatforms(scopeOf(ctx), id, platforms, { userId: ctx.user.id });
    refresh(id);
    return { ids };
  },
);

export const qualityAction = tenantAction({ name: "studio.quality", permission: "content:create", rateLimit: 20 }, z.object({ id: z.string() }), async ({ id }, ctx) => ({ checks: await checkCurrentVersion(scopeOf(ctx), id) }));

/** "Create design" / variants / AI edit → queued job; the caption is never touched. */
export const generateImageAction = tenantAction(
  { name: "studio.image", permission: "content:create", rateLimit: 12 },
  z.object({
    id: z.string(),
    mode: z.enum(["brand_template", "ai_creative"]).optional(),
    quality: z.enum(["fast", "quality"]).optional(),
    preset: z.enum(["square", "portrait", "story", "landscape", "facebook_landscape"]).optional(),
    variant: z.enum(["another", "different_style", "simpler", "more_professional", "no_text"]).optional(),
    instruction: z.string().trim().min(3).max(500).optional(),
    parentAssetId: z.string().optional(),
  }),
  async ({ id, ...opts }, ctx) => {
    const asset = await requestImage(scopeOf(ctx), ctx.user.id, id, opts);
    refresh(id);
    return { assetId: asset.id };
  },
);

/** Polling for the design panel: statuses + signed URLs, never prompts or storage keys. */
export const assetsAction = tenantAction({ name: "studio.assets", permission: "workspace:read", rateLimit: 240 }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  const assets = await ctx.db.contentAsset.findMany({ where: { contentItemId: id, kind: "IMAGE" }, orderBy: { createdAt: "desc" }, take: 24 });
  return {
    assets: assets.map((a) => ({
      id: a.id,
      status: a.status,
      mode: a.mode,
      quality: a.quality,
      preset: a.preset,
      variant: a.variant,
      instruction: a.instruction,
      parentAssetId: a.parentAssetId,
      isSelected: a.isSelected,
      errorCode: a.errorCode,
      ai: Boolean(a.provider),
      url: a.status === "COMPLETED" && a.fileId ? signedFileUrl(a.fileId) : (a.url ?? null),
      createdAt: a.createdAt.toISOString(),
    })),
  };
});

export const selectAssetAction = tenantAction({ name: "studio.select_asset", permission: "content:create" }, z.object({ id: z.string(), assetId: z.string() }), async ({ id, assetId }, ctx) => {
  await selectAsset(scopeOf(ctx), assetId);
  refresh(id);
  return { ok: true };
});

/** "Plan next week": a proposal first; nothing is created until the user confirms. */
export const proposeWeekAction = tenantAction(
  { name: "studio.propose_week", permission: "content:create", rateLimit: 6 },
  z.object({ topic: z.string().trim().max(200).optional(), count: z.number().int().min(3).max(7).optional() }),
  async (input, ctx) => proposeWeek(scopeOf(ctx), input),
);

export const createWeekAction = tenantAction(
  { name: "studio.create_week", permission: "content:create", rateLimit: 5 },
  z.object({ proposal: z.array(weekProposalSchema.shape.days.element).min(1).max(7), withDesigns: z.boolean(), startDate: z.string().datetime().optional() }),
  async ({ proposal, withDesigns, startDate }, ctx) => {
    const run = await startRun(scopeOf(ctx), {
      kind: "content_plan",
      agent: "CONTENT_STRATEGIST",
      steps: CONTENT_PLAN_STEPS,
      input: `Create the approved plan: ${proposal.length} posts`,
      params: { count: proposal.length, proposal, withDesigns, startDate },
      requestedById: ctx.user.id,
    });
    return { runId: run.id };
  },
);

// ── Carousel (per-slide history) ──

const slideIn = z.object({ headline: z.string().trim().min(1).max(90), body: z.string().trim().max(280), visualDirection: z.string().trim().max(300) });

export const generateCarouselAction = tenantAction(
  { name: "studio.carousel", permission: "content:create", rateLimit: 10 },
  z.object({ id: z.string(), topic: z.string().trim().max(300).optional(), slides: z.number().int().min(3).max(10) }),
  async ({ id, topic, slides }, ctx) => {
    const { generateCarousel } = await import("@/server/studio/carousel");
    const r = await generateCarousel(scopeOf(ctx), id, { topic, slideCount: slides, userId: ctx.user.id });
    refresh(id);
    return { outline: r.outline, count: r.slides.length };
  },
);

export const regenerateSlideAction = tenantAction(
  { name: "studio.slide_regen", permission: "content:create", rateLimit: 20 },
  z.object({ slideId: z.string(), instruction: z.string().trim().max(300).optional() }),
  async ({ slideId, instruction }, ctx) => {
    const { regenerateSlide } = await import("@/server/studio/carousel");
    const s = await regenerateSlide(scopeOf(ctx), slideId, { instruction, userId: ctx.user.id });
    refresh(s.contentItemId);
    return { version: s.version };
  },
);

export const editSlideAction = tenantAction({ name: "studio.slide_edit", permission: "content:create", rateLimit: 60 }, z.object({ slideId: z.string(), slide: slideIn }), async ({ slideId, slide }, ctx) => {
  const { editSlide } = await import("@/server/studio/carousel");
  const s = await editSlide(scopeOf(ctx), slideId, slide, ctx.user.id);
  refresh(s.contentItemId);
  return { version: s.version };
});

export const restoreSlideAction = tenantAction({ name: "studio.slide_restore", permission: "content:create" }, z.object({ slideId: z.string(), version: z.number().int().min(1) }), async ({ slideId, version }, ctx) => {
  const { restoreSlide } = await import("@/server/studio/carousel");
  const s = await restoreSlide(scopeOf(ctx), slideId, version, ctx.user.id);
  refresh(s.contentItemId);
  return { version: s.version };
});

export const renderCarouselAction = tenantAction({ name: "studio.carousel_render", permission: "content:create", rateLimit: 20 }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  const { renderCarouselPreview } = await import("@/server/studio/carousel");
  const r = await renderCarouselPreview(scopeOf(ctx), id, ctx.user.id);
  refresh(id);
  return { warnings: r.warnings };
});

// ── Reels / short video plan (no video generation) ──

export const generateVideoPlanAction = tenantAction(
  { name: "studio.video_plan", permission: "content:create", rateLimit: 10 },
  z.object({ id: z.string(), durationSec: z.number().int().min(7).max(90).optional() }),
  async ({ id, durationSec }, ctx) => {
    const { generateVideoPlan } = await import("@/server/studio/video");
    const plan = await generateVideoPlan(scopeOf(ctx), id, { durationSec, userId: ctx.user.id });
    refresh(id);
    return { scenes: plan.scenes.length, durationSec: plan.durationSec };
  },
);

export const renderReelCoverAction = tenantAction({ name: "studio.reel_cover", permission: "content:create", rateLimit: 20 }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  const { renderReelCover } = await import("@/server/studio/video");
  const r = await renderReelCover(scopeOf(ctx), id, ctx.user.id);
  refresh(id);
  return r;
});
