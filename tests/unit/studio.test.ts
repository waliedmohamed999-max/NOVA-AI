import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { findDuplicates, normalize, similarity } from "@/server/studio/context";
import { buildEditPrompt, buildGenerationPrompt } from "@/server/studio/images";
import { composeBrandTemplate, wrapText } from "@/server/design/compose";
import { imageModels, presetFor, IMAGE_PRESETS } from "@/server/design/image-provider";
import { costFromUsage, estimateUsage, imagePricing, priceImage, usageFromProvider } from "@/server/design/image-cost";
import { PROMPT_VERSIONS, arabicGuide } from "@/server/ai/prompts";

describe("Arabic-aware similarity and duplication", () => {
  it("normalizes diacritics, tatweel and letter variants", () => {
    expect(normalize("إطـلالةٌ جديدة")).toBe(normalize("اطلاله جديده"));
  });
  it("detects a repeated hook but not an unrelated one", () => {
    expect(similarity("بشرتك تستحق روتينًا يفهمها", "بشرتك تستحق روتينا يفهمها!")).toBeGreaterThan(0.8);
    expect(similarity("بشرتك تستحق روتينًا يفهمها", "خصم خاص على جلسات الليزر")).toBeLessThan(0.2);
    const hits = findDuplicates({ hook: "Three habits that quietly age your skin", cta: "Book now" }, [{ id: "a", title: "x", hook: "3 habits that quietly age your skin", cta: "Book now", pillar: null, visual: null, status: "APPROVED" }]);
    expect(hits.map((h) => h.kind)).toEqual(expect.arrayContaining(["hook", "cta"]));
  });
});

describe("prompts", () => {
  it("every studio prompt is versioned", () => {
    for (const v of Object.values(PROMPT_VERSIONS)) expect(v).toMatch(/^[a-z_]+@\d+$/);
  });
  it("Arabic guidance: native (not translated), brand names kept, few emojis/hashtags, dialect when set", () => {
    const g = arabicGuide("ar", "لهجة خليجية ودودة");
    expect(g).toMatch(/never a literal translation/);
    expect(g).toMatch(/brand names/);
    expect(g).toMatch(/لهجة خليجية/);
  });
  it("brand-template prompts forbid text in the image (NOVA typesets it)", () => {
    const p = buildGenerationPrompt({ concept: "c", scene: "s", composition: "x", mood: "m", headline: "h" }, { colors: ["#111111"], imageStyle: "soft light", forbidden: ["neon"] }, { mode: "brand_template", preset: "square" });
    expect(p).toMatch(/Do not render any text/);
    expect(p).toMatch(/#111111/);
    expect(p).toMatch(/Avoid: neon/);
    expect(buildEditPrompt("make the background lighter", { colors: [], forbidden: [] })).toMatch(/Keep everything else the same/);
  });
});

describe("sizes, models, cost", () => {
  it("maps platforms/formats to supported generation sizes and exact social outputs", () => {
    expect(presetFor("INSTAGRAM", "POST")).toBe("square");
    expect(presetFor("INSTAGRAM", "CAROUSEL")).toBe("portrait");
    expect(presetFor("TIKTOK", "SHORT_VIDEO")).toBe("story");
    expect(presetFor("LINKEDIN", "LINKEDIN_POST")).toBe("landscape");
    expect(IMAGE_PRESETS.story).toMatchObject({ generate: "1024x1536", width: 1080, height: 1920 });
  });
  it("image models are configuration", () => {
    expect(imageModels({ OPENAI_IMAGE_MODEL_FAST: "gpt-image-2.5-flare", OPENAI_IMAGE_MODEL_QUALITY: "gpt-image-2.5-sunburst" } as unknown as NodeJS.ProcessEnv)).toEqual({ fast: "gpt-image-2.5-flare", quality: "gpt-image-2.5-sunburst" });
    expect(imageModels({} as unknown as NodeJS.ProcessEnv)).toEqual({ fast: "gpt-image-1", quality: "gpt-image-1" });
  });
});

describe("composition layer", () => {
  it("wraps headlines to a few lines with an ellipsis when too long", () => {
    const lines = wrapText("one two three four five six seven eight nine ten eleven twelve", 12, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });
  it("renders an Arabic brand template at the exact size", async () => {
    const bg = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#c8b6a6" } }).png().toBuffer();
    const out = await composeBrandTemplate(bg, { width: 1080, height: 1350, headline: "بشرة أنقى في 4 أسابيع", cta: "احجزي استشارتك", brandName: "لوما", primary: "#2f3e46", secondary: "#f4e3d7" });
    expect(await sharp(out).metadata()).toMatchObject({ width: 1080, height: 1350, format: "png" });
  });
});

describe("token-based image pricing", () => {
  const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
  it("defaults to GPT Image 2.5 list prices and is overridable", () => {
    expect(imagePricing(env({}))).toMatchObject({ textInputPerM: 5, imageInputPerM: 8, imageOutputPerM: 30 });
    expect(imagePricing(env({ OPENAI_IMAGE_TEXT_INPUT_USD_PER_1M: "6", OPENAI_IMAGE_PRICING_VERSION: "v2" }))).toMatchObject({ textInputPerM: 6, version: "v2" });
    expect(imagePricing(env({ OPENAI_IMAGE_IMAGE_OUTPUT_USD_PER_1M: "abc" })).imageOutputPerM).toBe(30); // invalid → default
  });
  it("prices text input, image input and image output tokens separately", () => {
    const p = imagePricing(env({}));
    expect(costFromUsage({ textInputTokens: 1_000_000, imageInputTokens: 0, outputTokens: 0 }, p)).toBe(5_000_000n); // $5
    expect(costFromUsage({ textInputTokens: 0, imageInputTokens: 1_000_000, outputTokens: 0 }, p)).toBe(8_000_000n); // $8
    expect(costFromUsage({ textInputTokens: 0, imageInputTokens: 0, outputTokens: 1_000_000 }, p)).toBe(30_000_000n); // $30
  });
  it("uses provider usage when complete; edits need the text/image split", () => {
    expect(usageFromProvider({ input_tokens: 100, output_tokens: 4000, input_tokens_details: { text_tokens: 40, image_tokens: 60 } }, 1)).toEqual({ textInputTokens: 40, imageInputTokens: 60, outputTokens: 4000 });
    expect(usageFromProvider({ input_tokens: 100, output_tokens: 4000 }, 0)).toEqual({ textInputTokens: 100, imageInputTokens: 0, outputTokens: 4000 });
    expect(usageFromProvider({ input_tokens: 100, output_tokens: 4000 }, 1)).toBeNull(); // can't split an edit's input
    expect(usageFromProvider(undefined, 0)).toBeNull();
  });
  it("falls back to a labelled estimate that still charges reference images", () => {
    const e = estimateUsage({ promptChars: 400, referenceImages: 2, size: "1024x1024" }, env({}));
    expect(e).toEqual({ textInputTokens: 100, imageInputTokens: 3000, outputTokens: 4000 });
    const c = priceImage(null, { promptChars: 400, referenceImages: 2, size: "1024x1024" }, env({}));
    expect(c.basis).toBe("estimated");
    const a = priceImage({ input_tokens: 10, output_tokens: 20, input_tokens_details: { text_tokens: 10, image_tokens: 0 } }, { promptChars: 1, referenceImages: 0, size: "1024x1024" }, env({}));
    expect(a).toMatchObject({ basis: "actual_usage", costMicro: 10n * 5n + 20n * 30n });
  });
});
