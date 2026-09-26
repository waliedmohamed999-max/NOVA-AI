import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Base Prisma client. Application code should prefer `tenantDb()` from
 * ./tenant — the base client is reserved for auth, platform admin, the job
 * worker and cross-tenant system tasks.
 *
 * Sensitive columns are omitted globally and must be opted into explicitly.
 */
function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
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

export const db: Client = globalForDb.__novaDb ?? createClient();

if (process.env.NODE_ENV !== "production") globalForDb.__novaDb = db;

export type Db = Client;
