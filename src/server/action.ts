import "server-only";
import { z } from "zod";
import { getSession } from "./auth/session";
import { resolveTenant, type TenantContext } from "./context";
import { ForbiddenError, type Permission } from "./rbac";
import { RateLimitError, enforceRateLimit } from "./rate-limit";
import { TenantScopeError } from "./db/tenant";
import { logger } from "./logger";
import { UserFacingError } from "./errors";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

type Options = {
  permission?: Permission;
  /** Requests per minute per user for this action. */
  rateLimit?: number;
  name: string;
};

/**
 * Wraps a server action with: authentication, tenant resolution, RBAC,
 * input validation, rate limiting and human-friendly error mapping.
 * Server Actions also get Next.js' built-in Origin check (CSRF protection).
 */
export function tenantAction<S extends z.ZodType, R>(
  opts: Options,
  schema: S,
  handler: (input: z.output<S>, ctx: TenantContext) => Promise<R>,
) {
  return async (raw: z.input<S>): Promise<ActionResult<R>> => {
    try {
      const session = await getSession();
      if (!session) return { ok: false, error: "unauthenticated" };
      const ctx = await resolveTenant();
      if (!ctx) return { ok: false, error: "no_organization" };
      if (opts.permission && !ctx.can(opts.permission)) return { ok: false, error: "forbidden" };
      if (opts.rateLimit) await enforceRateLimit(`action:${opts.name}:${ctx.user.id}`, opts.rateLimit, 60);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: "validation", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
      }
      return { ok: true, data: await handler(parsed.data, ctx) };
    } catch (err) {
      return mapError(err, opts.name);
    }
  };
}

export function mapError(err: unknown, name: string): { ok: false; error: string } {
  if (err instanceof UserFacingError) return { ok: false, error: err.code };
  if (err instanceof ForbiddenError) return { ok: false, error: "forbidden" };
  if (err instanceof RateLimitError) return { ok: false, error: "rate_limited" };
  if (err instanceof TenantScopeError) {
    logger.error({ err, action: name }, "tenant scope violation");
    return { ok: false, error: "forbidden" };
  }
  // Re-throw Next.js control flow (redirect / notFound).
  if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
  logger.error({ err, action: name }, "action failed");
  return { ok: false, error: "unexpected" };
}
