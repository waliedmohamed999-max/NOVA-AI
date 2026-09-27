"use server";

import { z } from "zod";
import { tenantAction } from "@/server/action";

export type NotificationDTO = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export const listNotifications = tenantAction({ name: "notifications.list" }, z.object({ limit: z.number().int().min(1).max(50).default(20) }), async ({ limit }, ctx) => {
  const rows = await ctx.db.notification.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map<NotificationDTO>((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  }));
});

export const markNotificationsRead = tenantAction({ name: "notifications.read" }, z.object({ ids: z.array(z.string()).max(100).optional() }), async ({ ids }, ctx) => {
  const res = await ctx.db.notification.updateMany({
    where: { userId: ctx.user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return res.count;
});
