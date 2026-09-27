import type { AiTaskType } from "@/generated/prisma/enums";
import { modelCatalog, TASK_QUALITY } from "./models";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAIProvider } from "./providers/openai";
import { OfflineProvider } from "./providers/offline";
import type { LLMProvider, ModelSpec, ProviderName, QualityTier, RouteRequest } from "./types";

const providers: Record<ProviderName, LLMProvider> = {
  anthropic: new AnthropicProvider(),
  openai: new OpenAIProvider(),
  offline: new OfflineProvider(),
};

export function getProvider(name: ProviderName): LLMProvider {
  return providers[name];
}

/** Test hook: replace a provider implementation. */
export function setProvider(name: ProviderName, provider: LLMProvider) {
  providers[name] = provider;
}

export function configuredProviders(): ProviderName[] {
  const real = (["anthropic", "openai"] as const).filter((p) => providers[p].isConfigured());
  if (real.length) return real;
  return providers.offline.isConfigured() ? ["offline"] : [];
}

// ── Availability: a tiny in-process circuit breaker per provider ──
const failures = new Map<ProviderName, number[]>();
const WINDOW_MS = 60_000;
const THRESHOLD = 3;

export function reportFailure(p: ProviderName) {
  const now = Date.now();
  failures.set(p, [...(failures.get(p) ?? []).filter((t) => now - t < WINDOW_MS), now]);
}
export function reportSuccess(p: ProviderName) {
  failures.delete(p);
}
function isTripped(p: ProviderName) {
  const now = Date.now();
  return (failures.get(p) ?? []).filter((t) => now - t < WINDOW_MS).length >= THRESHOLD;
}

const TIER_ORDER: QualityTier[] = ["fast", "balanced", "best"];

/** Lower the tier by one step (used when an org is past its soft budget limit). */
export function downgrade(tier: QualityTier): QualityTier {
  return TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(tier) - 1)];
}

/**
 * Returns candidate models in the order they should be tried.
 * Ranking: preferred provider → exact tier match → nearest tier (higher first) → cheaper.
 * Context size and vision requirements filter candidates; tripped providers go last.
 */
export function routeModels(req: RouteRequest, opts: { costSaving?: boolean } = {}): ModelSpec[] {
  const available = new Set(configuredProviders());
  let target = req.quality ?? TASK_QUALITY[req.task as AiTaskType];
  if (opts.costSaving) target = downgrade(target);
  const primary = (process.env.AI_PRIMARY_PROVIDER as ProviderName | undefined) ?? "anthropic";
  const t = TIER_ORDER.indexOf(target);

  return modelCatalog()
    .filter((m) => available.has(m.provider))
    .filter((m) => !req.contextTokens || m.contextTokens >= req.contextTokens)
    .filter((m) => !req.needsVision || m.vision)
    .map((m) => {
      const d = TIER_ORDER.indexOf(m.tier) - t;
      const tierScore = d === 0 ? 0 : d > 0 ? d * 2 - 1 : -d * 2; // prefer one-up over one-down
      return {
        m,
        score: (isTripped(m.provider) ? 1000 : 0) + tierScore * 10 + (m.provider === primary ? 0 : 5) + m.inputMicroPerMTok / 1e9,
      };
    })
    .sort((a, b) => a.score - b.score)
    .map((x) => x.m);
}
