import "dotenv/config";
import { db } from "../src/server/db/client";
import { READINESS_PROVIDERS, validateCredentials, type ReadinessProvider } from "../src/server/admin/readiness";

/**
 * Operator CLI: run the same credential checks as /admin/providers → Validate (no publishing, no spend).
 *   npx tsx scripts/validate-providers.ts linkedin facebook
 */
const run = async () => {
  const admin = await db.user.findFirst({ where: { isPlatformAdmin: true }, select: { id: true } });
  if (!admin) throw new Error("no platform admin user to attribute the validation to");
  const wanted = (process.argv.slice(2).length ? process.argv.slice(2) : READINESS_PROVIDERS) as ReadinessProvider[];
  for (const p of wanted) {
    const r = await validateCredentials(p, { userId: admin.id });
    console.log(`${p.padEnd(10)} ${r.ok ? "VALID " : "FAILED"} live=${r.live} ${r.detail ?? ""}`);
  }
  await db.$disconnect();
};
void run();
