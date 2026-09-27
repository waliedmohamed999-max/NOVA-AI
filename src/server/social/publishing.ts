import { db } from "../db/client";
import { audit } from "../audit";
import { notify } from "../notifications/service";
import { logger } from "../logger";
import { signedFileUrl } from "../storage";
import { accountRef, markIntegrationError, tokenForAccount } from "../integrations/service";
import { providerForPlatform } from "../integrations/registry";
import { ProviderError } from "../integrations/types";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

async function mediaUrlsFor(contentItemId: string) {
  const assets = await db.contentAsset.findMany({ where: { contentItemId }, orderBy: { position: "asc" } });
  return assets.map((a) => a.url ?? (a.fileId ? `${appUrl()}${signedFileUrl(a.fileId, 86_400)}` : null)).filter((u): u is string => Boolean(u));
}

export type PublishOutcome = "published" | "failed" | "skipped";

/** Publishes one scheduled publication. Idempotent: claims the row before calling the provider. */
export async function publishOne(publicationId: string): Promise<PublishOutcome> {
  const claimed = await db.socialPublication.updateMany({ where: { id: publicationId, status: "PENDING" }, data: { status: "PUBLISHING", attempts: { increment: 1 } } });
  if (claimed.count !== 1) return "skipped";
  const pub = await db.socialPublication.findUniqueOrThrow({ where: { id: publicationId }, include: { contentItem: true } });
  const scope = { organizationId: pub.organizationId, workspaceId: pub.workspaceId };
  const item = pub.contentItem;
  await db.contentItem.update({ where: { id: item.id }, data: { status: "PUBLISHING" } });

  const fail = async (code: string, detail?: unknown, link = `/content/${item.id}`) => {
    await db.socialPublication.update({ where: { id: pub.id }, data: { status: "FAILED", error: code } });
    await db.contentItem.update({ where: { id: item.id }, data: { status: "FAILED" } });
    const org = await db.organization.findUniqueOrThrow({ where: { id: scope.organizationId } });
    const ar = org.locale === "ar";
    await notify({
      ...scope,
      type: "PUBLISHING_FAILED",
      title: ar ? `تعذّر نشر "${item.title}"` : `"${item.title}" couldn't be published`,
      body: publishErrorMessage(code, ar),
      link,
    });
    await audit({ ...scope, actorType: "SYSTEM", action: "content.publish_failed", entityType: "ContentItem", entityId: item.id, summary: `Publishing "${item.title}" failed (${code})`, metadata: { detail: detail ? String(detail).slice(0, 300) : undefined } });
    return "failed" as const;
  };

  // Approval is mandatory before anything goes out.
  if (!["SCHEDULED", "APPROVED", "PUBLISHING"].includes(item.status) && item.status !== "FAILED") return fail("requires_approval");

  const account =
    (pub.integrationAccountId && (await db.integrationAccount.findFirst({ where: { id: pub.integrationAccountId, isActive: true }, include: { integration: true } }))) ||
    (await db.integrationAccount.findFirst({ where: { ...scope, platform: pub.platform, isActive: true, integration: { status: "CONNECTED" } }, include: { integration: true } }));
  const provider = providerForPlatform(pub.platform);
  if (!account || !provider || account.integration.status !== "CONNECTED") return fail("cannot_publish");

  // Don't call the platform when the connection lacks the permission — ask the customer to grant it instead.
  const needed = PUBLISH_CAPABILITY[account.accountType === "linkedin_organization" ? "LINKEDIN_ORG" : pub.platform];
  const caps = (account.metadata as { capabilities?: { key: string; available: boolean }[] } | null)?.capabilities;
  if (needed && Array.isArray(caps) && caps.some((c) => c.key === needed && !c.available)) {
    return fail("permission_required", needed, `/settings/connected-accounts?upgrade=${pub.platform}:${needed}`);
  }

  const token = await tokenForAccount(account.integrationId, account.id);
  if (!token) return fail("integration_expired");

  try {
    const result = await provider.publishPost(accountRef(account), token, {
      format: item.format,
      caption: [item.caption, item.hashtags.join(" ")].filter(Boolean).join("\n\n"),
      mediaUrls: await mediaUrlsFor(item.id),
      link: null,
    });
    const now = new Date();
    const post = await db.socialPost.upsert({
      where: { workspaceId_platform_externalId: { workspaceId: scope.workspaceId, platform: pub.platform, externalId: result.externalId } },
      create: { ...scope, integrationAccountId: account.id, contentItemId: item.id, platform: pub.platform, externalId: result.externalId, permalink: result.permalink ?? null, format: item.format, caption: item.caption, pillar: item.pillar, publishedAt: now },
      update: { permalink: result.permalink ?? null },
    });
    await db.socialPublication.update({ where: { id: pub.id }, data: { status: "PUBLISHED", publishedAt: now, socialPostId: post.id, error: null, integrationAccountId: account.id } });
    await db.contentItem.update({ where: { id: item.id }, data: { status: "PUBLISHED", publishedAt: now } });
    await notify({ ...scope, type: "POST_PUBLISHED", title: `Published: ${item.title}`, link: `/content/${item.id}`, roles: ["OWNER", "ADMIN", "MANAGER"] });
    await audit({ ...scope, actorType: "SYSTEM", actorLabel: "Publisher", action: "content.published", entityType: "ContentItem", entityId: item.id, summary: `System published "${item.title}" to ${pub.platform}` });
    return "published";
  } catch (err) {
    logger.warn({ err: err instanceof ProviderError ? { kind: err.kind, status: err.status } : String(err), publicationId }, "publish failed");
    if (err instanceof ProviderError && (err.kind === "rate_limited" || err.kind === "unavailable") && pub.attempts < 3) {
      // Transient: put it back for the next scheduler tick.
      await db.socialPublication.update({ where: { id: pub.id }, data: { status: "PENDING", scheduledFor: new Date(Date.now() + 5 * 60_000 * pub.attempts), error: err.kind } });
      await db.contentItem.update({ where: { id: item.id }, data: { status: "SCHEDULED" } });
      return "skipped";
    }
    if (err instanceof ProviderError && (err.kind === "expired" || err.kind === "permission")) await markIntegrationError(scope, account.integrationId, err);
    const code = err instanceof ProviderError ? (err.kind === "expired" ? "integration_expired" : err.kind === "invalid_media" ? "invalid_media" : "integration_error") : "integration_error";
    return fail(code, err instanceof ProviderError ? err.detail : err);
  }
}

