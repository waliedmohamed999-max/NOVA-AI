import { headers } from "next/headers";

/**
 * Request correlation ids. The proxy stamps `x-request-id` on every page/server-action request (reusing a
 * well-formed incoming id from a load balancer); API routes mint their own. Logs and error reports carry it,
 * and responses echo it so a user-visible error can be matched to its log lines.
 */
const VALID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestIdFrom(incoming: string | null | undefined) {
  return incoming && VALID.test(incoming) ? incoming : crypto.randomUUID();
}

/** The current request's id inside server components / actions (null outside a request). */
export async function currentRequestId(): Promise<string | null> {
  try {
    return (await headers()).get("x-request-id");
  } catch {
    return null;
  }
}
