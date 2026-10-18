"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { replyToComment } from "@/server/social/comments";

export const replyCommentAction = tenantAction(
  { name: "social.comment_reply", permission: "content:publish", rateLimit: 30 },
  z.object({ accountId: z.string().min(1).max(40), commentId: z.string().min(1).max(120), message: z.string().trim().min(1).max(2000) }),
  async ({ accountId, commentId, message }, ctx) => {
    await replyToComment({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }, accountId, commentId, message, { userId: ctx.user.id, label: ctx.user.name ?? ctx.user.email });
    revalidatePath("/social/comments");
    return { ok: true };
  },
);
