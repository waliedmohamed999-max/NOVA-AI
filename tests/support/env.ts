import "dotenv/config";

// Tests always run against the dedicated test database with the offline AI provider.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.AI_OFFLINE_MODE = "true";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.SMTP_HOST = "";
process.env.LOG_LEVEL = "silent";

// Never use real OAuth app credentials in tests (the developer's .env may contain them).
// Provider HTTP is always mocked; these dummies only make providers "configured".
for (const [k, v] of Object.entries({
  META_APP_ID: "1234567890123456",
  META_APP_SECRET: "0123456789abcdef0123456789abcdef",
  META_REDIRECT_URI: "",
  META_PERMISSION_MODE: "minimal",
  META_OAUTH_SCOPES: "",
  META_OPTIONAL_SCOPES: "",
  META_LOGIN_CONFIG_ID: "",
  INSTAGRAM_APP_ID: "5555555555555555",
  INSTAGRAM_APP_SECRET: "abcdef0123456789abcdef0123456789",
  INSTAGRAM_REDIRECT_URI: "",
  INSTAGRAM_OAUTH_SCOPES: "",
  INSTAGRAM_OPTIONAL_SCOPES: "",
  LINKEDIN_CLIENT_ID: "test-li-client",
  LINKEDIN_CLIENT_SECRET: "test-li-secret",
  LINKEDIN_REDIRECT_URI: "",
  LINKEDIN_ORGANIZATION_ACCESS: "false",
  TIKTOK_CLIENT_KEY: "",
  TIKTOK_CLIENT_SECRET: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
}))
  process.env[k] = v;
