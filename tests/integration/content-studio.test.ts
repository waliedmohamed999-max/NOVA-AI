import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import type { z } from "zod";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { getProvider, reportSuccess, setProvider } from "@/server/ai/router";
import type { GenerateRequest, LLMProvider, StructuredResult } from "@/server/ai/types";
import { AiError } from "@/server/ai/types";
import { imageProvider, setImageProvider, ImageProviderError, type ImageProvider } from "@/server/design/image-provider";
import { setStorageDriver, type StorageDriver } from "@/server/storage";
import { adaptForPlatforms, applyVersion, improveContent, proposeWeek } from "@/server/studio/content";
import { imageUsage, requestImage, runImageJob, selectAsset } from "@/server/studio/images";
import { approveContent, createContentFromPlan } from "@/server/content/service";
import { offlinePost } from "@/server/agents/offline-content";
import { loadBrain } from "@/server/agents/brain";
import { PermanentJobError } from "@/server/jobs/queue";

// ── Fakes: no automated test ever calls OpenAI or spends money ──
const originalOpenAI = getProvider("openai");
const originalImages = imageProvider();
let calls: { schemaName: string; system?: string; prompt: string }[] = [];
let responses: Record<string, (n: number) => unknown> = {};

function fakeOpenAI(): LLMProvider {
  const structured = async <S extends z.ZodType>(req: GenerateRequest & { schema: S; schemaName: string }): Promise<StructuredResult<z.output<S>>> => {
    const n = calls.filter((c) => c.schemaName === req.schemaName).length;
    calls.push({ schemaName: req.schemaName, system: req.system, prompt: req.messages.map((m) => m.content).join("\n") });
    const make = responses[req.schemaName];
    if (!make) throw new AiError("ai_failed", `no fake for ${req.schemaName}`);
    const parsed = req.schema.safeParse(make(n));
    if (!parsed.success) throw new AiError("ai_invalid_output", "schema mismatch"); // mirrors the real provider's validation
    return { data: parsed.data as z.output<S>, usage: { inputTokens: 1200, outputTokens: 400 }, model: "gpt-test-text" };
  };
  return {
    name: "openai",
    isConfigured: () => true,
    generateStructured: structured,
    generateText: async () => ({ text: "NOVA OK", usage: { inputTokens: 5, outputTokens: 2 }, model: "gpt-test-text" }),
    stream: async function* () {},
    analyze: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 }, model: "gpt-test-text" }),
    summarize: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 }, model: "gpt-test-text" }),
    classify: async () => {
      throw new Error("unused");
    },
  } as unknown as LLMProvider;
}

let imageCalls: { kind: "generate" | "edit"; prompt: string; size: string; quality?: string; refs?: number }[] = [];
let imageBehavior: (kind: string) => Promise<void> = async () => undefined;
async function png(w: number, h: number) {
  return sharp({ create: { width: w, height: h, channels: 3, background: "#b9a38f" } }).png().toBuffer();
}
function fakeImages(): ImageProvider {
  return {
    name: "openai",
    isConfigured: () => true,
    models: () => ({ fast: "gpt-image-fast-test", quality: "gpt-image-quality-test" }),
    generate: async ({ prompt, size, quality }) => {
      imageCalls.push({ kind: "generate", prompt, size, quality });
      await imageBehavior("generate");
      const [w, h] = size.split("x").map(Number);
      return { data: await png(w, h), mimeType: "image/png", model: quality === "quality" ? "gpt-image-quality-test" : "gpt-image-fast-test", costMicro: quality === "quality" ? 170_000n : 40_000n };
    },
    edit: async ({ images, prompt, size, quality }) => {
      imageCalls.push({ kind: "edit", prompt, size, quality, refs: images.length });
      await imageBehavior("edit");
      const [w, h] = size.split("x").map(Number);
      return { data: await png(w, h), mimeType: "image/png", model: "gpt-image-quality-test", costMicro: 170_000n };
    },
  };
}

