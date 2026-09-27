"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { approveContent, commentOnContent, editContent, rejectContent, scheduleContent } from "@/server/content/service";
import { retryPublication } from "@/server/social/publishing";
import { startRun } from "@/server/agents/runtime";
import { CONTENT_PLAN_STEPS } from "@/server/agents/workflows/content";
import { aiAvailability } from "@/server/ai";
import { UserFacingError } from "@/server/errors";

const scopeOf = (ctx: { organization: { id: string }; workspace: { id: string } }) => ({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
const actor = (ctx: { user: { id: string; name: string | null; email: string } }) => ({ userId: ctx.user.id, label: ctx.user.name ?? ctx.user.email });

function refresh() {
  revalidatePath("/content");
  revalidatePath("/calendar");
  revalidatePath("/approvals");
  revalidatePath("/home");
}

export const approveItems = tenantAction({ name: "content.approve", permission: "content:approve" }, z.object({ ids: z.array(z.string()).min(1).max(100) }), async ({ ids }, ctx) => {
  const done = await approveContent(scopeOf(ctx), ids, actor(ctx));
  refresh();
  return { approved: done.length };
});

export const rejectItem = tenantAction({ name: "content.reject", permission: "content:approve" }, z.object({ id: z.string(), comment: z.string().max(1000).optional() }), async ({ id, comment }, ctx) => {
  await rejectContent(scopeOf(ctx), id, actor(ctx), comment);
  refresh();
  return { ok: true };
});

export const commentItem = tenantAction({ name: "content.comment", permission: "content:create" }, z.object({ id: z.string(), comment: z.string().trim().min(1).max(1000) }), async ({ id, comment }, ctx) => {
  await commentOnContent(scopeOf(ctx), id, actor(ctx), comment);
  revalidatePath(`/content/${id}`);
  return { ok: true };
});

export const editItem = tenantAction(
  { name: "content.edit", permission: "content:create" },
  z.object({ id: z.string(), hook: z.string().max(500).nullable(), caption: z.string().trim().min(1).max(5000), cta: z.string().max(300).nullable(), hashtags: z.array(z.string().max(60)).max(30) }),
  async ({ id, ...patch }, ctx) => {
    const version = await editContent(scopeOf(ctx), id, patch, { ...actor(ctx), changeNote: "Edited" });
    refresh();
    revalidatePath(`/content/${id}`);
    return { version };
  },
);

export const scheduleItem = tenantAction({ name: "content.schedule", permission: "content:create" }, z.object({ id: z.string(), at: z.string().datetime() }), async ({ id, at }, ctx) => {
  await scheduleContent(scopeOf(ctx), id, new Date(at), actor(ctx));
  refresh();
  return { ok: true };
});

export const retryItem = tenantAction({ name: "content.retry", permission: "content:publish" }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  const outcome = await retryPublication(scopeOf(ctx), id);
  refresh();
  return { outcome };
});

/** Regenerate: asks the content team for a fresh take on the same brief. */
export const regenerateItem = tenantAction({ name: "content.regenerate", permission: "content:create", rateLimit: 10 }, z.object({ id: z.string(), note: z.string().max(500).optional() }), async ({ id, note }, ctx) => {
  if (!aiAvailability().configured) throw new UserFacingError("ai_not_configured");
  const item = await ctx.db.contentItem.findUnique({ where: { id } });
  if (!item) throw new UserFacingError("content_not_found");
  const run = await startRun(scopeOf(ctx), {
    kind: "content_rewrite",
    agent: "CONTENT_STRATEGIST",
    steps: ["reviewing_business", "writing_content"],
    input: note ?? "",
    params: { contentItemId: id },
    requestedById: ctx.user.id,
  });
  return { runId: run.id };
});

export const planWeek = tenantAction({ name: "content.plan_week", permission: "content:create", rateLimit: 5 }, z.object({ count: z.number().int().min(1).max(14).default(7), startDate: z.string().datetime().optional() }), async ({ count, startDate }, ctx) => {
  if (!aiAvailability().configured) throw new UserFacingError("ai_not_configured");
  const run = await startRun(scopeOf(ctx), {
    kind: "content_plan",
    agent: "CONTENT_STRATEGIST",
    steps: CONTENT_PLAN_STEPS,
    input: `Create ${count} posts for next week`,
    params: { count, startDate },
    requestedById: ctx.user.id,
  });
  return { runId: run.id };
});

/** Designer: queues a brand-template design for the post (ai.image.generate job — never inside the request). */
export const generateVisual = tenantAction({ name: "content.visual", permission: "content:create", rateLimit: 6 }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  const { requestImage } = await import("@/server/studio/images");
  const asset = await requestImage(scopeOf(ctx), ctx.user.id, id, {});
  revalidatePath(`/content/${id}`);
  return { assetId: asset.id };
});
