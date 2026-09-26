import { z } from "zod";

/**
 * Validated server environment. Optional provider credentials unlock
 * integrations; when absent the product shows a "connect" state instead of
 * pretending the integration works.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: z.string().min(40, "ENCRYPTION_KEY must be a base64 32-byte key"),

  // Email
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default("NOVA <hello@nova.local>"),

  // Google sign-in
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // AI
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_OFFLINE_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Social providers
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),

  // Billing
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_GROWTH: z.string().optional(),
  STRIPE_PRICE_SCALE: z.string().optional(),

  // Storage
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".storage"),

  // Observability
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  SENTRY_DSN: z.string().optional(),

  // Internal cron trigger (for platforms without a long-running worker)
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.AI_OFFLINE_MODE) {
    throw new Error("AI_OFFLINE_MODE must not be enabled in production.");
  }
  cached = parsed.data;
  return cached;
}

export const isProd = () => env().NODE_ENV === "production";
