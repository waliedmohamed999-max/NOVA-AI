import "dotenv/config";
import pg from "pg";

/**
 * The suite signs up many accounts from one IP, which (correctly) trips the
 * production auth rate limits. Reset the buckets before each run instead of
 * weakening the limits.
 */
export default async function globalSetup() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`DELETE FROM "rate_limit_buckets" WHERE "key" LIKE 'auth:%' OR "key" LIKE 'action:%' OR "key" LIKE 'onboarding:%'`);
  await client.end();
}
