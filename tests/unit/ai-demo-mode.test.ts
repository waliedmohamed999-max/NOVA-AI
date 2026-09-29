import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineProvider } from "@/server/ai/providers/offline";

describe("demo AI (offline provider) availability", () => {
  afterEach(() => vi.unstubAllEnvs());
  const on = () => new OfflineProvider().isConfigured();

  it("AI_OFFLINE_MODE works only outside production", () => {
    vi.stubEnv("AI_DEMO_MODE", "");
    vi.stubEnv("AI_OFFLINE_MODE", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(on()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(on()).toBe(false);
  });

  it("AI_DEMO_MODE=true turns it on deliberately, production included; anything else leaves it off", () => {
    vi.stubEnv("AI_OFFLINE_MODE", "false");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AI_DEMO_MODE", "true");
    expect(on()).toBe(true);
    vi.stubEnv("AI_DEMO_MODE", "1");
    expect(on()).toBe(false);
    vi.stubEnv("AI_DEMO_MODE", "");
    expect(on()).toBe(false);
  });
});
