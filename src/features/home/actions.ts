"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { generateDailyBrief } from "@/server/reports/service";
import { toUserFacing } from "@/server/ai";

export const refreshBrief = tenantAction({ name: "home.brief", permission: "workspace:read", rateLimit: 5 }, z.object({}), async (_, ctx) => {
  try {
    await generateDailyBrief({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
  } catch (err) {
    throw toUserFacing(err);
  }
  revalidatePath("/home");
  return { ok: true };
});
