"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { analyzePost } from "@/server/agents/workflows/analyst";
import { aiAvailability, toUserFacing } from "@/server/ai";
import { UserFacingError } from "@/server/errors";

export const analyzePostNow = tenantAction({ name: "analytics.analyze", permission: "analytics:read", rateLimit: 10 }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  if (!aiAvailability().configured) throw new UserFacingError("ai_not_configured");
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const post = await ctx.db.socialPost.findUnique({ where: { id } });
  if (!post) throw new UserFacingError("item_not_found");
  try {
    await analyzePost(scope, id, { ...scope, agentKey: "PERFORMANCE_ANALYST" });
  } catch (err) {
    throw toUserFacing(err);
  }
  revalidatePath(`/analytics/posts/${id}`);
  return { ok: true };
});
