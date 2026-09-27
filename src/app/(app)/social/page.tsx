import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Plug, Share2 } from "lucide-react";
import { requireTenant } from "@/server/context";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { PlatformDot } from "@/components/content/post-preview";

export const metadata: Metadata = { title: "Social" };

export default async function SocialPage() {
  const ctx = await requireTenant({ permission: "workspace:read" });
  const t = await getTranslations("settings.social");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const [accounts, queue, posts] = await Promise.all([
    ctx.db.integrationAccount.findMany({ where: { isActive: true }, include: { integration: { select: { status: true, lastSyncAt: true } } } }),
    ctx.db.socialPublication.findMany({ where: { status: { in: ["PENDING", "PUBLISHING", "FAILED"] } }, orderBy: { scheduledFor: "asc" }, take: 12, include: { contentItem: { select: { id: true, title: true } } } }),
    ctx.db.socialPost.findMany({ orderBy: { publishedAt: "desc" }, take: 15, include: { metric: true } }),
  ]);
  const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} actions={<Link href="/settings/connected-accounts" className={buttonClass("secondary", "md")}><Plug className="size-4" />{tc("nav.integrations")}</Link>} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("accounts")}</h2>
        {accounts.length === 0 ? (
          <div className="rounded-[26px] border border-dashed border-line-strong bg-surface-2">
            <EmptyState compact icon={<Share2 />} title={t("noAccounts")} description={t("noAccountsBody")} action={<Link href="/settings/connected-accounts" className={buttonClass("primary", "md")}>{tc("actions.connect")}</Link>} />
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {accounts.map((a) => (
              <li key={a.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-center gap-2 text-sm font-medium"><PlatformDot platform={a.platform ?? ""} />{a.name}</div>
                <div className="mt-1 text-xs text-ink-3">{a.handle ?? tc(`platforms.${a.platform}` as "platforms.INSTAGRAM")}</div>
                {a.integration.lastSyncAt && <div className="mt-2 text-xs text-ink-4">{t("synced", { time: format.relativeTime(a.integration.lastSyncAt) })}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold">{t("queue")}</h2>
          {queue.length === 0 ? (
            <p className="text-sm text-ink-3">{t("queueEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {queue.map((q) => (
                <li key={q.id}>
                  <Link href={`/content/${q.contentItem.id}`} className="flex items-center gap-3 py-3 text-sm hover:bg-surface-2">
                    <PlatformDot platform={q.platform} />
                    <span className="min-w-0 flex-1 truncate">{q.contentItem.title}</span>
                    <Badge tone={q.status === "FAILED" ? "danger" : "info"}>{t(`pub.${q.status}` as "pub.PENDING")}</Badge>
                    <span className="w-28 text-end text-xs text-ink-3">{format.dateTime(q.scheduledFor, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-ink-4">{t("queueNote")}</p>
        </Card>
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold">{t("recent")}</h2>
          {posts.length === 0 ? (
            <p className="text-sm text-ink-3">{t("recentEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {posts.map((p) => (
                <li key={p.id}>
                  <Link href={`/analytics/posts/${p.id}`} className="flex items-center gap-3 py-3 text-sm hover:bg-surface-2">
                    <PlatformDot platform={p.platform} />
                    <span className="min-w-0 flex-1 truncate">{p.caption?.split("\n")[0] ?? p.externalId}</span>
                    <span className="text-xs tabular text-ink-3">{pct(p.metric?.engagementRate)}</span>
                    <span className="w-20 text-end text-xs text-ink-4">{format.dateTime(p.publishedAt, { month: "short", day: "numeric" })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
