import { z } from "zod";
import { brainMeta } from "../knowledge/company-context";
import type { Prisma } from "@/generated/prisma/client";
import type { SocialPlatform } from "@/generated/prisma/enums";
import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { aiStructured, contentAiConfigured, toUserFacing } from "../ai";
import { AiError } from "../ai/types";
import { PLATFORM_GUIDE, STUDIO_RULES, arabicGuide, promptRef } from "../ai/prompts";
import { editContent } from "../content/service";
import { audit } from "../audit";
import { UserFacingError } from "../errors";
import { QUALITY_DIMENSIONS, contextBlock, findDuplicates, improvedContentSchema, qualityCheckSchema, studioContext, type ImprovedContent, type QualityCheck } from "./context";

/**
 * Content studio (text): improve, adapt per platform, quality-check and plan — through the existing
 * AI router (OpenAI Responses API with structured outputs), never the offline dev provider.
 */
export function requireContentAi() {
  if (!contentAiConfigured()) throw new UserFacingError("content_ai_not_configured");
}

type Ctx = { userId: string };
const ai = (scope: TenantScope) => ({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "CONTENT_STRATEGIST" as const });

async function loadItem(scope: TenantScope, id: string) {
  const item = await db.contentItem.findFirst({ where: { id, ...scope } });
  if (!item) throw new UserFacingError("content_not_found");
  return item;
}

const writerSystem = (block: string, locale: "ar" | "en", dialect?: string | null) =>
  ["You are NOVA's content team: a senior social copywriter working for the company below.", STUDIO_RULES, arabicGuide(locale, dialect), "", block].join("\n");

export type Suggestion = ImprovedContent & { quality: QualityCheck; duplicates: { kind: string; againstId: string }[]; promptVersion: string; generatedBy: string };

