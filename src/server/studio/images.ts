import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { aiStructured, logRun } from "../ai";
import { recordUsage, currentPeriod } from "../ai/budget";
import { STUDIO_RULES, promptRef } from "../ai/prompts";
import { enqueue, PermanentJobError } from "../jobs/queue";
import { deleteFile, saveUpload, storage } from "../storage";
import { UserFacingError } from "../errors";
import { logger } from "../logger";
import { reportError } from "../observability";
import { PLANS } from "@/config/plans";
import { loadBrain } from "../agents/brain";
import { composeBrandTemplate, fitToSize } from "../design/compose";
import { IMAGE_PRESETS, ImageProviderError, imageProvider, presetFor, type ImagePreset, type ImageQuality, type ImageResult } from "../design/image-provider";
import { contentAiConfigured } from "../ai";
import { visualDirectionSchema, type VisualDirection } from "./context";

export type ImageMode = "brand_template" | "ai_creative";
export type ImageVariant = "another" | "different_style" | "simpler" | "more_professional" | "no_text";

export const VARIANT_GUIDE: Record<ImageVariant, string> = {
  another: "Create another take on the same concept with a different composition.",
  different_style: "Keep the concept but use a clearly different visual style.",
  simpler: "Make it simpler and cleaner: fewer elements, more negative space.",
  more_professional: "Make it look more premium and professional: refined lighting, polished composition.",
  no_text: "Absolutely no text, letters, numbers or logos anywhere in the image.",
};

/** Monthly image allowance: generations + edits (queued and in-progress count, failed ones don't). */
export async function imageUsage(organizationId: string) {
  const [sub, used, edits, textRuns, cost] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId } }),
    db.contentAsset.count({ where: { organizationId, provider: { not: null }, status: { not: "FAILED" }, createdAt: { gte: monthStart() } } }),
    db.contentAsset.count({ where: { organizationId, provider: { not: null }, mode: "edit", status: "COMPLETED", createdAt: { gte: monthStart() } } }),
    db.aiRun.count({ where: { organizationId, status: "SUCCESS", task: { notIn: ["IMAGE_GENERATION", "IMAGE_EDIT", "EMBEDDING"] }, createdAt: { gte: monthStart() } } }),
    db.aiRun.aggregate({ where: { organizationId, createdAt: { gte: monthStart() } }, _sum: { costMicro: true } }),
  ]);
  const limit = PLANS[sub?.plan ?? "STARTER"].imageGenerationsPerMonth;
  return { period: currentPeriod(), used, limit, edits, textRuns, estimatedCostMicro: cost._sum.costMicro ?? 0n };
}

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function imagesConfigured() {
  return imageProvider().isConfigured();
}

/**
 * Queues one image (design, variant or edit) for a post. The HTTP request returns immediately;
 * the ai.image.generate job does the work. Caption, schedule and approval state are never touched.
 */
