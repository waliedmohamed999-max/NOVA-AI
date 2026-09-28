import pino from "pino";

const configuredLevel = process.env.LOG_LEVEL?.trim().toLowerCase();
const defaultLevel = process.env.NODE_ENV === "test" ? "silent" : "info";
// Hosting dashboards can supply an empty or invalid value instead of omitting it.
// Pino throws during module loading unless the level is one it recognizes.
const level = configuredLevel && ["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(configuredLevel)
  ? configuredLevel
  : defaultLevel;

/**
 * Structured logger. Secrets are redacted by key name so an accidental
 * `log.info({ token })` never reaches log storage.
 */
export const logger = pino({
  level,
  base: { service: process.env.NOVA_PROCESS ?? "web" },
  redact: {
    paths: [
      "password",
      "*.password",
      "passwordHash",
      "*.passwordHash",
      "token",
      "*.token",
      "accessToken",
      "*.accessToken",
      "refreshToken",
      "*.refreshToken",
      "apiKey",
      "*.apiKey",
      "authorization",
      "*.authorization",
      "headers.cookie",
      "cookie",
      "secret",
      "*.secret",
      "code",
      "*.code",
    ],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
