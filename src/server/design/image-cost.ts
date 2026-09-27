/**
 * GPT Image cost accounting. Pricing is token-based (text input, image input, image output) and lives in
 * configuration — never a fixed price per image. When the provider returns usage we compute the cost from
 * it ("actual_usage"); otherwise we compute a clearly-labelled estimate ("estimated"), never presented
 * as the provider's actual cost.
 */
export type ImagePricing = { textInputPerM: number; imageInputPerM: number; imageOutputPerM: number; version: string };
export type ImageTokenUsage = { textInputTokens: number; imageInputTokens: number; outputTokens: number };
export type ImageCost = { costMicro: bigint; basis: "actual_usage" | "estimated"; pricingVersion: string; usage: ImageTokenUsage };

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Defaults are GPT Image 2.5 list prices (USD per 1M tokens); override with env when pricing changes. */
export function imagePricing(env: NodeJS.ProcessEnv = process.env): ImagePricing {
  return {
    textInputPerM: num(env.OPENAI_IMAGE_TEXT_INPUT_USD_PER_1M, 5),
    imageInputPerM: num(env.OPENAI_IMAGE_IMAGE_INPUT_USD_PER_1M, 8),
    imageOutputPerM: num(env.OPENAI_IMAGE_IMAGE_OUTPUT_USD_PER_1M, 30),
    version: env.OPENAI_IMAGE_PRICING_VERSION?.trim() || "gpt-image-2.5:default",
  };
}

/** USD per 1M tokens == micro-USD per token, so cost in micro-USD = Σ tokens × price. */
export function costFromUsage(u: ImageTokenUsage, p: ImagePricing): bigint {
  const micro = u.textInputTokens * p.textInputPerM + u.imageInputTokens * p.imageInputPerM + u.outputTokens * p.imageOutputPerM;
  return BigInt(Math.ceil(micro));
}

type ProviderUsage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } } | null | undefined;

/**
 * Usage from the OpenAI Images response, when it is complete enough to price:
 *  - output_tokens is required;
 *  - the text/image input split is required, except for a pure generation (no reference images),
 *    where all input tokens are text.
 */
export function usageFromProvider(u: ProviderUsage, referenceImages: number): ImageTokenUsage | null {
  if (!u || typeof u.output_tokens !== "number") return null;
  const d = u.input_tokens_details;
  if (d && typeof d.text_tokens === "number" && typeof d.image_tokens === "number") {
    return { textInputTokens: d.text_tokens, imageInputTokens: d.image_tokens, outputTokens: u.output_tokens };
  }
  if (referenceImages === 0 && typeof u.input_tokens === "number") return { textInputTokens: u.input_tokens, imageInputTokens: 0, outputTokens: u.output_tokens };
  return null;
}

/**
 * Fallback token estimate (configurable). Reference images count as image input — edits are never "free".
 * Output tokens scale with the generated area.
 */
export function estimateUsage(input: { promptChars: number; referenceImages: number; size: string }, env: NodeJS.ProcessEnv = process.env): ImageTokenUsage {
  const perRef = num(env.OPENAI_IMAGE_EST_INPUT_TOKENS_PER_REFERENCE, 1_500);
  const perMegapixel = num(env.OPENAI_IMAGE_EST_OUTPUT_TOKENS_PER_MEGAPIXEL, 4_000);
  const [w, h] = input.size.split("x").map(Number);
  const megapixels = Number.isFinite(w * h) ? (w * h) / 1_048_576 : 1;
  return { textInputTokens: Math.ceil(input.promptChars / 4), imageInputTokens: input.referenceImages * perRef, outputTokens: Math.ceil(megapixels * perMegapixel) };
}

/** Actual (from usage) when possible, otherwise a labelled estimate. */
export function priceImage(
  providerUsage: ProviderUsage,
  ctx: { promptChars: number; referenceImages: number; size: string },
  env: NodeJS.ProcessEnv = process.env,
): ImageCost {
  const pricing = imagePricing(env);
  const actual = usageFromProvider(providerUsage, ctx.referenceImages);
  const usage = actual ?? estimateUsage(ctx, env);
  return { costMicro: costFromUsage(usage, pricing), basis: actual ? "actual_usage" : "estimated", pricingVersion: pricing.version, usage };
}
