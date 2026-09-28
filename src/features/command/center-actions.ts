"use server";

import { z } from "zod";
import { tenantAction } from "@/server/action";
import { commandHistory, commandInput, commandReply, commandStatus, commandSuggestions, runCommand, understandCommand, replyToCommand } from "@/server/command/service";

/**
 * Command Center API. Every command: understand (intent + entities + permission) → run → status (jobs).
 * RBAC is enforced per intent inside the service; here only "signed in to this workspace".
 */

export const understandCommandAction = tenantAction({ name: "command.understand", permission: "workspace:read", rateLimit: 40 }, commandInput, (input, ctx) => understandCommand(ctx, input));

export const runCommandAction = tenantAction({ name: "command.execute", permission: "workspace:read", rateLimit: 40 }, z.object({ executionId: z.string().max(40) }), ({ executionId }, ctx) => runCommand(ctx, executionId));

export const replyCommandAction = tenantAction({ name: "command.reply", permission: "workspace:read", rateLimit: 40 }, commandReply, (input, ctx) => replyToCommand(ctx, input));

export const commandStatusAction = tenantAction({ name: "command.status", permission: "workspace:read", rateLimit: 300 }, z.object({ executionId: z.string().max(40) }), ({ executionId }, ctx) => commandStatus(ctx, executionId));

export const commandContextAction = tenantAction({ name: "command.context", permission: "workspace:read", rateLimit: 120 }, z.object({}), async (_, ctx) => ({
  history: await commandHistory(ctx),
  suggestions: await commandSuggestions(ctx),
}));
