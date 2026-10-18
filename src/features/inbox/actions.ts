"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import type { TenantContext } from "@/server/context";
import { replyToConversation, setConversationStatus } from "@/server/inbox/service";

const scopeOf = (ctx: TenantContext) => ({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
const actorOf = (ctx: TenantContext) => ({ userId: ctx.user.id, label: ctx.user.name ?? ctx.user.email });
const id = z.string().min(1).max(40);

export const replyAction = tenantAction({ name: "inbox.reply", permission: "leads:manage", rateLimit: 60 }, z.object({ conversationId: id, body: z.string().trim().min(1).max(8000) }), async ({ conversationId, body }, ctx) => {
  await replyToConversation(scopeOf(ctx), conversationId, body, actorOf(ctx));
  revalidatePath("/inbox");
  return { ok: true };
});

export const setStatusAction = tenantAction({ name: "inbox.status", permission: "leads:manage", rateLimit: 60 }, z.object({ conversationId: id, status: z.enum(["OPEN", "CLOSED"]) }), async ({ conversationId, status }, ctx) => {
  await setConversationStatus(scopeOf(ctx), conversationId, status, actorOf(ctx));
  revalidatePath("/inbox");
  return { ok: true };
});
