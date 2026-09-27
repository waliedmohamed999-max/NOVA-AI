"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { disconnectIntegration } from "@/server/integrations/service";
import { enqueue } from "@/server/jobs/queue";
import { UserFacingError } from "@/server/errors";

export const disconnect = tenantAction({ name: "integrations.disconnect", permission: "integrations:manage" }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  await disconnectIntegration({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }, id, ctx.user.id);
  revalidatePath("/integrations");
  return { ok: true };
});

export const syncNow = tenantAction({ name: "integrations.sync", permission: "integrations:manage", rateLimit: 6 }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  const i = await ctx.db.integration.findUnique({ where: { id } });
  if (!i || i.status !== "CONNECTED") throw new UserFacingError("integration_error");
  await enqueue("social.sync_integration", { integrationId: id, organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }, { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
  return { ok: true };
});
