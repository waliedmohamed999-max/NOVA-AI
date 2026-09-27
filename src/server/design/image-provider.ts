import OpenAI from "openai";
import type { DesignBrief } from "../agents/schemas";

export type BrandKitInput = {
  primaryColors: string[];
  secondaryColors: string[];
  imageStyle: string | null;
  forbiddenStyles: string[];
  layoutRules: string[];
};

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

/** Image generation boundary for the AI Designer. Every request references the Brand Kit. */
export interface ImageProvider {
  readonly name: string;
  isConfigured(): boolean;
  generate(input: { prompt: string; size: ImageSize }): Promise<{ data: Buffer; mimeType: "image/png" }>;
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

class OpenAIImages implements ImageProvider {
  readonly name = "openai";
  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY) && process.env.OPENAI_IMAGE_MODEL !== "none";
  }
  async generate({ prompt, size }: { prompt: string; size: ImageSize }) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.images.generate({ model: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1", prompt, size, n: 1 });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image provider returned no image");
    return { data: Buffer.from(b64, "base64"), mimeType: "image/png" as const };
  }
}

let provider: ImageProvider = new OpenAIImages();
export const imageProvider = () => provider;
export function setImageProvider(p: ImageProvider) {
  provider = p;
}
