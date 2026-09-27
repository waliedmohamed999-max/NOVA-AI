"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { audit } from "@/server/audit";
import { mapError, type ActionResult } from "@/server/action";
import { resolveTenant } from "@/server/context";
import { enforceRateLimit } from "@/server/rate-limit";
import { publishTestPost, testConnection, type ConnectionTestResult } from "@/server/integrations/diagnostics";

/** Re-queues a dead/failed job. Platform admins only. */
export async function retryJobAction(input: { id: string }): Promise<ActionResult<undefined>> {
  const session = await getSession();
  if (!session?.user.isPlatformAdmin) return { ok: false, error: "forbidden" };
  const { id } = z.object({ id: z.string() }).parse(input);
  const res = await db.job.updateMany({ where: { id, status: { in: ["DEAD", "FAILED"] } }, data: { status: "RETRYING", runAt: new Date(), attempts: 0, lastError: null, finishedAt: null } });
  if (res.count === 1) await audit({ category: "SECURITY", actorType: "USER", actorId: session.userId, action: "admin.job_retried", entityType: "Job", entityId: id, summary: "Platform admin re-queued a job" });
  revalidatePath("/admin");
  return res.count === 1 ? { ok: true, data: undefined } : { ok: false, error: "invalid_transition" };
}

/** Platform admin + the admin's own workspace: connection diagnostics never touch other tenants. */
async function adminScope() {
  const session = await getSession();
  if (!session?.user.isPlatformAdmin) return null;
  const tenant = await resolveTenant();
  if (!tenant) return null;
  return { userId: session.userId, scope: { organizationId: tenant.organization.id, workspaceId: tenant.workspace.id } };
}

export async function testConnectionAction(input: { integrationId: string }): Promise<ActionResult<ConnectionTestResult>> {
  const a = await adminScope();
  if (!a) return { ok: false, error: "forbidden" };
  try {
    const { integrationId } = z.object({ integrationId: z.string() }).parse(input);
    return { ok: true, data: await testConnection(a.scope, integrationId) };
  } catch (err) {
    return mapError(err, "admin.test_connection");
  }
}

export async function publishTestPostAction(input: { accountId: string; confirmation: string }): Promise<ActionResult<{ externalId: string; permalink: string | null }>> {
  const a = await adminScope();
  if (!a) return { ok: false, error: "forbidden" };
  try {
    const { accountId, confirmation } = z.object({ accountId: z.string(), confirmation: z.string() }).parse(input);
    await enforceRateLimit(`admin-test-post:${a.userId}`, 5, 3600);
    const r = await publishTestPost(a.scope, a.userId, accountId, confirmation);
    return { ok: true, data: { externalId: r.externalId, permalink: r.permalink ?? null } };
  } catch (err) {
    return mapError(err, "admin.test_post");
  }
}
