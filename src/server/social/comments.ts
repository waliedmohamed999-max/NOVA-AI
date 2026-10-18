import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { audit } from "../audit";
import { logger } from "../logger";
import { accountRef, tokenForAccount } from "../integrations/service";
import { providerFor } from "../integrations/registry";
import { ProviderError, type Capability, type RemoteComment } from "../integrations/types";

/**
 * Comments on the workspace's published posts, read live from the platform (Instagram, Facebook Pages) —
 * nothing is copied into NOVA. Only accounts whose connection actually grants comment access are read;
 * the others are listed with the reason so the owner knows what to enable.
 */

type Actor = { userId: string; label: string };
const COMMENT_PLATFORMS = ["INSTAGRAM", "FACEBOOK"] as const;
const POSTS_PER_ACCOUNT = 8;

export type CommentAccountStatus = "ok" | "permission" | "expired" | "error";

function commentsCapability(metadata: unknown): Capability | null {
  const caps = (metadata as { capabilities?: Capability[] } | null)?.capabilities;
  return Array.isArray(caps) ? (caps.find((c) => c.key === "comments") ?? null) : null;
}

async function loadAccount(scope: TenantScope, accountId: string) {
  const account = await db.integrationAccount.findFirst({ where: { id: accountId, ...scope, isActive: true }, include: { integration: true } });
  if (!account) throw new NotFoundError("item");
  const provider = providerFor(account.integration.provider);
  if (!provider?.listComments || !provider.replyToComment || !commentsCapability(account.metadata)?.available) throw new UserFacingError("permission_required");
  const token = await tokenForAccount(account.integrationId, account.id);
  if (!token) throw new UserFacingError("integration_expired");
  return { account, provider, token };
}

export async function recentComments(scope: TenantScope) {
  const accounts = await db.integrationAccount.findMany({
    where: { ...scope, isActive: true, platform: { in: [...COMMENT_PLATFORMS] }, integration: { status: "CONNECTED" } },
    include: { integration: true },
    orderBy: { createdAt: "asc" },
  });
  const statuses: { id: string; name: string; platform: string; status: CommentAccountStatus }[] = [];
  const threads: { accountId: string; platform: string; post: { id: string; caption: string | null; permalink: string | null; publishedAt: Date }; comment: RemoteComment }[] = [];

  for (const account of accounts) {
    const provider = providerFor(account.integration.provider);
    const cap = commentsCapability(account.metadata);
    const base = { id: account.id, name: account.name, platform: account.platform ?? account.integration.provider };
    if (!provider?.listComments || !cap?.available) {
      statuses.push({ ...base, status: "permission" });
      continue;
    }
    const token = await tokenForAccount(account.integrationId, account.id);
    if (!token) {
      statuses.push({ ...base, status: "expired" });
      continue;
    }
    const posts = await db.socialPost.findMany({ where: { ...scope, integrationAccountId: account.id }, orderBy: { publishedAt: "desc" }, take: POSTS_PER_ACCOUNT, select: { id: true, externalId: true, caption: true, permalink: true, publishedAt: true } });
    let status: CommentAccountStatus = "ok";
    for (const post of posts) {
      try {
        const comments = await provider.listComments(accountRef(account), token, post.externalId, { limit: 25 });
        for (const comment of comments) threads.push({ accountId: account.id, platform: base.platform, post: { id: post.id, caption: post.caption, permalink: post.permalink, publishedAt: post.publishedAt }, comment });
      } catch (err) {
        logger.warn({ err: err instanceof ProviderError ? { kind: err.kind, status: err.status } : String(err), accountId: account.id }, "comments not loaded");
        status = err instanceof ProviderError && err.kind === "expired" ? "expired" : err instanceof ProviderError && err.kind === "permission" ? "permission" : "error";
        break;
      }
    }
    statuses.push({ ...base, status });
  }

  threads.sort((a, b) => latest(b.comment) - latest(a.comment));
  return { accounts: statuses, threads };
}

/** A comment "needs a reply" when nobody from the account has answered it yet. */
const latest = (c: RemoteComment) => Math.max(c.at.getTime(), ...c.replies.map((r) => r.at.getTime()));

export async function replyToComment(scope: TenantScope, accountId: string, commentId: string, message: string, actor: Actor) {
  const text = message.trim().slice(0, 2000);
  if (!text) throw new UserFacingError("validation");
  const { account, provider, token } = await loadAccount(scope, accountId);
  try {
    const r = await provider.replyToComment!(accountRef(account), token, commentId, text);
    await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "social.comment_replied", entityType: "IntegrationAccount", entityId: account.id, summary: `${actor.label} replied to a ${account.platform ?? "social"} comment`, metadata: { commentId, replyId: r.id } });
    return r;
  } catch (err) {
    if (err instanceof ProviderError) throw new UserFacingError(err.kind === "expired" ? "integration_expired" : err.kind === "permission" ? "permission_required" : "integration_error", { cause: err });
    throw err;
  }
}
