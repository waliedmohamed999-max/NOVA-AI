"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { audit } from "@/server/audit";
import { PLANS } from "@/config/plans";
import { UserFacingError } from "@/server/errors";

export const updateAgent = tenantAction(
  { name: "agents.update", permission: "agents:configure" },
  z.object({ id: z.string(), enabled: z.boolean().optional(), guidance: z.string().max(1000).optional() }),
  async ({ id, enabled, guidance }, ctx) => {
    const agent = await ctx.db.agent.findUnique({ where: { id } });
    if (!agent) throw new UserFacingError("item_not_found");
    if (enabled) {
      const sub = await ctx.db.subscription.findFirst();
      if (!(PLANS[sub?.plan ?? "STARTER"].agents as readonly string[]).includes(agent.key)) throw new UserFacingError("plan_limit");
    }
    await ctx.db.agent.update({
      where: { id },
      data: {
        ...(enabled !== undefined ? { enabled, status: enabled ? "MONITORING" : "PAUSED" } : {}),
        ...(guidance !== undefined ? { settings: { ...((agent.settings as object) ?? {}), guidance } } : {}),
      },
    });
    await audit({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id, actorType: "USER", actorId: ctx.user.id, actorLabel: ctx.user.name ?? ctx.user.email, action: "agent.updated", entityType: "Agent", entityId: id, summary: `Updated ${agent.name} settings` });
    revalidatePath("/team");
    return { ok: true };
  },
);
