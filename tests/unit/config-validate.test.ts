import { describe, expect, it } from "vitest";
import pino from "pino";
import { assertStartupConfig, validateConfig } from "@/server/config/validate";

const key32 = Buffer.alloc(32, 7).toString("base64");
const good: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  APP_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db.example.com:5432/nova",
  APP_URL: "https://app.example.com",
  AUTH_SECRET: "a".repeat(20) + "9f8e7d6c5b4a3210zyx",
  ENCRYPTION_KEY: key32,
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_abcdefghijklmnop",
  EMAIL_FROM: "NOVA <hello@example.com>",
  STORAGE_DRIVER: "s3",
  S3_BUCKET: "nova-files",
  S3_ACCESS_KEY_ID: "AKIA",
  S3_SECRET_ACCESS_KEY: "secret-value",
  S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
  OPENAI_API_KEY: "sk-live-key",
  SENTRY_DSN: "https://abc@o1.ingest.sentry.io/123",
};
const keys = (env: NodeJS.ProcessEnv) => validateConfig(env).errors.map((e) => e.key);

describe("startup configuration validation", () => {
  it("a complete production configuration passes", () => {
    const r = validateConfig(good);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("production refuses missing or unsafe required settings", () => {
    expect(keys({ ...good, DATABASE_URL: "" })).toContain("DATABASE_URL");
    expect(keys({ ...good, DATABASE_URL: "postgresql://u:p@localhost:5432/nova" })).toContain("DATABASE_URL");
    expect(keys({ ...good, APP_URL: "http://localhost:3000" })).toContain("APP_URL");
    expect(keys({ ...good, AUTH_SECRET: "changeme" })).toContain("AUTH_SECRET");
    expect(keys({ ...good, ENCRYPTION_KEY: "short" })).toContain("ENCRYPTION_KEY");
  });

  it("production refuses Mailpit, local disk, demo/offline AI and test doubles", () => {
    expect(keys({ ...good, EMAIL_PROVIDER: "smtp", SMTP_HOST: "mailpit" })).toContain("SMTP_HOST");
    expect(keys({ ...good, EMAIL_PROVIDER: "", RESEND_API_KEY: "" })).toContain("EMAIL_PROVIDER");
    expect(keys({ ...good, EMAIL_FROM: "NOVA <hello@nova.local>" })).toContain("EMAIL_FROM");
    expect(keys({ ...good, STORAGE_DRIVER: "local" })).toContain("STORAGE_DRIVER");
    expect(keys({ ...good, S3_BUCKET: "" })).toContain("S3_BUCKET");
    expect(keys({ ...good, AI_DEMO_MODE: "true" })).toContain("AI_DEMO_MODE");
    expect(keys({ ...good, WHATSAPP_FAKE_TRANSPORT: "true" })).toContain("WHATSAPP_FAKE_TRANSPORT");
    expect(keys({ ...good, BRAIN_FETCH_FIXTURES: "true" })).toContain("BRAIN_FETCH_FIXTURES");
    // Offline AI is ignored in production anyway — reported, not fatal.
    expect(validateConfig({ ...good, AI_OFFLINE_MODE: "true" }).issues.find((i) => i.key === "AI_OFFLINE_MODE")?.level).toBe("warning");
    expect(keys({ ...good, STRIPE_SECRET_KEY: "sk_live_x" })).toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("local disk is only a warning with the explicit single-server opt-in", () => {
    const r = validateConfig({ ...good, STORAGE_DRIVER: "local", STORAGE_ALLOW_LOCAL_IN_PRODUCTION: "true" });
    expect(r.ok).toBe(true);
    expect(r.issues.find((i) => i.key === "STORAGE_DRIVER")?.level).toBe("warning");
  });

  it("staging keeps the security floor: secrets, HTTPS origin, hosted DB, no test doubles, no live Stripe", () => {
    const st = { ...good, APP_ENV: "staging" };
    const sec = (env: NodeJS.ProcessEnv) => validateConfig(env).securityErrors.map((e) => e.key);
    expect(sec(st)).toEqual([]);
    expect(sec({ ...st, AUTH_SECRET: "changeme" })).toContain("AUTH_SECRET");
    expect(sec({ ...st, ENCRYPTION_KEY: "short" })).toContain("ENCRYPTION_KEY");
    expect(sec({ ...st, APP_URL: "http://staging.example.com" })).toContain("APP_URL");
    expect(sec({ ...st, DATABASE_URL: "postgresql://u:p@localhost:5432/nova" })).toContain("DATABASE_URL");
    expect(sec({ ...st, WHATSAPP_FAKE_TRANSPORT: "true" })).toContain("WHATSAPP_FAKE_TRANSPORT");
    expect(sec({ ...st, BRAIN_FETCH_FIXTURES: "true" })).toContain("BRAIN_FETCH_FIXTURES");
    expect(sec({ ...st, STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_WEBHOOK_SECRET: "whsec_x" })).toContain("STRIPE_SECRET_KEY");
    expect(sec({ ...st, STRIPE_SECRET_KEY: "sk_test_abc" })).toContain("STRIPE_WEBHOOK_SECRET");
    // Functional gaps are reported but are not part of the security floor.
    expect(sec({ ...st, STORAGE_DRIVER: "local", SMTP_HOST: "mailpit", EMAIL_PROVIDER: "smtp" })).toEqual([]);
  });

  it("staging allows demo AI; development tolerates missing secrets", () => {
    expect(keys({ ...good, APP_ENV: "staging", AI_DEMO_MODE: "true" })).not.toContain("AI_DEMO_MODE");
    expect(validateConfig({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost:5434/nova" }).ok).toBe(true);
  });

  it("assertStartupConfig throws only in production, and never logs values", () => {
    const lines: string[] = [];
    const log = { error: (_o: object, m: string) => lines.push(m), warn: (_o: object, m: string) => lines.push(m), info: (_o: object, m: string) => lines.push(m) };
    expect(() => assertStartupConfig(log, { ...good, AUTH_SECRET: "" })).toThrow(/Refusing to start in production/);
    // Staging starts with functional gaps (storage/email/demo AI) but not with a broken security floor.
    expect(() => assertStartupConfig(log, { ...good, APP_ENV: "staging", STORAGE_DRIVER: "local", EMAIL_PROVIDER: "", RESEND_API_KEY: "", AI_DEMO_MODE: "true" })).not.toThrow();
    expect(() => assertStartupConfig(log, { ...good, APP_ENV: "staging", AUTH_SECRET: "" })).toThrow(/Refusing to start in staging: .*AUTH_SECRET/);
    expect(lines.join("\n")).not.toContain(good.RESEND_API_KEY!);
    expect(lines.join("\n")).not.toContain(key32);
  });

  it("works with a real pino logger (log methods keep their `this`) and reports every issue", () => {
    const lines: string[] = [];
    const log = pino({ level: "info" }, { write: (l: string) => void lines.push(l) });
    const bad = { ...good, APP_ENV: "staging", AI_DEMO_MODE: "true" };
    expect(() => assertStartupConfig(log, bad)).not.toThrow();
    expect(() => assertStartupConfig(log, { ...good, AI_DEMO_MODE: "true" })).toThrow(/Refusing to start in production/);
    expect(lines.some((l) => l.includes("[config] AI_DEMO_MODE"))).toBe(true);
    // Values never reach the log, only names.
    expect(lines.join("")).not.toContain(good.RESEND_API_KEY!);
  });
});
