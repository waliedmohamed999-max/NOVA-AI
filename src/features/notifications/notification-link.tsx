"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { markNotificationsRead } from "./actions";

/** A notification row link: opening an unread notification marks it read (fire-and-forget, never blocks navigation). */
export function NotificationLink({ id, unread, onClick, ...props }: ComponentProps<typeof Link> & { id: string; unread: boolean }) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        if (unread) void markNotificationsRead({ ids: [id] }).catch(() => undefined);
        onClick?.(e);
      }}
    />
  );
}
