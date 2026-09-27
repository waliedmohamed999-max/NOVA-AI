import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { getProvider, reportSuccess, setProvider } from "@/server/ai/router";
import type { GenerateRequest, LLMProvider, StructuredResult } from "@/server/ai/types";
import { AiError } from "@/server/ai/types";
import { setStorageDriver, type StorageDriver } from "@/server/storage";
import { editSlide, generateCarousel, listSlides, regenerateSlide, renderCarouselPreview, restoreSlide } from "@/server/studio/carousel";
import { generateVideoPlan, readVideoPlan, renderReelCover, videoProvider } from "@/server/studio/video";

/** Carousel + reel planning with a fake OpenAI (no automated test calls a real model). */
const originalOpenAI = getProvider("openai");
let calls: { schemaName: string; prompt: string }[] = [];
let responses: Record<string, (n: number) => unknown> = {};
function fakeOpenAI(): LLMProvider {
  return {
    name: "openai",
    isConfigured: () => true,
    generateStructured: async <S extends z.ZodType>(req: GenerateRequest & { schema: S; schemaName: string }): Promise<StructuredResult<z.output<S>>> => {
      const n = calls.filter((c) => c.schemaName === req.schemaName).length;
      calls.push({ schemaName: req.schemaName, prompt: req.messages.map((m) => m.content).join("\n") });
      const make = responses[req.schemaName];
      if (!make) throw new AiError("ai_failed", `no fake for ${req.schemaName}`);
      const parsed = req.schema.safeParse(make(n));
      if (!parsed.success) throw new AiError("ai_invalid_output", "schema mismatch");
      return { data: parsed.data as z.output<S>, usage: { inputTokens: 900, outputTokens: 300 }, model: "gpt-test-text" };
    },
  } as unknown as LLMProvider;
}
const objects = new Map<string, Buffer>();
const memory: StorageDriver = { name: "memory", put: async (k, d) => void objects.set(k, d), get: async (k) => objects.get(k)!, delete: async (k) => void objects.delete(k) };

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test-not-real";
  setProvider("openai", fakeOpenAI());
  setStorageDriver(memory);
  calls = [];
  responses = {
    carousel: () => ({
      outline: ["Hook", "Mistake 1", "Mistake 2", "Mistake 3", "CTA"],
      slides: [
        { headline: "٣ أخطاء تخسّرك عملاءك", body: "", visualDirection: "Bold number 3 on a clean background" },
        { headline: "الرد المتأخر", body: "العميل اللي يستنى أكتر من ساعة يروح لمنافسك.", visualDirection: "Phone with unread messages" },
        { headline: "عرض غير واضح", body: "لو العميل مش فاهم بتبيع إيه، مش هيشتري.", visualDirection: "Confused customer icon" },
        { headline: "بدون متابعة", body: "٨٠٪ من الصفقات تحتاج أكثر من متابعة.", visualDirection: "Calendar with reminders" },
        { headline: "احجز استشارة", body: "نساعدك تصلح الثلاثة في أسبوع.", visualDirection: "Brand logo" },
      ],
      caption: "٣ أخطاء بسيطة… وتكلفتها كبيرة.",
      cta: "احجز استشارة مجانية",
    }),
    carousel_slide: (n) => ({ headline: `عنوان جديد ${n + 1}`, body: "نص أوضح وأقصر.", visualDirection: "Clean minimal" }),
    video_plan: () => ({
      concept: "Owner explains 3 mistakes in 30 seconds",
      hook: "Stop losing customers to slow replies",
      durationSec: 30,
      scenes: [
        { order: 1, durationSec: 4, shot: "Close-up, owner to camera", voiceOver: "Stop losing customers.", onScreenText: "3 mistakes", assetNeeded: "" },
        { order: 2, durationSec: 12, shot: "Screen recording of inbox", voiceOver: "Mistake one: slow replies.", onScreenText: "Slow replies", assetNeeded: "Screen recording of your inbox" },
        { order: 3, durationSec: 12, shot: "Owner at desk", voiceOver: "Fix it with an assistant.", onScreenText: "Reply in minutes", assetNeeded: "" },
      ],
      shotList: ["Close-up intro", "Inbox screen recording", "Desk medium shot"],
      caption: "Three mistakes, one fix.",
      coverText: "3 mistakes",
      music: "Upbeat, minimal",
    }),
  };
});
afterEach(() => {
  process.env.OPENAI_API_KEY = "";
  setProvider("openai", originalOpenAI);
  setStorageDriver(null);
  reportSuccess("openai");
});

async function carouselPost(t: Awaited<ReturnType<typeof makeTenant>>, format: "CAROUSEL" | "REEL" | "POST" = "CAROUSEL") {
  return db.contentItem.create({ data: { ...t.scope, title: "Mistakes", caption: "x", cta: "احجز استشارة", format, platform: "INSTAGRAM", status: "DRAFT" } });
}

