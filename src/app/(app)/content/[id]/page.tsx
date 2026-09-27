import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/context";
import { ContentEditor } from "@/features/content/editor";
import type { StudioItem } from "@/features/content/studio";

export const metadata: Metadata = { title: "Post" };

export default async function ContentItemPage(props: PageProps<"/content/[id]">) {
  const { id } = await props.params;
  const ctx = await requireTenant({ permission: "workspace:read" });
  const item = await ctx.db.contentItem.findUnique({
    where: { id },
    include: {
      campaign: { select: { id: true, name: true } },
      versions: { orderBy: { version: "desc" }, take: 20 },
      approvals: { orderBy: { createdAt: "desc" }, take: 30 },
      socialPosts: { select: { id: true, permalink: true } },
      publications: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!item) notFound();
  const userIds = [...new Set([...item.approvals.map((a) => a.userId), ...item.versions.map((v) => v.createdById)].filter((x): x is string => Boolean(x)))];
  const users = await ctx.db.organizationMember.findMany({ where: { userId: { in: userIds } }, include: { user: { select: { id: true, name: true, email: true } } } });
  const nameOf = (uid: string | null) => users.find((u) => u.userId === uid)?.user.name ?? users.find((u) => u.userId === uid)?.user.email ?? null;

  const data: StudioItem = {
    id: item.id,
    title: item.title,
    platform: item.platform,
    format: item.format,
    status: item.status,
    hook: item.hook,
    caption: item.caption,
    cta: item.cta,
    hashtags: item.hashtags,
    pillar: item.pillar,
    designBrief: item.designBrief as StudioItem["designBrief"],
    scheduledAt: item.scheduledAt?.toISOString() ?? null,
    publishedAt: item.publishedAt?.toISOString() ?? null,
    campaign: item.campaign?.name ?? null,
    authorAgent: item.authorAgent,
    rationale: item.aiRationale,
  };

  return (
    <ContentEditor
      item={data}
      brandName={ctx.organization.name}
      campaignId={item.campaign?.id ?? null}
      socialPostId={item.socialPosts[0]?.id ?? null}
      permalink={item.socialPosts[0]?.permalink ?? null}
      publishError={item.publications.find((p) => p.status === "FAILED")?.error ?? null}
      versions={item.versions.map((v) => ({ version: v.version, caption: v.caption, hook: v.hook, note: v.changeNote, by: v.createdByAgent ?? nameOf(v.createdById), at: v.createdAt.toISOString() }))}
      history={item.approvals.map((a) => ({ id: a.id, action: a.action, comment: a.comment, by: nameOf(a.userId), at: a.createdAt.toISOString() }))}
      can={{ approve: ctx.can("content:approve"), edit: ctx.can("content:create"), publish: ctx.can("content:publish") }}
    />
  );
}
