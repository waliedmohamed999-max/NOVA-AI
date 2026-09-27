import OpenAI, { toFile } from "openai";
import type { DesignBrief } from "../agents/schemas";

export type BrandKitInput = {
  primaryColors: string[];
  secondaryColors: string[];
  imageStyle: string | null;
  forbiddenStyles: string[];
  layoutRules: string[];
};

/** Sizes GPT Image can generate natively. Social sizes are produced by a safe crop/resize afterwards. */
export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export type ImageQuality = "fast" | "quality";

export type ImageResult = { data: Buffer; mimeType: "image/png"; model: string; costMicro: bigint };

/** Why an image request failed — mapped to customer-safe messages, raw provider errors stay in logs. */
export class ImageProviderError extends Error {
  constructor(
    public code: "image_refused" | "image_rate_limited" | "image_failed" | "image_not_configured",
    message: string,
    public retryable = false,
  ) {
    super(message);
    this.name = "ImageProviderError";
  }
}

/** Image generation boundary for the AI Designer. Every request references the Brand Kit. */
export interface ImageProvider {
  readonly name: string;
  isConfigured(): boolean;
  models(): { fast: string; quality: string };
  generate(input: { prompt: string; size: ImageSize; quality?: ImageQuality }): Promise<ImageResult>;
  /** Edits with one or more reference images (the current design, a product photo…). */
  edit(input: { images: Buffer[]; prompt: string; size: ImageSize; quality?: ImageQuality }): Promise<ImageResult>;
}

/** Output presets: what we ask the model for, and the exact social size we deliver. */
export const IMAGE_PRESETS = {
  square: { generate: "1024x1024", width: 1080, height: 1080 },
  portrait: { generate: "1024x1536", width: 1080, height: 1350 },
  story: { generate: "1024x1536", width: 1080, height: 1920 },
  landscape: { generate: "1536x1024", width: 1200, height: 627 },
  facebook_landscape: { generate: "1536x1024", width: 1200, height: 630 },
} as const satisfies Record<string, { generate: ImageSize; width: number; height: number }>;
export type ImagePreset = keyof typeof IMAGE_PRESETS;

export function presetFor(platform: string, format: string): ImagePreset {
  if (format === "STORY" || format === "REEL" || format === "SHORT_VIDEO") return "story";
  if (platform === "LINKEDIN" || format === "LINKEDIN_POST") return "landscape";
  if (platform === "INSTAGRAM" && format === "CAROUSEL") return "portrait";
  return "square";
}

/** Composes a brand-constrained image prompt from a design brief. Pure — unit tested. */
export function buildImagePrompt(brief: DesignBrief, kit: BrandKitInput, format: string): string {
  return [
    `Social media ${format.toLowerCase().replace("_", " ")} creative.`,
    `Concept: ${brief.concept}.`,
    `Layout: ${brief.layout}.`,
    brief.visualElements.length ? `Include: ${brief.visualElements.join(", ")}.` : null,
    kit.primaryColors.length ? `Use the brand palette: ${[...kit.primaryColors, ...kit.secondaryColors].join(", ")}.` : null,
    kit.imageStyle ? `Image style: ${kit.imageStyle}.` : null,
    kit.layoutRules.length ? `Layout rules: ${kit.layoutRules.join("; ")}.` : null,
    kit.forbiddenStyles.length ? `Avoid: ${kit.forbiddenStyles.join(", ")}.` : null,
    "Do not render any text in the image; captions are added separately.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function sizeForFormat(format: string): ImageSize {
  if (format === "STORY" || format === "REEL" || format === "SHORT_VIDEO" || format === "CAROUSEL") return "1024x1536";
  if (format === "LINKEDIN_POST") return "1536x1024";
  return "1024x1024";
}

/** Estimated cost per image in micro-USD (env-configurable; OpenAI pricing changes). */
export function estimatedImageCostMicro(quality: ImageQuality, env: NodeJS.ProcessEnv = process.env): bigint {
  const usd = Number(quality === "quality" ? (env.OPENAI_IMAGE_COST_QUALITY_USD ?? 0.17) : (env.OPENAI_IMAGE_COST_FAST_USD ?? 0.04));
  return BigInt(Math.round((Number.isFinite(usd) ? usd : 0) * 1_000_000));
}

export function imageModels(env: NodeJS.ProcessEnv = process.env) {
  const fallback = env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  return { fast: env.OPENAI_IMAGE_MODEL_FAST || fallback, quality: env.OPENAI_IMAGE_MODEL_QUALITY || fallback };
}

function mapError(err: unknown): ImageProviderError {
  const e = err as { status?: number; code?: string; error?: { code?: string; type?: string } };
  const code = e?.code ?? e?.error?.code ?? "";
  if (/moderation|content_policy|safety|image_generation_user_error/i.test(code)) return new ImageProviderError("image_refused", "Image request was declined by the provider's safety system");
  if (e?.status === 429) return new ImageProviderError("image_rate_limited", "Image provider rate limit", true);
  if (typeof e?.status === "number" && e.status >= 500) return new ImageProviderError("image_failed", `Image provider error ${e.status}`, true);
  return new ImageProviderError("image_failed", err instanceof Error ? err.message : "Image provider error");
}

class OpenAIImages implements ImageProvider {
  readonly name = "openai";
  private client?: OpenAI;
  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY) && process.env.OPENAI_IMAGE_MODEL !== "none";
  }
  models() {
    return imageModels();
  }
  private sdk() {
    this.client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1, timeout: 180_000 });
    return this.client;
  }
  private result(res: OpenAI.Images.ImagesResponse, model: string, quality: ImageQuality): ImageResult {
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new ImageProviderError("image_failed", "Image provider returned no image");
    // Decoded server-side and handed to storage — base64 never reaches the database.
    return { data: Buffer.from(b64, "base64"), mimeType: "image/png", model, costMicro: estimatedImageCostMicro(quality) };
  }
  async generate({ prompt, size, quality = "fast" }: { prompt: string; size: ImageSize; quality?: ImageQuality }) {
    if (!this.isConfigured()) throw new ImageProviderError("image_not_configured", "OpenAI images not configured");
    const model = quality === "quality" ? this.models().quality : this.models().fast;
    try {
      return this.result(await this.sdk().images.generate({ model, prompt, size, n: 1 }), model, quality);
    } catch (err) {
      throw err instanceof ImageProviderError ? err : mapError(err);
    }
  }
  async edit({ images, prompt, size, quality = "quality" }: { images: Buffer[]; prompt: string; size: ImageSize; quality?: ImageQuality }) {
    if (!this.isConfigured()) throw new ImageProviderError("image_not_configured", "OpenAI images not configured");
    const model = quality === "quality" ? this.models().quality : this.models().fast;
    try {
      const files = await Promise.all(images.slice(0, 4).map((b, i) => toFile(b, `reference-${i}.png`, { type: "image/png" })));
      return this.result(await this.sdk().images.edit({ model, image: files.length === 1 ? files[0] : files, prompt, size, n: 1 }), model, quality);
    } catch (err) {
      throw err instanceof ImageProviderError ? err : mapError(err);
    }
  }
}

let provider: ImageProvider = new OpenAIImages();
export const imageProvider = () => provider;
export function setImageProvider(p: ImageProvider) {
  provider = p;
}
