import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, ExternalLink, MessageSquare, Plug } from "lucide-react";
import { cn } from "@/lib/cn";
import { requireTenant } from "@/server/context";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { PlatformDot } from "@/components/content/post-preview";
import { recentComments } from "@/server/social/comments";
import { CommentReply } from "@/features/social/comment-reply";

export const metadata: Metadata = { title: "Social · Comments" };

/**
 * Comments on recent posts, read live from Instagram / Facebook, newest activity first, with public replies
 * posted as the account. Accounts without comment access are listed with what to enable.
 */
export default async function SocialCommentsPage() {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("settings.social.comments");
  const format = await getFormatter();
  const { accounts, threads } = await recentComments({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
  const canReply = ctx.can("content:publish");
  const readable = accounts.filter((a) => a.status === "ok");

  return (
    <div className="space-y-6">
      <Link href="/social" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4 flip-rtl" /> {t("back")}
      </Link>
      <PageHeader title={t("title")} description={t("description")} />

      {accounts.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t("accounts")}>
          {accounts.map((a) => (
            <li key={a.id} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1 pe-3 ps-2 text-[13px]">
              <PlatformDot platform={a.platform} />
              <span className="font-medium text-ink">{a.name}</span>
              <Badge tone={a.status === "ok" ? "success" : a.status === "error" ? "danger" : "warning"}>{t(`status.${a.status}`)}</Badge>
            </li>
          ))}
        </ul>
      )}

      {accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2">
          <EmptyState icon={<Plug />} title={t("noAccounts")} description={t("noAccountsBody")} action={<Link href="/settings/connected-accounts" className={buttonClass("primary", "md")}>{t("connect")}</Link>} />
        </div>
      ) : readable.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2">
          <EmptyState icon={<MessageSquare />} title={t("noAccess")} description={t("noAccessBody")} action={<Link href="/settings/connected-accounts" className={buttonClass("secondary", "md")}>{t("connect")}</Link>} />
        </div>
      ) : threads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2">
          <EmptyState icon={<MessageSquare />} title={t("empty")} description={t("emptyBody")} />
        </div>
      ) : (
        <ul className="space-y-3">
          {threads.map(({ accountId, platform, post, comment }) => {
            const answered = comment.replies.length > 0;
            return (
              <li key={`${accountId}:${comment.id}`}>
                <Card className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-4">
                    <PlatformDot platform={platform} />
                    <span className="min-w-0 max-w-[60%] truncate" dir="auto">
                      {post.caption?.split("\n")[0] || t("post")}
                    </span>
                    {post.permalink && (
                      <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-ink" aria-label={t("openPost")}>
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                    <span className="ms-auto">{!answered && <Badge tone="accent">{t("unanswered")}</Badge>}</span>
                  </div>
                  <div className="mt-3">
                    <p className="text-sm">
                      <span className="font-semibold text-ink">{comment.author ?? t("someone")}</span>{" "}
                      <span className="text-xs text-ink-4">{format.relativeTime(comment.at)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-2" dir="auto">
                      {comment.text}
                    </p>
                  </div>
                  {comment.replies.length > 0 && (
                    <ul className="mt-3 space-y-2 border-s-2 border-line ps-3">
                      {comment.replies.map((r) => (
                        <li key={r.id} className="text-sm">
                          <span className="font-semibold text-ink">{r.author ?? t("someone")}</span> <span className="text-xs text-ink-4">{format.relativeTime(r.at)}</span>
                          <p className={cn("mt-0.5 whitespace-pre-wrap break-words text-ink-2")} dir="auto">
                            {r.text}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {canReply && (
                    <div className="mt-2">
                      <CommentReply accountId={accountId} commentId={comment.id} />
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