export async function requestImage(
  scope: TenantScope,
  userId: string,
  contentItemId: string,
  opts: { mode?: ImageMode; quality?: ImageQuality; preset?: ImagePreset; variant?: ImageVariant; instruction?: string | null; parentAssetId?: string | null },
) {
  if (!imagesConfigured()) throw new UserFacingError("image_not_configured");
  const item = await db.contentItem.findFirst({ where: { id: contentItemId, ...scope } });
  if (!item) throw new UserFacingError("content_not_found");
  if (item.status === "PUBLISHED" || item.status === "PUBLISHING") throw new UserFacingError("invalid_transition");
  const parent = opts.parentAssetId ? await db.contentAsset.findFirst({ where: { id: opts.parentAssetId, contentItemId, organizationId: scope.organizationId, status: "COMPLETED" } }) : null;
  if (opts.parentAssetId && !parent) throw new UserFacingError("item_not_found");
  if (opts.instruction && !parent) throw new UserFacingError("validation"); // edits need a reference image
  const usage = await imageUsage(scope.organizationId);
  if (usage.used >= usage.limit) throw new UserFacingError("image_limit");
  const settings = await db.workspaceSettings.findFirst({ where: scope });
  const mode: ImageMode | "edit" = opts.instruction ? "edit" : (opts.mode ?? (parent?.mode as ImageMode | undefined) ?? (settings?.imageMode as ImageMode) ?? "brand_template");
  const quality: ImageQuality = opts.instruction ? "quality" : (opts.quality ?? (settings?.imageQuality as ImageQuality) ?? "fast");
  const preset: ImagePreset = opts.preset ?? (parent?.preset as ImagePreset | undefined) ?? presetFor(item.platform, item.format);
  const asset = await db.contentAsset.create({
    data: {
      ...scope,
      contentItemId,
      kind: "IMAGE",
      status: "QUEUED",
      mode,
      provider: imageProvider().name,
      quality,
      preset,
      variant: opts.variant ?? null,
      instruction: opts.instruction?.slice(0, 500) ?? null,
      parentAssetId: parent?.id ?? null,
      contentVersion: item.currentVersion,
      createdById: userId,
      width: IMAGE_PRESETS[preset].width,
      height: IMAGE_PRESETS[preset].height,
      altText: item.title.slice(0, 200),
    },
  });
  // One automatic retry for transient provider errors; refusals are never retried.
  await enqueue("ai.image.generate", { assetId: asset.id, ...scope }, { ...scope, dedupeKey: `image:${asset.id}`, maxAttempts: 2 });
  return asset;
}

