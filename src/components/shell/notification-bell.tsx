"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Bell, CheckCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { listNotifications, markNotificationsRead, type NotificationDTO } from "@/features/notifications/actions";
import { NotificationIcon } from "@/features/notifications/icon";

export function NotificationBell({ unread }: { unread: number }) {
  const t = useTranslations("app.notifications");
  const tc = useTranslations("common.nav");
  const format = useFormatter();
  const [items, setItems] = useState<NotificationDTO[] | null>(null);
  const [count, setCount] = useState(unread);
  const [, start] = useTransition();

  function load() {
    start(async () => {
      const res = await listNotifications({ limit: 12 });
      if (res.ok) setItems(res.data);
    });
  }

  function markAll() {
    start(async () => {
      await markNotificationsRead({});
      setCount(0);
      setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
    });
  }

  return (
    <Popover onOpenChange={(o) => o && load()}>
      <PopoverTrigger
        className="relative flex size-10 items-center justify-center rounded-full text-ink-2 transition hover:bg-sunken hover:text-ink"
        aria-label={`${tc("notifications")}${count ? ` (${count})` : ""}`}
      >
        <Bell className="size-[18px]" />
        {count > 0 && <span className="absolute end-2 top-2 size-2 rounded-full bg-accent ring-2 ring-canvas" aria-hidden />}
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{tc("notifications")}</h2>
          {count > 0 && (
            <button onClick={markAll} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-3 hover:text-ink">
              <CheckCheck className="size-3.5" /> {t("markAll")}
            </button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto p-1.5">
          {items === null ? (
            <div className="space-y-3 p-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-3">{t("empty")}</p>
          ) : (
            items.map((n) => (
              <Link
                key={n.id}
                href={n.link ?? "/notifications"}
                className={cn("flex gap-3 rounded-xl px-3 py-2.5 transition hover:bg-sunken", !n.readAt && "bg-accent-soft/40")}
              >
                <NotificationIcon type={n.type} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-snug text-ink">{n.title}</p>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-ink-3">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-ink-4">{format.relativeTime(new Date(n.createdAt))}</p>
                </div>
              </Link>
            ))
          )}
        </div>
        <Link href="/notifications" className="block border-t border-line px-4 py-2.5 text-center text-xs font-medium text-ink-3 hover:text-ink">
          {t("viewAll")}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
