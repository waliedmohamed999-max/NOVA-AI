import { z } from "zod";
import { brainMeta } from "../knowledge/company-context";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { aiStructured, toUserFacing } from "../ai";
import { PLATFORM_GUIDE, STUDIO_RULES, arabicGuide, promptRef } from "../ai/prompts";
import { UserFacingError } from "../errors";
import { audit } from "../audit";
import { saveUpload, signedFileUrl, storage } from "../storage";
import { renderTemplate } from "../design/templates";
import { contextBlock, studioContext } from "./context";
import { requireContentAi } from "./content";

/**
 * Reels / short video foundation. NOVA plans the video (concept, hook, scenes, shot list, voice-over,
 * on-screen text, caption, cover, duration, assets needed) and renders the cover; it does NOT generate
 * video. A VideoProvider can be plugged in later behind the interface below.
 */
export const sceneSchema = z.object({
  order: z.number().int().min(1),
  durationSec: z.number().min(1).max(30),
  shot: z.string().describe("What the camera shows: framing, subject, movement"),
  voiceOver: z.string(),
  onScreenText: z.string(),
  assetNeeded: z.string().describe("Footage/photo/b-roll the owner needs to film or supply; empty if none"),
});
export const videoPlanSchema = z.object({
  concept: z.string(),
  hook: z.string().describe("What is said/shown in the first 2 seconds"),
  durationSec: z.number().int().min(5).max(90),
  scenes: z.array(sceneSchema).min(2).max(12),
  shotList: z.array(z.string()).max(15),
  caption: z.string(),
  coverText: z.string().max(60),
  music: z.string().describe("Mood / type of music; never a specific copyrighted track"),
});
export type VideoPlan = z.infer<typeof videoPlanSchema> & { promptVersion: string; generatedAt: string; coverFileId?: string | null };

/** Future video generation boundary (e.g. a text-to-video or template-video service). */
export interface VideoProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Starts rendering; returns a provider job id to poll. */
  render(input: { plan: VideoPlan; aspect: "9:16" | "1:1" | "4:5"; assets: { sceneOrder: number; url: string }[] }): Promise<{ jobId: string }>;
  status(jobId: string): Promise<{ state: "queued" | "rendering" | "done" | "failed"; url?: string; error?: string }>;
}

class NoVideoProvider implements VideoProvider {
  readonly name = "none";
  isConfigured() {
    return false;
  }
  async render(): Promise<{ jobId: string }> {
    throw new UserFacingError("video_not_configured");
  }
  async status(): Promise<{ state: "failed"; error: string }> {
    return { state: "failed", error: "video_not_configured" };
  }
}

let videoProviderImpl: VideoProvider = new NoVideoProvider();
export const videoProvider = () => videoProviderImpl;
export function setVideoProvider(p: VideoProvider | null) {
  videoProviderImpl = p ?? new NoVideoProvider();
}

const VIDEO_FORMATS = ["REEL", "SHORT_VIDEO", "STORY"];

export function readVideoPlan(designBrief: unknown): VideoPlan | null {
  const plan = (designBrief as { videoPlan?: unknown } | null)?.videoPlan;
  const parsed = videoPlanSchema.safeParse(plan);
  return parsed.success ? { ...(plan as VideoPlan), ...parsed.data } : null;
}

export async function generateVideoPlan(scope: TenantScope, contentItemId: string, opts: { durationSec?: number; userId: string }) {
  requireContentAi();
  const item = await db.contentItem.findFirst({ where: { id: contentItemId, ...scope } });
  if (!item) throw new UserFacingError("content_not_found");
  if (!VIDEO_FORMATS.includes(item.format) && item.platform !== "TIKTOK") throw new UserFacingError("invalid_transition");
  const ctx = await studioContext(scope, item);
  const ref = promptRef("video_plan");
  const target = Math.min(90, Math.max(7, opts.durationSec ?? 30));
  const res = await aiStructured(
    { organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "CONTENT_STRATEGIST" },
    {
      task: "COPYWRITING",
      realOnly: true,
      promptRef: ref,
      schemaName: "video_plan",
      schema: videoPlanSchema,
      system: ["You are NOVA's short-video producer planning a vertical video the owner can film with a phone.", STUDIO_RULES, arabicGuide(ctx.brain.locale, ctx.brain.brandKit?.tone), contextBlock(ctx)].join("\n\n"),
      brain: brainMeta(ctx.brainCtx),
      prompt: [
        `Plan a ${target}-second ${item.platform} ${item.format} for "${item.title}".`,
        PLATFORM_GUIDE[item.platform] ?? PLATFORM_GUIDE.TIKTOK,
        "Scene durations must add up to durationSec. The hook must land in the first 2 seconds. On-screen text: short, readable, max ~6 words per scene.",
        "assetNeeded: what the owner must film or supply (be concrete). Never plan footage of real customers or people who haven't agreed.",
        "coverText: the words on the cover image (max ~6 words). music: a mood, never a specific copyrighted song.",
        item.caption && `Existing caption for context:\n${item.caption}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ).catch((e) => {
    throw toUserFacing(e);
  });
  const total = res.data.scenes.reduce((a, s) => a + s.durationSec, 0);
  const plan: VideoPlan = { ...res.data, durationSec: Math.round(total), scenes: res.data.scenes.map((s, i) => ({ ...s, order: i + 1 })), promptVersion: ref.version, generatedAt: new Date().toISOString(), coverFileId: null };
  await savePlan(scope, item.id, item.designBrief, plan);
  await audit({ ...scope, actorType: "USER", actorId: opts.userId, action: "content.video_plan_generated", entityType: "ContentItem", entityId: item.id, summary: `Video plan: ${plan.scenes.length} scenes, ${plan.durationSec}s (${ref.version})` });
  return plan;
}

async function savePlan(scope: TenantScope, id: string, designBrief: unknown, plan: VideoPlan) {
  const brief = { ...((designBrief as Record<string, unknown>) ?? {}), videoPlan: plan };
  await db.contentItem.updateMany({ where: { id, ...scope }, data: { designBrief: brief as Prisma.InputJsonValue } });
}

/** Renders the reel cover (safe-area aware 9:16 brand template) and stores it as a private file. */
export async function renderReelCover(scope: TenantScope, contentItemId: string, userId: string) {
  const item = await db.contentItem.findFirst({ where: { id: contentItemId, ...scope } });
  if (!item) throw new UserFacingError("content_not_found");
  const plan = readVideoPlan(item.designBrief);
  if (!plan) throw new UserFacingError("validation");
  const [kit, org] = await Promise.all([db.brandKit.findFirst({ where: scope }), db.organization.findUniqueOrThrow({ where: { id: scope.organizationId }, select: { name: true } })]);
  const logoFile = kit?.logoAssetId ? await db.fileObject.findFirst({ where: { id: kit.logoAssetId, organizationId: scope.organizationId } }) : null;
  const logo = logoFile && /image\/(png|jpeg|webp)/.test(logoFile.mimeType) ? await storage.get(logoFile.storageKey).catch(() => null) : null;
  const { png, layout } = await renderTemplate("reel_cover", { headline: plan.coverText || plan.hook, brandName: org.name }, { primary: kit?.primaryColors[0] ?? "#17161c", secondary: kit?.secondaryColors[0] ?? "#ffffff", logo });
  const file = await saveUpload({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId, fileName: `reel-cover-${item.id}.png`, data: png, purpose: "reel_cover" });
  await savePlan(scope, item.id, item.designBrief, { ...plan, coverFileId: file.id });
  return { url: signedFileUrl(file.id), warnings: layout.warnings };
}
