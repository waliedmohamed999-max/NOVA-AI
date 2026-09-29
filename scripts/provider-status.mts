// Prints each provider's readiness status (same logic as /admin/providers) from the current environment and
// the recorded validations in DATABASE_URL. Names and statuses only; never prints a secret.
//   npx tsx scripts/provider-status.mts
import "dotenv/config";
import { providerReadiness } from "../src/server/admin/readiness";

const rows = await providerReadiness();
for (const r of rows) {
  console.log(`${r.provider.padEnd(10)} ${r.status.padEnd(26)} live: ${r.liveTestedChecks.join(",") || "-"} | blockers: ${r.blockers.join(",") || "-"}`);
}
process.exit(0);