const objects = new Map<string, Buffer>();
const memory: StorageDriver = { name: "memory", put: async (k, d) => void objects.set(k, d), get: async (k) => objects.get(k) ?? Promise.reject(new Error("missing")), delete: async (k) => void objects.delete(k) };

const IMPROVED = (n: number) => ({
  hook: n === 0 ? "بشرتك تستحق روتينًا يفهمها" : "ثلاث علامات تقول إن بشرتك عطشى",
  caption: "جلسة الهيدرافيشل عندنا تبدأ بتحليل لبشرتك، ثم علاج مخصص لها.\n\nاحجزي استشارتك المجانية هذا الأسبوع.",
  cta: "احجزي استشارتك",
  hashtags: ["#لوما", "#عناية_بالبشرة"],
  visual_direction: "Soft daylight close-up of hydrated skin, calm neutral tones",
  reasons: ["افتتاحية تخاطب مشكلة العميلة مباشرة", "دعوة واضحة لخطوة واحدة"],
  platform_notes: "Short lines for Instagram readability",
  video_concept: "",
  on_screen_text: [],
});
const QUALITY = () => ({
  checks: ["brand_fit", "clarity", "cta", "platform_fit", "repetition", "claim_safety"].map((dimension) => ({ dimension, status: "good", reason: "" })),
});
const DIRECTION = () => ({ concept: "Hydration ritual", scene: "Glass serum bottle on travertine, soft window light", composition: "Subject left, calm space below", mood: "calm, premium", headline: "بشرة أنقى في 4 أسابيع" });

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test-not-real";
  setProvider("openai", fakeOpenAI());
  setImageProvider(fakeImages());
  setStorageDriver(memory);
  calls = [];
  imageCalls = [];
  imageBehavior = async () => undefined;
  responses = { improved_content: IMPROVED, quality_check: QUALITY, visual_direction: DIRECTION };
});
afterEach(() => {
  process.env.OPENAI_API_KEY = "";
  setProvider("openai", originalOpenAI);
  setImageProvider(originalImages);
  setStorageDriver(null);
  reportSuccess("openai");
});

async function tenantWithPost(locale: "ar" | "en" = "ar", platform: "INSTAGRAM" | "LINKEDIN" = "INSTAGRAM") {
  const t = await makeTenant(locale === "ar" ? "لوما" : "Luma", locale);
  const b = await loadBrain(t.scope);
  const [id] = await createContentFromPlan(t.scope, [{ ...offlinePost(b, 0, { platform }), dayOffset: 2 }], { agent: "CONTENT_STRATEGIST", startDate: new Date(), generatedBy: "test" });
  return { t, id };
}

describe("configuration", () => {
  it("missing OpenAI key: no fake generation — clear 'not configured' errors", async () => {
    process.env.OPENAI_API_KEY = "";
    setProvider("openai", originalOpenAI);
    setImageProvider(originalImages);
    const { t, id } = await tenantWithPost();
    await expect(improveContent(t.scope, id)).rejects.toMatchObject({ code: "content_ai_not_configured" });
    await expect(requestImage(t.scope, t.user.id, id, {})).rejects.toMatchObject({ code: "image_not_configured" });
    expect(await db.contentAsset.count({ where: { organizationId: t.organization.id } })).toBe(0);
  });
});

