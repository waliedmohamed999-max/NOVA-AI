import "dotenv/config";

// Tests always run against the dedicated test database with the offline AI provider.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.AI_OFFLINE_MODE = "true";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.SMTP_HOST = "";
process.env.LOG_LEVEL = "silent";
