import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Inbox } from "lucide-react";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { channelFor } from "@/server/sales/channels";

export const metadata: Metadata = { title: "Inbox" };

const CHANNELS = ["WEBSITE", "EMAIL", "INSTAGRAM_DM", "FACEBOOK_DM", "WHATSAPP", "MANUAL"] as const;

export default async function InboxPage() {
  const ctx = await requireTenant({ permission: "leads:read" });
  const t = await getTranslations("settings.inbox");
  const format = await getFormatter();
  const conversations = await ctx.db.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: 50,
    include: { lead: { select: { id: true, name: true, company: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-6 flex flex-wrap gap-2">
        {CHANNELS.map((c) => {
          const ok = c === "MANUAL" || c === "WEBSITE" || Boolean(channelFor(c)?.isConfigured());
          return (
            <Badge key={c} tone={ok ? "success" : "outline"}>
              {t(`channels.${c}`)} · {ok ? t("active") : t("notConnected")}
            </Badge>
          );
        })}
      </div>
      {conversations.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-line-strong bg-surface-2">
          <EmptyState icon={<Inbox />} title={t("empty.title")} description={t("empty.body")} />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[24px] border border-line bg-surface">
          {conversations.map((c) => {
            const last = c.messages[0];
            const needsReply = last?.direction === "INBOUND";
            return (
              <li key={c.id}>
                <Link href={c.lead ? `/leads/${c.lead.id}` : "/leads"} className="flex items-center gap-4 px-5 py-4 transition hover:bg-surface-2">
                  <span className={`size-2 shrink-0 rounded-full ${needsReply ? "bg-accent" : "bg-transparent"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.lead?.name ?? t("unknown")}</span>
                      {c.lead?.company && <span className="truncate text-sm text-ink-3">{c.lead.company}</span>}
                    </div>
                    <p className="truncate text-sm text-ink-3" dir="auto">{last?.body ?? "—"}</p>
                  </div>
                  <Badge tone="outline" className="hidden sm:inline-flex">{t(`channels.${c.channel}` as "channels.EMAIL")}</Badge>
                  {needsReply && <Badge tone="accent">{t("needsReply")}</Badge>}
                  <span className="w-20 text-end text-xs text-ink-4">{format.relativeTime(c.lastMessageAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