/** "Improve content": a suggested version — nothing is overwritten until the user chooses. */
export async function improveContent(scope: TenantScope, id: string, opts: { instruction?: string | null } = {}): Promise<Suggestion> {
  requireContentAi();
  const item = await loadItem(scope, id);
  const ctx = await studioContext(scope, item);
  const system = writerSystem(contextBlock(ctx), ctx.brain.locale, ctx.brain.brandKit?.tone);
  const ask = (extra?: string) =>
    aiStructured(ai(scope), {
      task: "COPYWRITING",
      realOnly: true,
      promptRef: promptRef("content_improvement"),
      schemaName: "improved_content",
      schema: improvedContentSchema,
      system,
      brain: brainMeta(ctx.brainCtx),
      prompt: [
        `Improve this ${item.platform} ${item.format} post. Keep its intent and pillar ("${item.pillar ?? "—"}"); make the hook stronger, the caption clearer and the CTA specific.`,
        PLATFORM_GUIDE[item.platform] ?? "",
        item.platform === "TIKTOK" || item.format === "REEL" || item.format === "SHORT_VIDEO" ? "Include video_concept and on_screen_text." : "Leave video_concept empty and on_screen_text as an empty list.",
        opts.instruction && `The owner asked: "${opts.instruction}"`,
        extra,
        `Current version:\nHook: ${item.hook ?? ""}\nCaption:\n${item.caption}\nCTA: ${item.cta ?? ""}\nHashtags: ${item.hashtags.join(" ")}`,
        "reasons: 2–3 short reasons why the new version should perform better, grounded in the performance context and brand rules above. If there is no performance data, base them on the brand rules and platform best practice — never on invented numbers.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

  let res = await ask().catch((e) => {
    throw toUserFacing(e);
  });
  // Too close to something we already posted → one more try with a different angle.
  let dups = findDuplicates({ hook: res.data.hook, cta: res.data.cta, visual: res.data.visual_direction }, ctx.recent);
  if (dups.some((d) => d.kind === "hook")) {
    res = await ask("The hook you wrote is too similar to a recent post. Take a clearly different angle and opening line.").catch((e) => {
      throw toUserFacing(e);
    });
    dups = findDuplicates({ hook: res.data.hook, cta: res.data.cta, visual: res.data.visual_direction }, ctx.recent);
  }
  const quality = await qualityCheck(scope, { platform: item.platform, format: item.format, hook: res.data.hook, caption: res.data.caption, cta: res.data.cta, hashtags: res.data.hashtags }, dups, ctx).catch(() => fallbackQuality(dups));
  return { ...res.data, quality, duplicates: dups.map((d) => ({ kind: d.kind, againstId: d.againstId })), promptVersion: promptRef("content_improvement").version, generatedBy: res.generatedBy };
}

function fallbackQuality(dups: { kind: string }[]): QualityCheck {
  return QUALITY_DIMENSIONS.map((dimension) =>
    dimension === "repetition" && dups.length ? { dimension, status: "needs_attention" as const, reason: "Similar to a recent post." } : { dimension, status: "good" as const, reason: "" },
  );
}

/** Internal quality check — statuses with reasons, never a made-up numeric score. */
export async function qualityCheck(
  scope: TenantScope,
  post: { platform: string; format: string; hook: string | null; caption: string; cta: string | null; hashtags: string[] },
  duplicates: { kind: string }[],
  ctx?: Awaited<ReturnType<typeof studioContext>>,
): Promise<QualityCheck> {
  const c = ctx ?? (await studioContext(scope));
  const res = await aiStructured(ai(scope), {
    task: "ANALYSIS",
    quality: "fast",
    realOnly: true,
    promptRef: promptRef("content_quality"),
    schemaName: "quality_check",
    schema: qualityCheckSchema,
    system: ["You review social posts before approval for a brand. Be strict and specific. Reply in the brand's language.", STUDIO_RULES, contextBlock(c)].join("\n\n"),
    brain: brainMeta(c.brainCtx),
    prompt: [
      `Check this ${post.platform} ${post.format} post on: brand_fit, clarity, cta, platform_fit, repetition, claim_safety. Use "needs_attention" only with a concrete reason.`,
      `claim_safety: flag any statistic, guarantee, medical/financial promise, price or discount not present in the company information.`,
      duplicates.length ? `Deterministic check found it similar to recent content (${duplicates.map((d) => d.kind).join(", ")}): mark repetition as needs_attention.` : "No duplicate was detected by the deterministic check.",
      `Hook: ${post.hook ?? ""}\nCaption:\n${post.caption}\nCTA: ${post.cta ?? ""}\nHashtags: ${post.hashtags.join(" ")}`,
    ].join("\n\n"),
  });
  // Keep the deterministic repetition signal authoritative.
  return res.data.checks.map((ch) => (ch.dimension === "repetition" && duplicates.length ? { ...ch, status: "needs_attention" } : ch));
}

const applySchema = z.object({
  hook: z.string().max(300).nullable(),
  caption: z.string().min(1).max(2200),
  cta: z.string().max(200).nullable(),
  hashtags: z.array(z.string().max(60)).max(15),
});

/** Saves the chosen / merged / edited suggestion as a NEW content version with its provenance. */
export async function applyVersion(
  scope: TenantScope,
  id: string,
  fields: z.input<typeof applySchema>,
  meta: { source: "ai_improve" | "ai_merge" | "ai_edit" | "manual"; reasons?: string[]; platformNotes?: string | null; visualDirection?: string | null; quality?: QualityCheck | null; promptVersion?: string | null },
  actor: Ctx,
) {
  const f = applySchema.parse(fields);
  const version = await editContent(scope, id, { hook: f.hook, caption: f.caption, cta: f.cta, hashtags: f.hashtags }, { userId: actor.userId, changeNote: meta.source === "manual" ? undefined : `AI studio (${meta.source})` });
  await db.contentVersion.updateMany({
    where: { contentItemId: id, version, organizationId: scope.organizationId },
    data: {
      source: meta.source,
      reasons: meta.reasons ?? [],
      platformNotes: meta.platformNotes ?? null,
      visualDirection: meta.visualDirection ?? null,
      qualityCheck: (meta.quality ?? undefined) as Prisma.InputJsonValue | undefined,
      promptVersion: meta.promptVersion ?? null,
    },
  });
  if (meta.visualDirection) {
    const item = await loadItem(scope, id);
    await db.contentItem.update({ where: { id }, data: { designBrief: { ...((item.designBrief as object) ?? {}), concept: meta.visualDirection } as Prisma.InputJsonValue } });
  }
  return version;
}

const adaptationSchema = z.object({
  title: z.string().max(160),
  hook: z.string().max(300),
  caption: z.string().min(1).max(2200),
  cta: z.string().max(200),
  hashtags: z.array(z.string().max(60)).max(8),
  platform_notes: z.string().max(400),
  video_concept: z.string().max(600),
  on_screen_text: z.array(z.string().max(120)).max(6),
});

const ADAPT_FORMAT: Record<string, "POST" | "LINKEDIN_POST" | "SHORT_VIDEO"> = { INSTAGRAM: "POST", FACEBOOK: "POST", LINKEDIN: "LINKEDIN_POST", TIKTOK: "SHORT_VIDEO" };

/** Platform-specific rewrites saved as separate posts (never the same caption everywhere). */
export async function adaptForPlatforms(scope: TenantScope, id: string, platforms: SocialPlatform[], actor: Ctx) {
  requireContentAi();
  const item = await loadItem(scope, id);
  const targets = [...new Set(platforms)].filter((p) => p !== item.platform && PLATFORM_GUIDE[p]).slice(0, 3);
  if (!targets.length) throw new UserFacingError("validation");
  const ctx = await studioContext(scope, item);
  const created: string[] = [];
  for (const platform of targets) {
    const res = await aiStructured(ai(scope), {
      task: "COPYWRITING",
      realOnly: true,
      promptRef: promptRef("caption_generation"),
      schemaName: "platform_adaptation",
      schema: adaptationSchema,
      system: writerSystem(contextBlock(ctx), ctx.brain.locale, ctx.brain.brandKit?.tone),
      brain: brainMeta(ctx.brainCtx),
      prompt: [
        `Rewrite this ${item.platform} post natively for ${platform}. Same message and offer, different writing — do not reuse the caption.`,
        PLATFORM_GUIDE[platform],
        platform === "TIKTOK" ? "Include video_concept and on_screen_text." : "Leave video_concept empty and on_screen_text as an empty list.",
        `Original:\nHook: ${item.hook ?? ""}\nCaption:\n${item.caption}\nCTA: ${item.cta ?? ""}`,
      ].join("\n\n"),
    }).catch((e) => {
      throw toUserFacing(e);
    });
    const d = res.data;
    const caption = d.caption;
    const row = await db.contentItem.create({
      data: {
        ...scope,
        campaignId: item.campaignId,
        derivedFromId: item.id,
        platform,
        format: ADAPT_FORMAT[platform],
        status: "PENDING_APPROVAL",
        title: d.title || item.title,
        pillar: item.pillar,
        hook: d.hook,
        caption,
        cta: d.cta || null,
        hashtags: d.hashtags,
        designBrief: { ...((item.designBrief as object) ?? {}), ...(d.video_concept ? { videoConcept: d.video_concept, onScreenText: d.on_screen_text } : {}) } as Prisma.InputJsonValue,
        aiRationale: d.platform_notes,
        authorAgent: "CONTENT_STRATEGIST",
        authorUserId: actor.userId,
        versions: {
          create: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, version: 1, hook: d.hook, caption, cta: d.cta || null, hashtags: d.hashtags, source: "ai_adapt", platformNotes: d.platform_notes, promptVersion: promptRef("caption_generation").version, createdByAgent: "CONTENT_STRATEGIST", createdById: actor.userId },
        },
      },
    });
    created.push(row.id);
  }
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, action: "content.adapted", entityType: "ContentItem", entityId: id, summary: `Adapted for ${targets.join(", ")}`, metadata: { created } });
  return created;
}

