// Applies pending database migrations before `next build` (and via `npm run db:migrate`), so every deploy
// brings the database schema up to date by itself.
//
// Safety:
// - Only `prisma migrate deploy` (committed migrations, in order). Never `migrate dev` / `reset` / `db push`.
// - Prisma takes a PostgreSQL advisory lock, so two builds can't migrate at the same time.
// - Pending migrations are scanned first: destructive statements (DROP TABLE/COLUMN/SCHEMA/TYPE/INDEX/VIEW,
//   TRUNCATE, DELETE FROM, ALTER COLUMN … TYPE) stop the build unless ALLOW_DESTRUCTIVE_MIGRATIONS=true is
//   set for that one release — after a backup, per docs/DATABASE.md "Destructive migrations".
// - Migrations must stay additive/backward compatible: the previous release keeps serving traffic while the
//   new one builds (expand → deploy → contract in a later release).
// - No DATABASE_URL → skipped with a warning. SKIP_DB_MIGRATE=true → skipped.
// - A failed migration fails the build, so a release never runs against an outdated schema.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { destructiveStatements } from "./migration-guard.mjs";

const url = (process.env.DATABASE_URL ?? "").trim();
if (process.env.SKIP_DB_MIGRATE === "true") {
  console.log("[migrate] SKIP_DB_MIGRATE=true — skipping database migrations.");
  process.exit(0);
}
if (!url) {
  console.warn("[migrate] DATABASE_URL is not set in this build — skipping migrations. Run `npm run db:migrate` where the database is reachable.");
  process.exit(0);
}

async function appliedMigrations() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const exists = await client.query(`SELECT to_regclass('public._prisma_migrations') AS t`);
    if (!exists.rows[0].t) return null; // fresh database
    const r = await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
    return new Set(r.rows.map((x) => x.migration_name));
  } finally {
    await client.end();
  }
}

const dir = path.join(process.cwd(), "prisma", "migrations");
const all = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
let applied = null;
try {
  applied = await appliedMigrations();
} catch (err) {
  console.error(`[migrate] Could not read the migration history (${err instanceof Error ? err.message.split("\n")[0] : err}).`);
  process.exit(1);
}

if (applied) {
  const pending = all.filter((m) => !applied.has(m));
  const flagged = [];
  for (const m of pending) {
    const file = path.join(dir, m, "migration.sql");
    if (!existsSync(file)) continue;
    for (const st of destructiveStatements(readFileSync(file, "utf8"))) flagged.push(`${m}: ${st}`);
  }
  if (flagged.length && process.env.ALLOW_DESTRUCTIVE_MIGRATIONS !== "true") {
    console.error("[migrate] Pending migrations contain destructive statements — refusing to apply automatically:");
    for (const f of flagged) console.error(`  - ${f}`);
    console.error("[migrate] Take a backup, review, then set ALLOW_DESTRUCTIVE_MIGRATIONS=true for this one release (docs/DATABASE.md).");
    process.exit(1);
  }
  console.log(`[migrate] ${pending.length} pending migration(s)${flagged.length ? " (destructive statements explicitly allowed)" : ""}.`);
} else {
  console.log("[migrate] Fresh database — applying all migrations.");
}

console.log("[migrate] Applying pending database migrations (prisma migrate deploy)…");
const r = spawnSync("npx prisma migrate deploy", { stdio: "inherit", shell: true });
if (r.status !== 0) {
  console.error("[migrate] Migrations failed — stopping the build so the app never runs against an outdated database.");
  process.exit(r.status ?? 1);
}
console.log("[migrate] Database schema is up to date.");
