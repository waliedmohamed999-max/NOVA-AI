// Applies pending database migrations before `next build`, so every deploy (Hostinger, Vercel, CI)
// brings the database schema up to date by itself — no manual `npm run db:migrate` from a laptop.
//
// - Only `prisma migrate deploy`: applies committed migrations in order; never resets or drops data.
// - No DATABASE_URL (e.g. a build without database access) → skipped with a warning.
// - SKIP_DB_MIGRATE=true → skipped (for builds that must not touch the database).
// - A failed migration fails the build, so a release never runs against an outdated schema.
import "dotenv/config";
import { spawnSync } from "node:child_process";

const url = (process.env.DATABASE_URL ?? "").trim();
if (process.env.SKIP_DB_MIGRATE === "true") {
  console.log("[migrate] SKIP_DB_MIGRATE=true — skipping database migrations.");
  process.exit(0);
}
if (!url) {
  console.warn("[migrate] DATABASE_URL is not set in this build — skipping migrations. Run `npm run db:migrate` where the database is reachable.");
  process.exit(0);
}

console.log("[migrate] Applying pending database migrations (prisma migrate deploy)…");
const r = spawnSync("npx prisma migrate deploy", { stdio: "inherit", shell: true });
if (r.status !== 0) {
  console.error("[migrate] Migrations failed — stopping the build so the app never runs against an outdated database.");
  process.exit(r.status ?? 1);
}
console.log("[migrate] Database schema is up to date.");
