/**
 * Prompt registry. Every studio prompt lives here with a version; the version is recorded on the
 * ai_runs row (and on content versions / assets), so output can always be traced to the exact prompt.
 * Bump the version whenever the wording changes. Components never build prompts.
 */
export type PromptKey =
  | "content_strategy"
  | "caption_generation"
  | "content_improvement"
  | "visual_direction"
  | "image_generation"
  | "image_edit"
  | "performance_analysis"
  | "content_quality"
  | "carousel_generation"
  | "carousel_slide"
  | "video_plan";

export const PROMPT_VERSIONS: Record<PromptKey, string> = {
  content_strategy: "content_strategy@1",
  caption_generation: "caption_generation@1",
  content_improvement: "content_improvement@1",
  visual_direction: "visual_direction@1",
  image_generation: "image_generation@1",
  image_edit: "image_edit@1",
  performance_analysis: "performance_analysis@1",
  content_quality: "content_quality@1",
  carousel_generation: "carousel_generation@1",
  carousel_slide: "carousel_slide@1",
  video_plan: "video_plan@1",
};

export const promptRef = (key: PromptKey) => ({ key, version: PROMPT_VERSIONS[key] });

/** How each platform is written for. Captions are never copied across platforms. */
export const PLATFORM_GUIDE: Record<string, string> = {
  INSTAGRAM: "Instagram: a scroll-stopping first line (the hook), a readable caption with short lines, a clear CTA, and 3–6 relevant hashtags only when they help discovery.",
  LINKEDIN:
    "LinkedIn: professional but conversational. A strong opening line that earns the 'see more' click, short paragraphs separated by blank lines, one concrete insight or example, a relevant CTA. 0–3 hashtags.",
  FACEBOOK: "Facebook: natural, friendly social copy that reads like a person talking, a clear CTA, few or no hashtags.",
  TIKTOK: "TikTok / Reels: a spoken hook for the first 2 seconds, a short caption, a simple video concept (scenes), and on-screen text suggestions. Few hashtags.",
};

export function arabicGuide(locale: "ar" | "en", dialect?: string | null) {
  if (locale !== "ar") return "Write in natural, idiomatic English.";
  return [
    "Write natural Arabic as a native copywriter would — never a literal translation of English.",
    dialect ? `Use this voice/dialect from the brand settings: ${dialect}.` : "Use clear Modern Standard Arabic suited to the region unless the brand voice says otherwise.",
    "Keep product and brand names exactly as given (do not translate or transliterate them).",
    "Emojis: at most one or two, only when they fit the brand. Hashtags: few and relevant — never a long random list.",
  ].join(" ");
}

export const STUDIO_RULES = [
  "Never invent statistics, testimonials, prices, discounts or guarantees that are not in the company information.",
  "Respect the brand's 'Never' list and forbidden claims strictly.",
  "Do not reveal your reasoning process. When asked why a version is better, give 2–3 short, concrete reasons tied to the data provided.",
].join(" ");
