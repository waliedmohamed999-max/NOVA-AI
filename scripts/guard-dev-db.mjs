// Refuses developer-only database commands (migrate dev, reset, seed) against anything but a local database,
// and whenever the environment says production/staging. These commands can drop data.
import "dotenv/config";

const url = (process.env.DATABASE_URL ?? "").trim();
const env = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "").toLowerCase();
let host = "";
try {
  host = new URL(url).hostname;
} catch {
  /* invalid URL: refused below */
}
const local = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal", "postgres", "db"].includes(host);
if (!local || env === "production" || env === "staging") {
  console.error(`[guard] Refusing a development database command: ${!local ? `DATABASE_URL points at "${host || "an invalid host"}", not a local database` : `APP_ENV/NODE_ENV is ${env}`}.`);
  console.error("[guard] Production uses `npm run db:migrate` (prisma migrate deploy) only.");
  process.exit(1);
}
