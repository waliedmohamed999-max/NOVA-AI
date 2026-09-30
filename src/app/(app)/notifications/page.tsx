import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Bell } from "lucide-react";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { NotificationIcon } from "@/features/notifications/icon";
import { MarkAllRead } from "@/features/notifications/mark-all";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const ctx = await requireTenant();
  const t = await getTranslations("app.notifications");
  const format = await getFormatter();
  const items = await ctx.db.notification.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={items.some((i) => !i.readAt) ? <MarkAllRead /> : undefined} />
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2">
          <EmptyState icon={<Bell />} title={t("empty")} />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {items.map((n) => (
            <li key={n.id}>
              <Link href={n.link ?? "/home"} className={cn("flex gap-4 px-5 py-4 transition hover:bg-surface-2", !n.readAt && "bg-accent-soft/30")}>
                <NotificationIcon type={n.type} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{n.title}</p>
                  {n.body && <p className="text-sm text-ink-3">{n.body}</p>}
                </div>
                <span className="text-xs text-ink-4">{format.relativeTime(n.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
