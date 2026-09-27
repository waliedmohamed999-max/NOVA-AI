"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { setCampaignStatus } from "@/server/campaigns/service";

export const setCampaign = tenantAction(
  { name: "campaigns.status", permission: "campaign:manage" },
  z.object({ id: z.string(), status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED", "COMPLETED"]) }),
  async ({ id, status }, ctx) => {
    await setCampaignStatus({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }, id, status, { userId: ctx.user.id, label: ctx.user.name ?? ctx.user.email });
    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${id}`);
    return { ok: true };
  },
);
