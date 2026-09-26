import pino from "pino";

/**
 * Structured logger. Secrets are redacted by key name so an accidental
 * `log.info({ token })` never reaches log storage.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
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
