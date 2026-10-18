import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Bell } from "lucide-react";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { NotificationIcon } from "@/features/notifications/icon";
import { MarkAllRead } from "@/features/notifications/mark-all";
import { NotificationLink } from "@/features/notifications/notification-link";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage(props: PageProps<"/notifications">) {
  const ctx = await requireTenant();
  const t = await getTranslations("app.notifications");
  const format = await getFormatter();
  const unreadOnly = (await props.searchParams).filter === "unread";
  const [items, unread] = await Promise.all([
    ctx.db.notification.findMany({ where: { userId: ctx.user.id, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 100 }),
    ctx.db.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
  ]);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={unread ? <MarkAllRead /> : undefined} />
      <nav className="mb-4 flex gap-1.5" aria-label={t("filterLabel")}>
        {(["all", "unread"] as const).map((f) => {
          const active = (unreadOnly ? "unread" : "all") === f;
          return (
            <Link
              key={f}
              href={f === "all" ? "/notifications" : "/notifications?filter=unread"}
              aria-current={active ? "page" : undefined}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors", active ? "border-ink bg-ink text-ink-inverse" : "border-line bg-surface text-ink-2 hover:border-line-strong")}
            >
              {t(`filters.${f}`)}
              {f === "unread" && unread > 0 && <span className={cn("tabular rounded-full px-1.5 text-[11px]", active ? "bg-white/20" : "bg-accent text-white")}>{unread}</span>}
            </Link>
          );
        })}
      </nav>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2">
          <EmptyState icon={<Bell />} title={t("empty")} />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {items.map((n) => (
            <li key={n.id}>
              <NotificationLink id={n.id} unread={!n.readAt} href={n.link ?? "/home"} className={cn("flex gap-4 px-5 py-4 transition hover:bg-surface-2", !n.readAt && "bg-accent-soft/30")}>
                <NotificationIcon type={n.type} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium" dir="auto">{n.title}</p>
                  {n.body && <p className="text-sm text-ink-3" dir="auto">{n.body}</p>}
                </div>
                <span className="shrink-0 text-xs text-ink-4">{format.relativeTime(n.createdAt)}</span>
                {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label={t("unread")} />}
              </NotificationLink>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
