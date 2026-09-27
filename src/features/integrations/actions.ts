"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { tenantAction } from "@/server/action";
import { CONNECTED_ACCOUNTS_PATH, ONBOARDING_CONNECT_PATH, disconnectIntegration, selectAccountsBatch } from "@/server/integrations/service";
import { setWebsite } from "@/server/onboarding/service";
import { enqueue } from "@/server/jobs/queue";
import { db } from "@/server/db/client";
import { UserFacingError } from "@/server/errors";

const refresh = () => {
  revalidatePath(CONNECTED_ACCOUNTS_PATH);
  revalidatePath(ONBOARDING_CONNECT_PATH);
};

export const disconnect = tenantAction({ name: "integrations.disconnect", permission: "integrations:manage" }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  await disconnectIntegration({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }, id, ctx.user.id);
  refresh();
  return { ok: true };
});

/** Saves the account picker: one or more integrations (e.g. Facebook + Instagram from one Meta sign-in). */
export const chooseAccounts = tenantAction(
  { name: "integrations.choose", permission: "integrations:manage", rateLimit: 20 },
  z.object({ selections: z.array(z.object({ integrationId: z.string(), accountIds: z.array(z.string()).max(50) })).min(1).max(6) }),
  async ({ selections }, ctx) => {
    const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
    const count = await selectAccountsBatch(scope, ctx.user.id, selections);
    for (const sel of selections.filter((x) => x.accountIds.length)) await enqueue("social.sync_integration", { integrationId: sel.integrationId, ...scope }, scope);
    refresh();
    return { count };
  },
);

export const syncNow = tenantAction({ name: "integrations.sync", permission: "integrations:manage", rateLimit: 6 }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  const i = await ctx.db.integration.findUnique({ where: { id } });
  if (!i || i.status !== "CONNECTED") throw new UserFacingError("integration_error");
  await enqueue("social.sync_integration", { integrationId: id, organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }, { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
  return { ok: true };
});

/** Saves the company website and (re)reads it with the existing knowledge ingestion pipeline. */
export const analyzeWebsite = tenantAction(
  { name: "integrations.website", permission: "settings:manage", rateLimit: 6 },
  z.object({ url: z.string().trim().min(3).max(300) }),
  async ({ url }, ctx) => {
    let saved: string;
    try {
      saved = await setWebsite(ctx.organization.id, url);
    } catch (err) {
      if (err instanceof UserFacingError) throw err;
      throw new UserFacingError("website_unreachable");
    }
    const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
    const source = await db.knowledgeSource.findFirst({ where: { ...scope, type: "WEBSITE", url: saved } });
    if (source && (source.status === "READY" || source.status === "FAILED")) {
      const next = await db.knowledgeSource.update({ where: { id: source.id }, data: { status: "PENDING", error: null } });
      await enqueue("knowledge.ingest", { ...scope, sourceId: source.id }, { ...scope, dedupeKey: `knowledge.ingest:${source.id}:${next.updatedAt.getTime()}` });
    }
    refresh();
    return { url: saved };
  },
);

export const websiteStatus = tenantAction({ name: "integrations.website_status", rateLimit: 60 }, z.object({}), async (_input, ctx) => {
  const source = await ctx.db.knowledgeSource.findFirst({ where: { type: "WEBSITE" }, orderBy: { updatedAt: "desc" } });
  return { status: source?.status ?? null };
});
