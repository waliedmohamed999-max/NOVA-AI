import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Base Prisma client. Application code should prefer `tenantDb()` from
 * ./tenant — the base client is reserved for auth, platform admin, the job
 * worker and cross-tenant system tasks.
 *
 * Sensitive columns are omitted globally and must be opted into explicitly.
 */
/**
 * Connections per process. Hosted poolers cap clients (Supabase session mode: pool_size 15 for the whole
 * project), and a single-server host may run several Node processes plus the inline worker, so deployed
 * environments default to a small pool. Override with DATABASE_POOL_MAX.
 */
function poolMax() {
  const n = Number(process.env.DATABASE_POOL_MAX);
  if (Number.isInteger(n) && n > 0) return n;
  return process.env.NODE_ENV === "production" ? 4 : 10;
}

function createClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: poolMax(),
    // Hand idle connections back to the pooler quickly; wait (don't fail) when the pool is momentarily full.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
  return new PrismaClient({
    adapter,
    omit: {
      user: { passwordHash: true },
      integrationCredential: { accessTokenEnc: true, refreshTokenEnc: true },
      oAuthState: { codeVerifierEnc: true },
    },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

type Client = ReturnType<typeof createClient>;

const globalForDb = globalThis as unknown as { __novaDb?: Client };

// Cached in every environment: dev HMR and separately bundled server entry points (routes, instrumentation's
// inline worker) must share one pool per process instead of each opening their own.
export const db: Client = (globalForDb.__novaDb ??= createClient());

export type Db = Client;
