import "server-only";
import { clientIp } from "../net/client-ip";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { brand } from "@/config/brand";
import { createSessionRecord, revokeSessionToken, validateSessionToken } from "./sessions";

const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  expires,
});

export async function requestMeta() {
  const h = await headers();
  return {
    ip: clientIp(h),
    userAgent: h.get("user-agent"),
  };
}

export async function startSession(userId: string, organizationId?: string | null) {
  const meta = await requestMeta();
  const { token, expiresAt } = await createSessionRecord(userId, { ...meta, organizationId });
  (await cookies()).set(brand.sessionCookie, token, cookieOptions(expiresAt));
}

/** Per-request memoized session lookup. */
export const getSession = cache(async () => {
  const token = (await cookies()).get(brand.sessionCookie)?.value;
  if (!token) return null;
  return validateSessionToken(token);
});

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(brand.sessionCookie)?.value;
  if (token) await revokeSessionToken(token);
  jar.delete(brand.sessionCookie);
}
