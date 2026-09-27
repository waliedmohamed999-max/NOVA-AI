"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { audit } from "@/server/audit";
import type { ActionResult } from "@/server/action";

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