describe("carousel generation", () => {
  it("generates slides, rewrites ONE slide with history, edits and restores it", async () => {
    const t = await makeTenant("متجر لوما", "ar");
    const item = await carouselPost(t);
    const r = await generateCarousel(t.scope, item.id, { slideCount: 5, userId: t.user.id });
    expect(r.slides.map((s) => s.position)).toEqual([1, 2, 3, 4, 5]);
    expect(calls[0].prompt).toContain("5-slide INSTAGRAM carousel");

    const s2 = r.slides[1];
    const before = r.slides.map((s) => s.headline);
    await regenerateSlide(t.scope, s2.id, { instruction: "shorter", userId: t.user.id });
    const after = await listSlides(t.scope, item.id);
    expect(after[1]).toMatchObject({ headline: "عنوان جديد 1", version: 2 });
    // Only slide 2 changed.
    expect(after.filter((_, i) => i !== 1).map((s) => s.headline)).toEqual(before.filter((_, i) => i !== 1));
    expect(after[1].history.map((h) => h.source)).toEqual(["ai", "ai"]);

    await editSlide(t.scope, s2.id, { headline: "يدوي", body: "نص يدوي", visualDirection: "x" }, t.user.id);
    const restored = await restoreSlide(t.scope, s2.id, 1, t.user.id);
    expect(restored).toMatchObject({ headline: "الرد المتأخر", version: 4 });
    expect(((await listSlides(t.scope, item.id))[1].history as { source: string }[]).map((h) => h.source)).toEqual(["ai", "ai", "manual", "restore"]);
  });

  it("renders brand-template previews (RTL) and replaces old preview files", async () => {
    const t = await makeTenant("نوفا", "ar");
    const item = await carouselPost(t);
    await generateCarousel(t.scope, item.id, { slideCount: 5, userId: t.user.id });
    const first = await renderCarouselPreview(t.scope, item.id, t.user.id);
    expect(first.slides.every((s) => s.previewUrl)).toBe(true);
    const files = await db.fileObject.count({ where: { organizationId: t.organization.id, purpose: "carousel_slide", deletedAt: null } });
    expect(files).toBe(5);
    await renderCarouselPreview(t.scope, item.id, t.user.id);
    expect(await db.fileObject.count({ where: { organizationId: t.organization.id, purpose: "carousel_slide", deletedAt: null } })).toBe(5);
  });

  it("refuses non-carousel posts, published posts, and other tenants' slides", async () => {
    const t = await makeTenant();
    const other = await makeTenant();
    const post = await carouselPost(t, "POST");
    await expect(generateCarousel(t.scope, post.id, { userId: t.user.id })).rejects.toMatchObject({ code: "invalid_transition" });
    const item = await carouselPost(t);
    const r = await generateCarousel(t.scope, item.id, { slideCount: 5, userId: t.user.id });
    await expect(regenerateSlide(other.scope, r.slides[0].id, { userId: other.user.id })).rejects.toMatchObject({ code: "item_not_found" });
    await expect(generateCarousel(other.scope, item.id, { userId: other.user.id })).rejects.toMatchObject({ code: "content_not_found" });
    await db.contentItem.update({ where: { id: item.id }, data: { status: "PUBLISHED" } });
    await expect(regenerateSlide(t.scope, r.slides[0].id, { userId: t.user.id })).rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("without OpenAI it says so instead of producing fake slides", async () => {
    process.env.OPENAI_API_KEY = "";
    setProvider("openai", originalOpenAI);
    const t = await makeTenant();
    const item = await carouselPost(t);
    await expect(generateCarousel(t.scope, item.id, { userId: t.user.id })).rejects.toMatchObject({ code: "content_ai_not_configured" });
    expect(await db.carouselSlide.count({ where: { contentItemId: item.id } })).toBe(0);
  });
});

describe("reel / video plan", () => {
  it("plans scenes (durations add up), stores the plan, renders a cover; no video provider is pretended", async () => {
    const t = await makeTenant();
    const item = await carouselPost(t, "REEL");
    const plan = await generateVideoPlan(t.scope, item.id, { durationSec: 30, userId: t.user.id });
    expect(plan.durationSec).toBe(28);
    expect(plan.scenes.map((s) => s.order)).toEqual([1, 2, 3]);
    const stored = readVideoPlan((await db.contentItem.findUniqueOrThrow({ where: { id: item.id } })).designBrief);
    expect(stored?.hook).toBe("Stop losing customers to slow replies");
    const cover = await renderReelCover(t.scope, item.id, t.user.id);
    expect(cover.url).toContain("/api/files/");
    expect(videoProvider().isConfigured()).toBe(false);
    await expect(videoProvider().render({ plan: stored!, aspect: "9:16", assets: [] })).rejects.toMatchObject({ code: "video_not_configured" });
  });
});