/** The capability each platform needs to publish (see provider capabilities()). */
const PUBLISH_CAPABILITY: Record<string, string> = { FACEBOOK: "publish", INSTAGRAM: "instagram_publishing", LINKEDIN: "member_publishing", LINKEDIN_ORG: "organization_publishing" };

export function publishErrorMessage(code: string, ar: boolean) {
  const en: Record<string, string> = {
    permission_required: "NOVA needs an additional permission to do this. Open Connected accounts to grant it.",
    cannot_publish: "There's no connected account for this channel. Connect one and we'll retry.",
    integration_expired: "The connection expired. Reconnect it to continue publishing.",
    integration_error: "The platform didn't accept the post right now. You can retry from the post page.",
    invalid_media: "The platform couldn't use the attached media. Check the image or video and try again.",
    requires_approval: "This post needs approval before it can go out.",
  };
  const arm: Record<string, string> = {
    permission_required: "NOVA تحتاج صلاحية إضافية لتنفيذ هذه المهمة. افتح الحسابات المرتبطة لمنح الصلاحية.",
    cannot_publish: "لا يوجد حساب مربوط لهذه القناة. اربط حسابًا وسنعيد المحاولة.",
    integration_expired: "انتهت صلاحية الربط. أعد الربط لمتابعة النشر.",
    integration_error: "لم تقبل المنصة المنشور الآن. يمكنك إعادة المحاولة من صفحة المنشور.",
    invalid_media: "تعذّر على المنصة استخدام الوسائط المرفقة. تحقق من الصورة أو الفيديو.",
    requires_approval: "يحتاج هذا المنشور إلى موافقة قبل نشره.",
  };
  return (ar ? arm : en)[code] ?? (ar ? arm.integration_error : en.integration_error);
}

/** Scheduler job: publish everything that is due. */
export async function publishDue(limit = 25) {
  const due = await db.socialPublication.findMany({ where: { status: "PENDING", scheduledFor: { lte: new Date() } }, orderBy: { scheduledFor: "asc" }, take: limit, select: { id: true } });
  const results: Record<PublishOutcome, number> = { published: 0, failed: 0, skipped: 0 };
  for (const p of due) results[await publishOne(p.id)]++;
  return results;
}

/** Manual retry of a failed post. */
export async function retryPublication(scope: { organizationId: string; workspaceId: string }, contentItemId: string) {
  const item = await db.contentItem.findFirst({ where: { id: contentItemId, ...scope } });
  if (!item || item.status !== "FAILED") return null;
  await db.contentItem.update({ where: { id: item.id }, data: { status: "SCHEDULED" } });
  const pub = await db.socialPublication.create({
    data: { ...scope, contentItemId: item.id, platform: item.platform, scheduledFor: new Date(), status: "PENDING" },
  });
  return publishOne(pub.id);
}