/** Quality check on the current version, stored on it for the approval card. */
export async function checkCurrentVersion(scope: TenantScope, id: string) {
  requireContentAi();
  const item = await loadItem(scope, id);
  const ctx = await studioContext(scope, item);
  const dups = findDuplicates({ title: item.title, hook: item.hook, cta: item.cta, visual: (item.designBrief as { concept?: string } | null)?.concept ?? null }, ctx.recent);
  const checks = await qualityCheck(scope, item, dups, ctx).catch((e) => {
    throw e instanceof AiError ? toUserFacing(e) : e;
  });
  await db.contentVersion.updateMany({ where: { contentItemId: id, version: item.currentVersion, organizationId: scope.organizationId }, data: { qualityCheck: checks as Prisma.InputJsonValue } });
  return checks;
}

export const weekProposalSchema = z.object({
  summary: z.string().max(500),
  days: z
    .array(
      z.object({
        day: z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]),
        type: z.string().max(40),
        platform: z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "TIKTOK"]),
        format: z.enum(["POST", "CAROUSEL", "STORY", "REEL", "SHORT_VIDEO", "LINKEDIN_POST"]),
        topic: z.string().max(160),
        reason: z.string().max(220),
      }),
    )
    .min(3)
    .max(7),
});
export type WeekProposal = z.infer<typeof weekProposalSchema>;

