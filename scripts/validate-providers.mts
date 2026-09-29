// Go-live check: runs the SAME read-only credential checks as /admin/providers → Validate for every configured
// provider, plus a read-only connection test for each connected LinkedIn/Meta integration, records the results
// (provider_validations) and prints each provider's honest status. Never publishes, sends, charges or prints
// a secret. Live generation / email / storage / Stripe / WhatsApp send tests stay manual in /admin/providers.
//
//   npx tsx scripts/validate-providers.mts            # all configured providers
//   npx tsx scripts/validate-providers.mts linkedin   # one provider
import "dotenv/config";
import { READINESS_PROVIDERS, isConfigured, providerReadiness, validateCredentials, type ReadinessProvider } from "../src/server/admin/readiness";
import { testConnection } from "../src/server/integrations/diagnostics";
import { db } from "../src/server/db/client";

const only = process.argv[2] as ReadinessProvider | undefined;
const targets = READINESS_PROVIDERS.filter((p) => (!only || p === only) && p !== "storage");
const admin = await db.user.findFirst({ where: { isPlatformAdmin: true }, select: { id: true } });
if (!admin) throw new Error("no platform admin user to attribute validations to");

for (const p of targets) {
  if (!isConfigured(p)) {
    console.log(`- ${p}: not configured (skipped)`);
    continue;
  }
  const row = await validateCredentials(p, { userId: admin.id });
  console.log(`${row.ok ? "✓" : "✗"} ${p} credentials: ${row.detail ?? ""}`.slice(0, 220));
}

// Existing connected accounts (read-only: token introspection, profile, Page/organization listing).
const integrations = await db.integration.findMany({ where: { status: "CONNECTED", provider: { in: ["LINKEDIN", "FACEBOOK"] } }, select: { id: true, provider: true, organizationId: true, workspaceId: true } });
for (const i of integrations) {
  if (only && !(only === "linkedin" ? i.provider === "LINKEDIN" : only === "facebook" && i.provider === "FACEBOOK")) continue;
  try {
    const r = await testConnection({ organizationId: i.organizationId, workspaceId: i.workspaceId }, i.id, admin.id);
    console.log(`${r.valid ? "✓" : "✗"} ${i.provider} connection: ${r.valid ? `scopes: ${r.scopes.join(" ")}; accounts: ${r.accounts.map((a) => a.platform).join(",") || "none"}` : r.error}`);
  } catch (e) {
    console.log(`✗ ${i.provider} connection: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log("\nStatus:");
for (const r of await providerReadiness()) if (!only || r.provider === only) console.log(`  ${r.provider.padEnd(10)} ${r.status}`);
process.exit(0);
