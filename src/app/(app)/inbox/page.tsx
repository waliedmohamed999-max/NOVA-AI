import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, Bot, Inbox, MessageCircle, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { requireTenant } from "@/server/context";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { getThread, inboxCounts, listInbox, type InboxFilter } from "@/server/inbox/service";
import { NotFoundError } from "@/server/errors";
import { INBOX_CHANNEL_KEYS, type InboxChannelKey } from "@/features/inbox/channels";
import { Composer, InboxToolbar, ScrollToEnd, StatusButton } from "@/features/inbox/client";

export const metadata: Metadata = { title: "Inbox" };

const FILTERS: InboxFilter[] = ["all", "needs_reply", "unread", "closed"];

/**
 * Unified inbox: every conversation on every channel, with search, channel and status filters, and replies
 * that go out through the conversation's own channel. State lives in the URL (?f, ?ch, ?q, ?c, ?cursor):
 * two panes on desktop, list → thread on phones.
 */
export default async function InboxPage(props: PageProps<"/inbox">) {
  const ctx = await requireTenant({ permission: "leads:read" });
  const t = await getTranslations("settings.inbox");
  const format = await getFormatter();
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filter = (FILTERS as string[]).includes(str("f")) ? (str("f") as InboxFilter) : "all";
  const channel = (INBOX_CHANNEL_KEYS as readonly string[]).includes(str("ch")) ? (str("ch") as InboxChannelKey) : null;
  const q = str("q").slice(0, 80);
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };

  const [list, counts] = await Promise.all([listInbox(scope, { filter, channel, q, cursor: str("cursor") || null }), inboxCounts(scope)]);
  let thread: Awaited<ReturnType<typeof getThread>> | null = null;
  if (str("c")) {
    try {
      thread = await getThread(scope, str("c"), { markRead: ctx.can("leads:manage") });
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
  }

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = { f: filter === "all" ? null : filter, ch: channel, q: q || null, c: str("c") || null };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/inbox?${s}` : "/inbox";
  };
  const counter: Partial<Record<InboxFilter, number>> = { all: counts.open, needs_reply: counts.needsReply, unread: counts.unread };

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-4 lg:h-[calc(100dvh-210px)] lg:min-h-[520px] lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* ── list ── */}
        <section className={cn("flex min-h-0 flex-col gap-3", thread && "hidden lg:flex")} aria-label={t("title")}>
          <InboxToolbar q={q} channel={channel ?? ""} />
          <nav className="flex gap-1.5 overflow-x-auto scrollbar-none" aria-label={t("filters.label")}>
            {FILTERS.map((f) => (
              <Link
                key={f}
                href={href({ f: f === "all" ? null : f, c: null })}
                aria-current={filter === f ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
                  filter === f ? "border-ink bg-ink text-ink-inverse" : "border-line bg-surface text-ink-2 hover:border-line-strong",
                )}
              >
                {t(`filters.${f}`)}
                {counter[f] ? <span className={cn("tabular rounded-full px-1.5 text-[11px]", filter === f ? "bg-white/20" : "bg-surface-2 text-ink-3")}>{counter[f]}</span> : null}
              </Link>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-line bg-surface">
            {list.items.length === 0 ? (
              <EmptyState icon={<Inbox />} title={q || channel || filter !== "all" ? t("noMatches") : t("empty.title")} description={q || channel || filter !== "all" ? t("noMatchesBody") : t("empty.body")} />
            ) : (
              <ul className="h-full divide-y divide-line overflow-y-auto">
                {list.items.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={href({ c: c.id })}
                      scroll={false}
                      aria-current={thread?.conversation.id === c.id ? "true" : undefined}
                      className={cn("flex gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2", thread?.conversation.id === c.id && "bg-accent-soft/60 hover:bg-accent-soft/60")}
                    >
                      <span className={cn("mt-2 size-2 shrink-0 rounded-full", c.needsReply ? "bg-accent" : "bg-transparent")} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn("truncate text-sm", c.unread ? "font-semibold text-ink" : "font-medium text-ink")}>{c.name ?? t("unknown")}</span>
                          {c.company && <span className="hidden truncate text-xs text-ink-4 sm:inline">{c.company}</span>}
                          <span className="ms-auto shrink-0 text-[11px] text-ink-4">{format.relativeTime(c.at)}</span>
                        </span>
                        <span className="mt-0.5 flex min-w-0 gap-1 text-[13px] text-ink-3">
                          {c.last && !c.last.inbound && <span className="shrink-0 font-medium text-ink-2">{t("you")}:</span>}
                          <span className="min-w-0 truncate" dir="auto">
                            {c.last?.body ?? "—"}
                          </span>
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone="outline">{t(`channels.${c.channel}` as "channels.EMAIL")}</Badge>
                          {c.needsReply && <Badge tone="accent">{t("needsReply")}</Badge>}
                          {c.unread > 0 && <Badge tone="info">{t("unreadCount", { count: c.unread })}</Badge>}
                          {c.status === "CLOSED" && <Badge tone="neutral">{t("closedBadge")}</Badge>}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
                {list.nextCursor && (
                  <li className="p-3 text-center">
                    <Link href={href({ cursor: list.nextCursor, c: null })} className={buttonClass("secondary", "sm")}>
                      {t("loadMore")}
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </div>
        </section>

        {/* ── thread ── */}
        <section className={cn("min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface", thread ? "flex" : "hidden lg:flex")} aria-label={t("thread")}>
          {!thread ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState icon={<MessageCircle />} title={t("pick.title")} description={t("pick.body")} />
            </div>
          ) : (
            <>
              <header className="flex items-center gap-2 border-b border-line px-3 py-3 sm:gap-3 sm:px-4">
                <Link href={href({ c: null })} className="rounded-[8px] p-1.5 text-ink-3 hover:bg-surface-2 lg:hidden" aria-label={t("back")}>
                  <ArrowLeft className="size-5 flip-rtl" />
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{thread.conversation.lead?.name ?? t("unknown")}</p>
                  <p className="truncate text-xs text-ink-3">
                    {[t(`channels.${thread.conversation.channel}` as "channels.EMAIL"), thread.conversation.lead?.company, thread.conversation.subject].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {thread.conversation.lead && (
                  <Link href={`/leads/${thread.conversation.lead.id}`} className={buttonClass("ghost", "sm", "shrink-0")} aria-label={t("openLead")}>
                    <UserRound className="size-4" /> <span className="hidden sm:inline">{t("openLead")}</span>
                  </Link>
                )}
                {thread.conversation.channel === "WHATSAPP" && (
                  <Link href={`/whatsapp/inbox?c=${thread.conversation.id}`} className={buttonClass("ghost", "sm", "hidden sm:inline-flex")}>
                    {t("whatsappTools")}
                  </Link>
                )}
                {ctx.can("leads:manage") && <StatusButton conversationId={thread.conversation.id} closed={thread.conversation.status === "CLOSED"} />}
              </header>
              <div className="min-h-[300px] flex-1 space-y-3 overflow-y-auto bg-surface-2/50 px-4 py-4">
                {thread.messages.length === 0 && <p className="py-10 text-center text-sm text-ink-4">{t("noMessages")}</p>}
                {thread.messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.inbound ? "justify-start" : "justify-end")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-xs",
                        m.inbound ? "rounded-ss-md border border-line bg-surface text-ink" : "rounded-se-md bg-ink text-ink-inverse",
                        (m.status === "DRAFT" || m.status === "PENDING_APPROVAL") && "border border-dashed border-line-strong bg-surface text-ink-2",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words" dir="auto">
                        {m.body}
                      </p>
                      <p className={cn("mt-1 flex items-center gap-1.5 text-[11px]", m.inbound || m.status === "DRAFT" || m.status === "PENDING_APPROVAL" ? "text-ink-4" : "text-white/60")}>
                        {m.aiDrafted && <Bot className="size-3" aria-label={t("aiDrafted")} />}
                        {format.dateTime(m.at, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {m.status === "PENDING_APPROVAL" && <span>· {t("msg.pendingApproval")}</span>}
                        {m.status === "DRAFT" && <span>· {t("msg.draft")}</span>}
                        {m.status === "FAILED" && <span className="text-danger">· {t("msg.failed")}</span>}
                      </p>
                    </div>
                  </div>
                ))}
                <ScrollToEnd dep={`${thread.conversation.id}:${thread.messages.length}`} />
              </div>
              <footer className="border-t border-line p-3">
                <Composer conversationId={thread.conversation.id} blocked={thread.reply.blocked} via={thread.reply.via} canManage={ctx.can("leads:manage")} />
              </footer>
            </>
          )}
        </section>
      </div>
    </>
  );
}
