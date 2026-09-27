import type { NotificationType, Role } from "@/generated/prisma/enums";
import { db } from "../db/client";
import { getMailer, renderEmail } from "../email/mailer";
import { logger } from "../logger";

export type NotifyInput = {
  organizationId: string;
  workspaceId?: string | null;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
  /** Explicit recipients; otherwise every member with one of `roles` (default: owners, admins, managers). */
  userIds?: string[];
  roles?: Role[];
};

/** Types that email by default when the user hasn't set a preference. */
const EMAIL_BY_DEFAULT = new Set<NotificationType>(["PUBLISHING_FAILED", "INTEGRATION_DISCONNECTED", "HOT_OPPORTUNITY", "USAGE_LIMIT"]);

export interface NotificationChannel {
  readonly name: string;
  deliver(n: { userId: string; email: string; locale: string; title: string; body?: string; link?: string }): Promise<void>;
}

class EmailChannel implements NotificationChannel {
  readonly name = "email";
  async deliver(n: { email: string; locale: string; title: string; body?: string; link?: string }) {
    const url = n.link ? `${process.env.APP_URL ?? ""}${n.link}` : undefined;
    const { html, text } = renderEmail({ heading: n.title, body: n.body ?? "", ctaUrl: url, ctaLabel: n.locale === "ar" ? "فتح" : "Open", locale: n.locale });
    await getMailer().send({ to: n.email, subject: n.title, html, text });
  }
}

// Future channels (push, WhatsApp) implement NotificationChannel and register here.
const channels: Record<string, NotificationChannel> = { email: new EmailChannel() };

export async function notify(input: NotifyInput) {
  const recipients = input.userIds?.length
    ? await db.organizationMember.findMany({ where: { organizationId: input.organizationId, userId: { in: input.userIds } }, include: { user: true } })
    : await db.organizationMember.findMany({
        where: { organizationId: input.organizationId, role: { in: input.roles ?? ["OWNER", "ADMIN", "MANAGER"] } },
        include: { user: true },
      });
  if (recipients.length === 0) return [];

  const prefs = await db.notificationPreference.findMany({
    where: { organizationId: input.organizationId, type: input.type, userId: { in: recipients.map((r) => r.userId) } },
  });
  const prefBy = new Map(prefs.map((p) => [p.userId, p]));

  const created = [];
  for (const r of recipients) {
    const pref = prefBy.get(r.userId);
    if (pref?.inApp !== false) {
      created.push(
        await db.notification.create({
          data: {
            organizationId: input.organizationId,
            workspaceId: input.workspaceId ?? null,
            userId: r.userId,
            type: input.type,
            title: input.title,
            body: input.body,
            link: input.link,
            data: (input.data ?? {}) as object,
          },
        }),
      );
    }
    const wantsEmail = pref ? pref.email : EMAIL_BY_DEFAULT.has(input.type);
    if (wantsEmail) {
      channels.email
        .deliver({ userId: r.userId, email: r.user.email, locale: r.user.locale, title: input.title, body: input.body, link: input.link })
        .catch((err) => logger.error({ err, type: input.type }, "notification email failed"));
    }
  }
  return created;
}