/** Creative direction for the designer — derived from the post, brand kit and what looked good before. */
async function creativeDirection(scope: TenantScope, item: { title: string; hook: string | null; caption: string; platform: string; format: string; designBrief: unknown }, variant?: string | null): Promise<{ direction: VisualDirection; generatedByAi: boolean }> {
  const brief = (item.designBrief ?? {}) as { concept?: string; layout?: string; visualElements?: string[]; textOnImage?: string };
  const fallback: VisualDirection = {
    concept: brief.concept ?? item.title,
    scene: [brief.concept, brief.visualElements?.join(", ")].filter(Boolean).join(". ") || item.title,
    composition: brief.layout ?? "clean, balanced composition with space for a headline",
    mood: "on-brand, warm, professional",
    headline: (brief.textOnImage ?? item.hook ?? item.title).slice(0, 90),
  };
  if (!contentAiConfigured()) return { direction: fallback, generatedByAi: false };
  const b = await loadBrain(scope);
  const past = await db.contentAsset.findMany({ where: { organizationId: scope.organizationId, status: "COMPLETED", isSelected: true, contentItem: { status: { in: ["APPROVED", "SCHEDULED", "PUBLISHED"] } } }, orderBy: { createdAt: "desc" }, take: 3, select: { prompt: true } });
  const res = await aiStructured(
    { organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "DESIGNER" },
    {
      task: "STRUCTURED",
      quality: "fast",
      realOnly: true,
      promptRef: promptRef("visual_direction"),
      schemaName: "visual_direction",
      schema: visualDirectionSchema,
      system: ["You are NOVA's art director. Turn a social post into a clear visual direction for an image model.", STUDIO_RULES].join("\n"),
      prompt: [
        `Post (${item.platform} ${item.format}): ${item.title}\nHook: ${item.hook ?? ""}\nCaption: ${item.caption.slice(0, 600)}`,
        brief.concept && `Existing design brief: ${brief.concept}. Layout: ${brief.layout ?? ""}`,
        b.brandKit?.imageStyle && `Brand image style: ${b.brandKit.imageStyle}`,
        b.brandKit?.layoutRules.length && `Layout rules: ${b.brandKit.layoutRules.join("; ")}`,
        b.brandKit?.forbiddenStyles.length && `Forbidden styles: ${b.brandKit.forbiddenStyles.join(", ")}`,
        past.length && `Visuals of recently approved posts (stay consistent, don't copy):\n${past.map((p) => `- ${(p.prompt ?? "").slice(0, 200)}`).join("\n")}`,
        variant && `Variation requested: ${VARIANT_GUIDE[variant as ImageVariant] ?? variant}`,
        `headline: at most 8 words, in ${b.locale === "ar" ? "Arabic" : "English"}, for NOVA to typeset — the image itself must contain no text.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  );
  return { direction: res.data, generatedByAi: true };
}

/** Pure prompt builder (image_generation@1) — unit tested. */
export function buildGenerationPrompt(d: VisualDirection, kit: { colors: string[]; imageStyle: string | null; forbidden: string[] }, opts: { mode: ImageMode | "edit"; variant?: string | null; preset: ImagePreset }) {
  return [
    `Social media visual (${opts.preset}).`,
    `Concept: ${d.concept}.`,
    `Scene: ${d.scene}.`,
    `Composition: ${d.composition}.`,
    `Mood: ${d.mood}.`,
    kit.colors.length ? `Use the brand palette: ${kit.colors.join(", ")}.` : null,
    kit.imageStyle ? `Style: ${kit.imageStyle}.` : null,
    kit.forbidden.length ? `Avoid: ${kit.forbidden.join(", ")}.` : null,
    opts.variant ? VARIANT_GUIDE[opts.variant as ImageVariant] : null,
    opts.mode === "brand_template"
      ? "Leave the lower third calm and uncluttered for a headline overlay. Do not render any text, letters, logos or watermarks."
      : "Do not render text, letters or logos unless explicitly requested.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildEditPrompt(instruction: string, kit: { colors: string[]; forbidden: string[] }) {
  return [
    `Edit the provided image: ${instruction}.`,
    "Keep everything else the same (composition, subject, lighting) unless the instruction says otherwise.",
    kit.colors.length ? `Stay within the brand palette: ${kit.colors.join(", ")}.` : null,
    kit.forbidden.length ? `Avoid: ${kit.forbidden.join(", ")}.` : null,
    "Do not add text, letters or logos unless the instruction asks for it.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Job handler: ai.image.generate. Statuses: QUEUED → GENERATING → UPLOADING → COMPLETED | FAILED. */
export async function runImageJob(assetId: string, attempt = 1, maxAttempts = 2) {
  const asset = await db.contentAsset.findUnique({ where: { id: assetId }, include: { contentItem: true } });
  if (!asset || asset.status === "COMPLETED") return { skipped: true };
  const scope = { organizationId: asset.organizationId, workspaceId: asset.workspaceId };
  const item = asset.contentItem;
  const preset = (asset.preset as ImagePreset) ?? "square";
  const quality = (asset.quality as ImageQuality) ?? "fast";
  const mode = (asset.mode as ImageMode | "edit") ?? "brand_template";
  const kit = await db.brandKit.findFirst({ where: scope });
  const colors = [...(kit?.primaryColors ?? []), ...(kit?.secondaryColors ?? [])];
  const started = Date.now();
  const task = mode === "edit" ? "IMAGE_EDIT" : "IMAGE_GENERATION";
  const ref = promptRef(mode === "edit" ? "image_edit" : "image_generation");
  try {
    await db.contentAsset.update({ where: { id: asset.id }, data: { status: "GENERATING", errorCode: null } });
    const provider = imageProvider();
    let prompt: string;
    let headline: string | null = null;
    let result;
    if (mode === "edit") {
      const parent = await db.contentAsset.findFirst({ where: { id: asset.parentAssetId ?? "", organizationId: scope.organizationId } });
      const file = parent?.fileId ? await db.fileObject.findFirst({ where: { id: parent.fileId, organizationId: scope.organizationId } }) : null;
      if (!file) throw new PermanentJobError("reference image missing");
      prompt = buildEditPrompt(asset.instruction ?? "", { colors, forbidden: kit?.forbiddenStyles ?? [] });
      result = await provider.edit({ images: [await storage.get(file.storageKey)], prompt, size: IMAGE_PRESETS[preset].generate, quality });
    } else {
      const { direction } = await creativeDirection(scope, item, asset.variant);
      headline = direction.headline || item.hook;
      prompt = buildGenerationPrompt(direction, { colors, imageStyle: kit?.imageStyle ?? null, forbidden: kit?.forbiddenStyles ?? [] }, { mode, variant: asset.variant, preset });
      result = await provider.generate({ prompt, size: IMAGE_PRESETS[preset].generate, quality });
    }

    await db.contentAsset.update({ where: { id: asset.id }, data: { status: "UPLOADING", model: result.model, prompt, promptKey: ref.key, promptVersion: ref.version } });
    const { width, height } = IMAGE_PRESETS[preset];
    let png: Buffer;
    if (mode === "brand_template" && asset.variant !== "no_text") {
      const logoFile = kit?.logoAssetId ? await db.fileObject.findFirst({ where: { id: kit.logoAssetId, organizationId: scope.organizationId } }) : null;
      const logo = logoFile && /image\/(png|jpeg|webp)/.test(logoFile.mimeType) ? await storage.get(logoFile.storageKey).catch(() => null) : null;
      const org = await db.organization.findUniqueOrThrow({ where: { id: scope.organizationId }, select: { name: true } });
      png = await composeBrandTemplate(result.data, { width, height, headline, cta: item.cta, brandName: org.name, primary: kit?.primaryColors[0] ?? "#17161c", secondary: kit?.secondaryColors[0] ?? kit?.primaryColors[1] ?? "#ffffff", logo });
    } else {
      png = await fitToSize(result.data, width, height);
    }
    // Bytes → StorageProvider (local / S3 / R2). The DB only keeps the file reference.
    const file = await saveUpload({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId: asset.createdById, fileName: `${item.id}-${asset.id}.png`, data: png, purpose: "generated_visual" });
    await db.$transaction([
      db.contentAsset.updateMany({ where: { contentItemId: item.id, isSelected: true }, data: { isSelected: false } }),
      db.contentAsset.update({
        where: { id: asset.id },
        data: { status: "COMPLETED", fileId: file.id, costMicro: result.cost.costMicro, costBasis: result.cost.basis, pricingVersion: result.cost.pricingVersion, usage: result.cost.usage, isSelected: true, width, height },
      }),
    ]);
    await recordImageCost({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "DESIGNER" }, task, provider.name, result, Date.now() - started, ref);
    return { completed: true, fileId: file.id };
  } catch (err) {
    const code = err instanceof ImageProviderError ? err.code : err instanceof PermanentJobError ? "image_failed" : "image_failed";
    const retry = err instanceof ImageProviderError && err.retryable && attempt < maxAttempts;
    logger.warn({ assetId, code, retry, err: err instanceof Error ? err.message : String(err) }, "image generation failed");
    reportError(err, "image", { assetId, code, retry });
    await logRun({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "DESIGNER" }, task, imageProvider().name, asset.model ?? "unknown", { inputTokens: 0, outputTokens: 0 }, 0n, Date.now() - started, "ERROR", false, code, ref);
    if (retry) {
      await db.contentAsset.update({ where: { id: asset.id }, data: { status: "QUEUED" } });
      throw err; // the queue retries with backoff
    }
    await db.contentAsset.update({ where: { id: asset.id }, data: { status: "FAILED", errorCode: code } });
    throw new PermanentJobError(code);
  }
}

/**
 * Logs an image run with token usage (text+image input / image output), the token-based cost and whether it
 * was priced from the provider's usage or estimated, and adds it to the monthly AI spend.
 */
async function recordImageCost(
  ctx: { organizationId: string; workspaceId: string; agentKey?: "DESIGNER" },
  task: "IMAGE_GENERATION" | "IMAGE_EDIT",
  provider: string,
  result: ImageResult,
  latencyMs: number,
  ref: { key: string; version: string },
) {
  const u = result.cost.usage;
  const tokens = { inputTokens: u.textInputTokens + u.imageInputTokens, outputTokens: u.outputTokens };
  await logRun(ctx, task, provider, result.model, tokens, result.cost.costMicro, latencyMs, "SUCCESS", false, undefined, ref, { basis: result.cost.basis, pricingVersion: result.cost.pricingVersion });
  await recordUsage({ organizationId: ctx.organizationId, agentKey: ctx.agentKey ?? null, ...tokens, costMicro: result.cost.costMicro });
}

/** Marks a completed asset as the one used for the post (history is kept). */
export async function selectAsset(scope: TenantScope, assetId: string) {
  const asset = await db.contentAsset.findFirst({ where: { id: assetId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, status: "COMPLETED" } });
  if (!asset) throw new UserFacingError("item_not_found");
  await db.$transaction([
    db.contentAsset.updateMany({ where: { contentItemId: asset.contentItemId, isSelected: true }, data: { isSelected: false } }),
    db.contentAsset.update({ where: { id: asset.id }, data: { isSelected: true } }),
  ]);
}

/**
 * Diagnostic-only lifecycle for admin test images: store through the StorageProvider, read it back, then
 * delete it. The admin gets a small inline preview; nothing is left in storage or attached to a post.
 */
async function storeAndDiscard(scope: TenantScope, userId: string, data: Buffer, fileName: string) {
  const file = await saveUpload({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId, fileName, data, purpose: "admin_test_image" });
  const readBack = await storage.get(file.storageKey);
  const stored = readBack.equals(data);
  await deleteFile(scope.organizationId, file.id);
  const { default: sharp } = await import("sharp");
  const preview = await sharp(data).resize(256, 256, { fit: "cover" }).jpeg({ quality: 70 }).toBuffer();
  return { stored, deleted: true, previewDataUrl: `data:image/jpeg;base64,${preview.toString("base64")}` };
}

/** Admin test: one small image through the real provider; stored, verified and deleted — never published. */
export async function adminTestImage(scope: TenantScope, userId: string) {
  if (!imagesConfigured()) throw new UserFacingError("image_not_configured");
  const started = Date.now();
  const res = await imageProvider()
    .generate({ prompt: "A simple flat illustration of a small green plant in a white pot on a plain background. No text.", size: "1024x1024", quality: "fast" })
    .catch((err) => {
      throw new UserFacingError(err instanceof ImageProviderError ? err.code : "image_failed", { cause: err });
    });
  await recordImageCost({ organizationId: scope.organizationId, workspaceId: scope.workspaceId }, "IMAGE_GENERATION", imageProvider().name, res, Date.now() - started, { key: "admin_test", version: "admin_test@1" });
  const life = await storeAndDiscard(scope, userId, res.data, "openai-test.png");
  return { ...life, model: res.model, bytes: res.data.byteLength, cost: { basis: res.cost.basis, costMicro: res.cost.costMicro.toString(), usage: res.cost.usage, pricingVersion: res.cost.pricingVersion } };
}

/**
 * Admin-only live check of image *editing*: the test card is sent to the edit endpoint as the reference.
 * Stored, verified and deleted like the generation test; never published; cost recorded like any edit.
 */
export async function adminTestImageEdit(scope: TenantScope, userId: string) {
  if (!imagesConfigured()) throw new UserFacingError("image_not_configured");
  const { default: sharp } = await import("sharp");
  const base = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 236, g: 240, b: 246 } } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><circle cx="512" cy="512" r="220" fill="#2f6f4f"/></svg>'), top: 0, left: 0 }])
    .png()
    .toBuffer();
  const started = Date.now();
  const res = await imageProvider()
    .edit({ images: [base], prompt: "Turn the green circle into a small green plant in a white pot. Keep the plain light background. No text.", size: "1024x1024", quality: "fast" })
    .catch((err) => {
      throw new UserFacingError(err instanceof ImageProviderError ? err.code : "image_failed", { cause: err });
    });
  await recordImageCost({ organizationId: scope.organizationId, workspaceId: scope.workspaceId }, "IMAGE_EDIT", imageProvider().name, res, Date.now() - started, { key: "admin_test", version: "admin_test@1" });
  const life = await storeAndDiscard(scope, userId, res.data, "openai-edit-test.png");
  return { ...life, model: res.model, bytes: res.data.byteLength, cost: { basis: res.cost.basis, costMicro: res.cost.costMicro.toString(), usage: res.cost.usage, pricingVersion: res.cost.pricingVersion } };
}