/** "Plan next week": a proposed mix grounded in real performance, the campaign and what's already scheduled. */
export async function proposeWeek(scope: TenantScope, opts: { topic?: string | null; count?: number } = {}): Promise<WeekProposal & { promptVersion: string }> {
  requireContentAi();
  const ctx = await studioContext(scope);
  const nextWeek = new Date(Date.now() + 7 * 86_400_000);
  const [scheduled, campaigns, channels] = await Promise.all([
    db.contentItem.findMany({ where: { ...scope, scheduledAt: { gte: new Date(), lte: nextWeek } }, select: { platform: true, format: true, pillar: true, scheduledAt: true } }),
    db.campaign.findMany({ where: { ...scope, status: { in: ["ACTIVE", "PENDING_APPROVAL"] } }, select: { name: true, objective: true }, take: 3 }),
    db.integration.findMany({ where: { ...scope, status: "CONNECTED", OR: [{ statusMessage: null }, { statusMessage: { not: "identity_only" } }] }, select: { provider: true } }),
  ]);
  const res = await aiStructured(ai(scope), {
    task: "STRATEGY",
    realOnly: true,
    promptRef: promptRef("content_strategy"),
    schemaName: "week_proposal",
    schema: weekProposalSchema,
    system: ["You are NOVA's content strategist planning next week's posts.", STUDIO_RULES, arabicGuide(ctx.brain.locale), contextBlock(ctx)].join("\n\n"),
    brain: brainMeta(ctx.brainCtx),
    prompt: [
      `Propose ${Math.min(7, Math.max(3, opts.count ?? 5))} posts for next week: one per chosen day, a balanced mix (educational, case study, offer, authority, engagement …).`,
      opts.topic && `Focus: ${opts.topic}`,
      channels.length ? `Connected channels: ${[...new Set(channels.map((c) => c.provider))].join(", ")} — prefer these.` : "No channels connected yet — use the recommended channels from the company profile.",
      campaigns.length && `Active/pending campaigns: ${campaigns.map((c) => `${c.name} (${c.objective ?? "—"})`).join("; ")}`,
      scheduled.length ? `Already scheduled next week (don't duplicate): ${scheduled.map((s) => `${s.platform} ${s.format} ${s.pillar ?? ""}`).join("; ")}` : "Nothing is scheduled next week yet.",
      "reason: one short sentence per day, tied to the performance context when data exists (never invent numbers).",
    ]
      .filter(Boolean)
      .join("\n\n"),
  }).catch((e) => {
    throw toUserFacing(e);
  });
  return { ...res.data, promptVersion: promptRef("content_strategy").version };
}
