import { db } from "../db/client";
import { hashToken, randomToken } from "../crypto";

export const SESSION_TTL_DAYS = 30;
const ROLLING_REFRESH_MS = 24 * 60 * 60 * 1000;

/** Framework-agnostic session store. Cookies are handled in ./session (Next.js layer). */
export async function createSessionRecord(userId: string, meta: { ip?: string | null; userAgent?: string | null; organizationId?: string | null }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      activeOrganizationId: meta.organizationId ?? null,
      expiresAt,
    },
  });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string) {
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  // Rolling expiry, at most one write per day per session.
  if (Date.now() - session.lastSeenAt.getTime() > ROLLING_REFRESH_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(), expiresAt } });
    session.expiresAt = expiresAt;
  }
  return session;
}

export async function revokeSessionToken(token: string) {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
