import type { Metadata } from "next";
import { getFormatter } from "next-intl/server";
import { requireTenant } from "@/server/context";
import { db } from "@/server/db/client";
import { SecuritySettings } from "@/features/settings/sections";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const ctx = await requireTenant();
  const format = await getFormatter();
  const sessions = await db.session.findMany({ where: { userId: ctx.user.id, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
  return (
    <SecuritySettings
      sessions={sessions.map((s) => ({ id: s.id, current: s.id === ctx.sessionId, userAgent: s.userAgent?.slice(0, 120) ?? null, ip: s.ip, lastSeen: format.relativeTime(s.lastSeenAt) }))}
    />
  );
}
