import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/context";
import { ContentEditor } from "@/features/content/editor";
import type { StudioItem } from "@/features/content/studio";
import { signedFileUrl } from "@/server/storage";
import { contentAiConfigured } from "@/server/ai";
import { imagesConfigured, imageUsage } from "@/server/studio/images";
import type { QualityCheck } from "@/server/studio/context";
import { listSlides } from "@/server/studio/carousel";
import { readVideoPlan } from "@/server/studio/video";
import { CarouselStudio } from "@/features/content/carousel-studio";
import { VideoPlanPanel } from "@/features/content/video-plan";

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
      assets: { where: { kind: "IMAGE" }, orderBy: { createdAt: "desc" }, take: 24 },
    },
  });
  if (!item) notFound();
  const userIds = [...new Set([...item.approvals.map((a) => a.userId), ...item.versions.map((v) => v.createdById)].filter((x): x is string => Boolean(x)))];
  const users = await ctx.db.organizationMember.findMany({ where: { userId: { in: userIds } }, include: { user: { select: { id: true, name: true, email: true } } } });
  const selected = item.assets.find((a) => a.isSelected && a.status === "COMPLETED") ?? null;
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
    imageUrl: selected?.fileId ? signedFileUrl(selected.fileId) : (selected?.url ?? null),
  };
  const sp = await props.searchParams;
  const [usage, settings] = await Promise.all([imageUsage(ctx.organization.id), ctx.db.workspaceSettings.findFirst()]);
  const studio = {
    text: contentAiConfigured(),
    image: imagesConfigured(),
    usage: { used: usage.used, limit: usage.limit },
    defaults: { mode: settings?.imageMode === "ai_creative" ? ("ai_creative" as const) : ("brand_template" as const), quality: settings?.imageQuality === "quality" ? ("quality" as const) : ("fast" as const) },
  };
  const assets = item.assets.map((a) => ({
    id: a.id,
    status: a.status,
    mode: a.mode,
    quality: a.quality,
    preset: a.preset,
    variant: a.variant,
    instruction: a.instruction,
    isSelected: a.isSelected,
    errorCode: a.errorCode,
    ai: Boolean(a.provider),
    url: a.status === "COMPLETED" && a.fileId ? signedFileUrl(a.fileId) : (a.url ?? null),
    createdAt: a.createdAt.toISOString(),
  }));
  const currentVersion = item.versions.find((v) => v.version === item.currentVersion);
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const isCarousel = item.format === "CAROUSEL";
  const isVideo = ["REEL", "SHORT_VIDEO"].includes(item.format) || (item.platform === "TIKTOK" && item.format !== "CAROUSEL");
  const slides = isCarousel ? await listSlides(scope, item.id) : [];
  const videoPlan = isVideo ? readVideoPlan(item.designBrief) : null;
  const canEdit = ctx.can("content:create") && !["PUBLISHED", "PUBLISHING"].includes(item.status);

  return (
    <div className="space-y-6">
    <ContentEditor
      item={data}
      brandName={ctx.organization.name}
      campaignId={item.campaign?.id ?? null}
      socialPostId={item.socialPosts[0]?.id ?? null}
      permalink={item.socialPosts[0]?.permalink ?? null}
      publishError={item.publications.find((p) => p.status === "FAILED")?.error ?? null}
      versions={item.versions.map((v) => ({ version: v.version, caption: v.caption, hook: v.hook, note: v.changeNote, source: v.source, by: v.createdByAgent ?? nameOf(v.createdById), at: v.createdAt.toISOString() }))}
      history={item.approvals.map((a) => ({ id: a.id, action: a.action, comment: a.comment, by: nameOf(a.userId), at: a.createdAt.toISOString() }))}
      can={{ approve: ctx.can("content:approve"), edit: ctx.can("content:create"), publish: ctx.can("content:publish") }}
      studio={studio}
      assets={assets}
      quality={(currentVersion?.qualityCheck as QualityCheck | null) ?? null}
      autoOpen={sp.ai === "improve" || sp.ai === "edit" ? sp.ai : null}
    />
      {isCarousel && (
        <CarouselStudio
          contentId={item.id}
          slides={slides.map((s) => ({ id: s.id, position: s.position, headline: s.headline, body: s.body, visualDirection: s.visualDirection, version: s.version, previewUrl: s.previewUrl, history: s.history.map((h) => ({ version: h.version, headline: h.headline, body: h.body, source: h.source, at: h.at })) }))}
          aiReady={studio.text}
          canEdit={canEdit}
        />
      )}
      {isVideo && <VideoPlanPanel contentId={item.id} plan={videoPlan} coverUrl={videoPlan?.coverFileId ? signedFileUrl(videoPlan.coverFileId) : null} aiReady={studio.text} canEdit={canEdit} />}
    </div>
  );
}
