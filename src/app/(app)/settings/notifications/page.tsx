import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { db } from "@/server/db/client";
import { NotificationPrefs } from "@/features/settings/sections";

export const metadata: Metadata = { title: "Notification settings" };

const TYPES = ["APPROVAL_NEEDED", "POST_PUBLISHED", "PUBLISHING_FAILED", "LEAD_QUALIFIED", "HOT_OPPORTUNITY", "FOLLOW_UP_DUE", "MEETING_BOOKED", "INTEGRATION_DISCONNECTED", "AI_RECOMMENDATION", "REPORT_READY", "USAGE_LIMIT"] as const;
const EMAIL_DEFAULT = new Set(["PUBLISHING_FAILED", "INTEGRATION_DISCONNECTED", "HOT_OPPORTUNITY", "USAGE_LIMIT"]);

export default async function NotificationSettingsPage() {
  const ctx = await requireTenant();
  const prefs = await db.notificationPreference.findMany({ where: { organizationId: ctx.organization.id, userId: ctx.user.id } });
  return (
    <NotificationPrefs
      prefs={TYPES.map((type) => {
        const p = prefs.find((x) => x.type === type);
        return { type, inApp: p?.inApp ?? true, email: p?.email ?? EMAIL_DEFAULT.has(type) };
      })}
    />
  );
}
