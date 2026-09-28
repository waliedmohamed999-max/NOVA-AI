import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("logger initialization", () => {
  it.each([undefined, "", "   ", "invalid", "constructor", "\"info\""])(
    "falls back safely in production for LOG_LEVEL=%s",
    async (value) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("LOG_LEVEL", value);
      const { logger, childLogger } = await import("../../src/server/logger");
      expect(logger.level).toBe("info");
      expect(childLogger({ service: "test" }).level).toBe("info");
    },
  );

  it.each(["fatal", "error", "warn", "info", "debug", "trace", "silent"])(
    "preserves the supported %s level after normalization",
    async (level) => {
      vi.stubEnv("LOG_LEVEL", ` ${level.toUpperCase()}\n`);
      const { logger } = await import("../../src/server/logger");
      expect(logger.level).toBe(level);
    },
  );

  it("keeps test logging silent when no valid level is configured", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("LOG_LEVEL", "");
    const { logger } = await import("../../src/server/logger");
    expect(logger.level).toBe("silent");
  });
});