describe("improve content (text only)", () => {
  it("returns a validated suggestion with reasons + quality check and changes nothing until chosen", async () => {
    const { t, id } = await tenantWithPost();
    const before = await db.contentItem.findUniqueOrThrow({ where: { id } });
    const s = await improveContent(t.scope, id);
    expect(s).toMatchObject({ hook: "بشرتك تستحق روتينًا يفهمها", promptVersion: "content_improvement@1" });
    expect(s.reasons.length).toBeGreaterThanOrEqual(1);
    expect(s.quality).toHaveLength(6);
    const after = await db.contentItem.findUniqueOrThrow({ where: { id } });
    expect(after.caption).toBe(before.caption);
    expect(after.currentVersion).toBe(before.currentVersion);
    // Arabic writing guidance and brand context reach the model; the offline provider is never used.
    expect(calls[0].system).toMatch(/native copywriter/);
    const run = await db.aiRun.findFirstOrThrow({ where: { organizationId: t.organization.id, promptKey: "content_improvement" } });
    expect(run).toMatchObject({ provider: "openai", promptVersion: "content_improvement@1", status: "SUCCESS" });
  });

  it("invalid structured output is rejected with a customer-safe error", async () => {
    responses.improved_content = () => ({ hook: "", caption: "" });
    const { t, id } = await tenantWithPost();
    await expect(improveContent(t.scope, id)).rejects.toMatchObject({ code: "ai_failed" });
  });

  it("a hook too close to a recent post triggers one retry with a different angle", async () => {
    const { t, id } = await tenantWithPost();
    const b = await loadBrain(t.scope);
    const [other] = await createContentFromPlan(t.scope, [{ ...offlinePost(b, 1, { platform: "INSTAGRAM" }), dayOffset: 3 }], { agent: "CONTENT_STRATEGIST", startDate: new Date(), generatedBy: "test" });
    await db.contentItem.update({ where: { id: other }, data: { hook: "بشرتك تستحق روتينًا يفهمها!", status: "APPROVED" } });
    const s = await improveContent(t.scope, id);
    expect(calls.filter((c) => c.schemaName === "improved_content")).toHaveLength(2);
    expect(calls[1].prompt).toMatch(/different angle/);
    expect(s.hook).toBe("ثلاث علامات تقول إن بشرتك عطشى");
  });

  it("choosing the suggestion creates a new version with provenance; history keeps the original", async () => {
    const { t, id } = await tenantWithPost();
    const original = await db.contentItem.findUniqueOrThrow({ where: { id } });
    const s = await improveContent(t.scope, id);
    const v = await applyVersion(t.scope, id, { hook: s.hook, caption: s.caption, cta: s.cta, hashtags: s.hashtags }, { source: "ai_improve", reasons: s.reasons, quality: s.quality, promptVersion: s.promptVersion, visualDirection: s.visual_direction }, { userId: t.user.id });
    const v2 = await applyVersion(t.scope, id, { hook: original.hook, caption: `${s.caption}\n`, cta: original.cta, hashtags: s.hashtags }, { source: "ai_merge" }, { userId: t.user.id });
    expect(v2).toBe(v + 1);
    const versions = await db.contentVersion.findMany({ where: { contentItemId: id }, orderBy: { version: "asc" } });
    expect(versions[0].caption).toBe(original.caption);
    expect(versions.find((x) => x.version === v)).toMatchObject({ source: "ai_improve", promptVersion: "content_improvement@1" });
    expect(versions.find((x) => x.version === v)!.reasons.length).toBeGreaterThan(0);
    expect((await db.contentItem.findUniqueOrThrow({ where: { id } })).status).toBe(original.status); // a user choice doesn't reset approval
  });
});

describe("platform-specific writing", () => {
  it("creates a separate post per platform, never copying the caption, pending approval", async () => {
    responses.platform_adaptation = () => ({ title: "Skin routine", hook: "What your skin is telling you", caption: "Hydration is not a product, it's a routine.\n\nHere is how we build yours.", cta: "Book a consultation", hashtags: [], platform_notes: "Short paragraphs for LinkedIn", video_concept: "", on_screen_text: [] });
    const { t, id } = await tenantWithPost("en");
    const src = await db.contentItem.findUniqueOrThrow({ where: { id } });
    const ids = await adaptForPlatforms(t.scope, id, ["LINKEDIN"], { userId: t.user.id });
    const li = await db.contentItem.findUniqueOrThrow({ where: { id: ids[0] }, include: { versions: true } });
    expect(li).toMatchObject({ platform: "LINKEDIN", format: "LINKEDIN_POST", derivedFromId: id, status: "PENDING_APPROVAL" });
    expect(li.caption).not.toBe(src.caption);
    expect(li.versions[0]).toMatchObject({ source: "ai_adapt", promptVersion: "caption_generation@1" });
    expect(calls.at(-1)!.prompt).toMatch(/LinkedIn: professional but conversational/);
    await approveContent(t.scope, [li.id], { userId: t.user.id });
    expect((await db.contentItem.findUniqueOrThrow({ where: { id: li.id } })).status).toMatch(/APPROVED|SCHEDULED/);
  });
});

