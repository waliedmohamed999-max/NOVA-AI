"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { decideApproval, APPROVAL_PERMISSION } from "@/server/approvals/service";
import { ForbiddenError } from "@/server/rbac";
import { NotFoundError } from "@/server/errors";

export const decide = tenantAction(
  { name: "approvals.decide", rateLimit: 120 },
  z.object({ ids: z.array(z.string()).min(1).max(50), decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().max(1000).optional() }),
  async ({ ids, decision, note }, ctx) => {
    const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
    const results = [];
    for (const id of ids) {
      const a = await ctx.db.approval.findUnique({ where: { id } });
      if (!a) throw new NotFoundError();
      if (!ctx.can(APPROVAL_PERMISSION[a.category] ?? "content:approve")) throw new ForbiddenError();
      results.push(await decideApproval(scope, id, decision, { userId: ctx.user.id, label: ctx.user.name ?? ctx.user.email }, note));
    }
    for (const p of ["/approvals", "/home", "/content", "/calendar", "/campaigns", "/leads"]) revalidatePath(p);
    return { done: results.length, outcomes: results.map((r) => r.outcome) };
  },
);
