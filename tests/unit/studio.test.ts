import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { findDuplicates, normalize, similarity } from "@/server/studio/context";
import { buildEditPrompt, buildGenerationPrompt } from "@/server/studio/images";
import { composeBrandTemplate, wrapText } from "@/server/design/compose";
import { estimatedImageCostMicro, imageModels, presetFor, IMAGE_PRESETS } from "@/server/design/image-provider";
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
  it("image models and estimated cost are configuration", () => {
    expect(imageModels({ OPENAI_IMAGE_MODEL_FAST: "gpt-image-2.5-flare", OPENAI_IMAGE_MODEL_QUALITY: "gpt-image-2.5-sunburst" } as unknown as NodeJS.ProcessEnv)).toEqual({ fast: "gpt-image-2.5-flare", quality: "gpt-image-2.5-sunburst" });
    expect(imageModels({} as unknown as NodeJS.ProcessEnv)).toEqual({ fast: "gpt-image-1", quality: "gpt-image-1" });
    expect(estimatedImageCostMicro("quality", { OPENAI_IMAGE_COST_QUALITY_USD: "0.2" } as unknown as NodeJS.ProcessEnv)).toBe(200_000n);
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
