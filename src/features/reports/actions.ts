"use server";

import { z } from "zod";
import { tenantAction } from "@/server/action";
import { generateWeeklyReport } from "@/server/reports/service";
import { aiAvailability, toUserFacing } from "@/server/ai";
import { UserFacingError } from "@/server/errors";

export const generateWeekly = tenantAction({ name: "reports.weekly", permission: "analytics:read", rateLimit: 3 }, z.object({}), async (_, ctx) => {
  if (!aiAvailability().configured) throw new UserFacingError("ai_not_configured");
  try {
    const r = await generateWeeklyReport({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
    return { id: r.id };
  } catch (err) {
    throw toUserFacing(err);
  }
});
