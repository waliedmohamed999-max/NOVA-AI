"use server";

import { z } from "zod";
import { tenantAction } from "@/server/action";
import { startRun, type RunResult, type RunStep } from "@/server/agents/runtime";
import { aiAvailability } from "@/server/ai";
import { UserFacingError, NotFoundError } from "@/server/errors";
import { approveContent } from "@/server/content/service";
import { addKnowledgeSource } from "@/server/knowledge/service";
import { storage } from "@/server/storage";
import { approveCampaign } from "@/server/campaigns/service";

export type RunDTO = {
  id: string;
  kind: string;
  input: string | null;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  steps: RunStep[];
  result: RunResult | null;
  error: string | null;
  createdAt: string;
};

function toDTO(run: { id: string; kind: string; input: string | null; status: RunDTO["status"]; steps: unknown; result: unknown; error: string | null; createdAt: Date }): RunDTO {
  const result = run.result as (RunResult & { params?: unknown }) | null;
  return {
    id: run.id,
    kind: run.kind,
    input: run.input,
    status: run.status,
    steps: (run.steps as RunStep[]) ?? [],
    result: result && "type" in result ? result : null,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
  };
}

export const runCommand = tenantAction(
  { name: "command.run", permission: "agents:command", rateLimit: 20 },
  z.object({ text: z.string().trim().min(2).max(2000), fileIds: z.array(z.string()).max(5).default([]) }),
  async ({ text, fileIds }, ctx) => {
    if (!aiAvailability().configured) throw new UserFacingError("ai_not_configured");
    const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
    const files = fileIds.length ? await ctx.db.fileObject.findMany({ where: { id: { in: fileIds }, deletedAt: null } }) : [];
    // Text documents become company knowledge; images are passed to the agents.
    for (const f of files.filter((f) => f.mimeType.startsWith("text/") || f.mimeType === "application/json")) {
      const raw = (await storage.get(f.storageKey)).toString("utf8").slice(0, 200_000);
      await addKnowledgeSource(scope, { type: "DOCUMENT", title: f.fileName, rawText: raw, fileId: f.id });
    }
    const run = await startRun(scope, {
      kind: "command",
      agent: "SOCIAL_MANAGER",
      input: text,
      steps: ["understanding_goal"],
      requestedById: ctx.user.id,
      params: { imageFileIds: files.filter((f) => f.mimeType.startsWith("image/")).map((f) => f.id) },
    });
    return { runId: run.id };
  },
);

export const getRun = tenantAction({ name: "command.get" }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  const run = await ctx.db.agentRun.findUnique({ where: { id } });
  if (!run) throw new NotFoundError();
  return toDTO(run);
});

export const recentRuns = tenantAction({ name: "command.recent" }, z.object({ limit: z.number().int().max(20).default(6) }), async ({ limit }, ctx) => {
  const runs = await ctx.db.agentRun.findMany({ where: { kind: "command", requestedById: ctx.user.id }, orderBy: { createdAt: "desc" }, take: limit });
  return runs.map(toDTO);
});

export const approveRunContent = tenantAction({ name: "command.approve_all", permission: "content:approve" }, z.object({ runId: z.string() }), async ({ runId }, ctx) => {
  const run = await ctx.db.agentRun.findUnique({ where: { id: runId } });
  const entity = (run?.result as RunResult | null)?.entity;
  if (!entity) throw new NotFoundError();
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const ids = entity.type === "ContentBatch" ? entity.id.split(",") : (await ctx.db.contentItem.findMany({ where: { campaignId: entity.id }, select: { id: true } })).map((c) => c.id);
  const approved = await approveContent(scope, ids, { userId: ctx.user.id, label: ctx.user.name ?? ctx.user.email });
  return { approved: approved.length };
});

export const approveCampaignFromRun = tenantAction({ name: "command.approve_campaign", permission: "campaign:manage" }, z.object({ campaignId: z.string() }), async ({ campaignId }, ctx) => {
  await approveCampaign({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }, campaignId, { userId: ctx.user.id, label: ctx.user.name ?? ctx.user.email });
  return { ok: true };
});