describe("images", () => {
  it("brand template: queued → job → stored via StorageProvider at the exact social size; caption untouched; cost logged", async () => {
    const { t, id } = await tenantWithPost();
    await db.contentItem.update({ where: { id }, data: { format: "POST" } }); // square feed post (carousels get 4:5)
    const before = await db.contentItem.findUniqueOrThrow({ where: { id } });
    const asset = await requestImage(t.scope, t.user.id, id, {});
    expect(asset).toMatchObject({ status: "QUEUED", mode: "brand_template", quality: "fast", preset: "square" });
    expect(await db.job.count({ where: { type: "ai.image.generate", payload: { path: ["assetId"], equals: asset.id } } })).toBe(1);

    await runImageJob(asset.id);
    const done = await db.contentAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(done).toMatchObject({ status: "COMPLETED", isSelected: true, model: "gpt-image-fast-test", promptVersion: "image_generation@1", width: 1080, height: 1080, costMicro: 40_000n });
    const file = await db.fileObject.findUniqueOrThrow({ where: { id: done.fileId! } });
    const bytes = objects.get(file.storageKey)!;
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 1080, height: 1080, format: "png" });
    expect(JSON.stringify(done, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toMatch(/base64|iVBORw0KGgo/); // bytes live in storage, not the DB
    expect(imageCalls[0].prompt).toMatch(/Do not render any text/);

    const after = await db.contentItem.findUniqueOrThrow({ where: { id } });
    expect({ caption: after.caption, v: after.currentVersion, status: after.status, at: after.scheduledAt }).toEqual({ caption: before.caption, v: before.currentVersion, status: before.status, at: before.scheduledAt });
    const run = await db.aiRun.findFirstOrThrow({ where: { organizationId: t.organization.id, task: "IMAGE_GENERATION" } });
    expect(run).toMatchObject({ costMicro: 40_000n, model: "gpt-image-fast-test", promptKey: "image_generation", status: "SUCCESS" });
  });

  it("LinkedIn gets a landscape crop; highest quality uses the quality model", async () => {
    const { t, id } = await tenantWithPost("en", "LINKEDIN");
    const asset = await requestImage(t.scope, t.user.id, id, { quality: "quality", mode: "ai_creative" });
    await runImageJob(asset.id);
    const done = await db.contentAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(done).toMatchObject({ preset: "landscape", width: 1200, height: 627, model: "gpt-image-quality-test" });
    expect(imageCalls[0]).toMatchObject({ size: "1536x1024", quality: "quality" });
  });

  it("variants and edits are separate assets; history is kept; edits send the reference image", async () => {
    const { t, id } = await tenantWithPost();
    const first = await requestImage(t.scope, t.user.id, id, {});
    await runImageJob(first.id);
    const variant = await requestImage(t.scope, t.user.id, id, { variant: "simpler", parentAssetId: first.id });
    await runImageJob(variant.id);
    const edit = await requestImage(t.scope, t.user.id, id, { parentAssetId: variant.id, instruction: "خلي الخلفية أفتح" });
    expect(edit).toMatchObject({ mode: "edit", quality: "quality", parentAssetId: variant.id });
    await runImageJob(edit.id);
    expect(imageCalls.map((c) => c.kind)).toEqual(["generate", "generate", "edit"]);
    expect(imageCalls[2]).toMatchObject({ refs: 1 });
    expect(imageCalls[2].prompt).toMatch(/خلي الخلفية أفتح/);
    const all = await db.contentAsset.findMany({ where: { contentItemId: id }, orderBy: { createdAt: "asc" } });
    expect(all.map((a) => [a.status, a.isSelected])).toEqual([["COMPLETED", false], ["COMPLETED", false], ["COMPLETED", true]]);
    await selectAsset(t.scope, first.id);
    expect((await db.contentAsset.findUniqueOrThrow({ where: { id: first.id } })).isSelected).toBe(true);
    await expect(requestImage(t.scope, t.user.id, id, { instruction: "no reference" })).rejects.toMatchObject({ code: "validation" });
  });

  it("a refused request fails honestly: asset FAILED with a safe code, no retry, content intact", async () => {
    imageBehavior = async () => {
      throw new ImageProviderError("image_refused", "policy");
    };
    const { t, id } = await tenantWithPost();
    const before = await db.contentItem.findUniqueOrThrow({ where: { id } });
    const asset = await requestImage(t.scope, t.user.id, id, {});
    await expect(runImageJob(asset.id, 1, 2)).rejects.toBeInstanceOf(PermanentJobError);
    expect(await db.contentAsset.findUniqueOrThrow({ where: { id: asset.id } })).toMatchObject({ status: "FAILED", errorCode: "image_refused", fileId: null });
    const after = await db.contentItem.findUniqueOrThrow({ where: { id } });
    expect(after.caption).toBe(before.caption);
    expect(after.status).toBe(before.status);
  });

  it("transient errors retry once, then fail — never an endless loop", async () => {
    imageBehavior = async () => {
      throw new ImageProviderError("image_rate_limited", "429", true);
    };
    const { t, id } = await tenantWithPost();
    const asset = await requestImage(t.scope, t.user.id, id, {});
    await expect(runImageJob(asset.id, 1, 2)).rejects.toBeInstanceOf(ImageProviderError);
    expect((await db.contentAsset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("QUEUED");
    await expect(runImageJob(asset.id, 2, 2)).rejects.toBeInstanceOf(PermanentJobError);
    expect((await db.contentAsset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("FAILED");
  });

  it("monthly image limit per plan is enforced before anything is queued", async () => {
    const { t, id } = await tenantWithPost();
    await db.subscription.update({ where: { organizationId: t.organization.id }, data: { plan: "STARTER" } });
    const usage = await imageUsage(t.organization.id);
    await db.contentAsset.createMany({ data: Array.from({ length: usage.limit }, () => ({ ...t.scope, contentItemId: id, provider: "openai", status: "COMPLETED" as const })) });
    await expect(requestImage(t.scope, t.user.id, id, {})).rejects.toMatchObject({ code: "image_limit" });
    expect((await imageUsage(t.organization.id)).used).toBe(usage.limit);
  });

  it("tenant isolation: another workspace can't queue, select or edit this post's images", async () => {
    const { t, id } = await tenantWithPost();
    const other = await makeTenant("Other");
    const asset = await requestImage(t.scope, t.user.id, id, {});
    await runImageJob(asset.id);
    await expect(requestImage(other.scope, other.user.id, id, {})).rejects.toMatchObject({ code: "content_not_found" });
    await expect(selectAsset(other.scope, asset.id)).rejects.toMatchObject({ code: "item_not_found" });
    await expect(improveContent(other.scope, id)).rejects.toMatchObject({ code: "content_not_found" });
  });
});

describe("week proposal", () => {
  it("proposes a mix grounded in the performance context (no data → says so) and records the prompt version", async () => {
    responses.week_proposal = () => ({ summary: "Balanced week", days: [
      { day: "MON", type: "Educational", platform: "INSTAGRAM", format: "CAROUSEL", topic: "Hydration basics", reason: "Start the week with value" },
      { day: "WED", type: "Offer", platform: "INSTAGRAM", format: "POST", topic: "Consultation", reason: "Mid-week conversion" },
      { day: "SAT", type: "Engagement", platform: "FACEBOOK", format: "POST", topic: "Your skin question", reason: "Weekend conversation" },
    ] });
    const { t } = await tenantWithPost("en");
    const p = await proposeWeek(t.scope, { count: 3 });
    expect(p.days).toHaveLength(3);
    expect(p.promptVersion).toBe("content_strategy@1");
    expect(calls.at(-1)!.system).toMatch(/No reliable performance data yet/);
  });
});
