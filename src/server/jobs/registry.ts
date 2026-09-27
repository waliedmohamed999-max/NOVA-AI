import { PermanentJobError } from "./queue";
import type { Job } from "@/generated/prisma/client";
import type { Logger } from "../logger";

export type JobContext = { job: Job; log: Logger };
export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();

export function registerJob(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export function getHandler(type: string) {
  return handlers.get(type);
}

export function registeredJobTypes() {
  return [...handlers.keys()];
}

export type Scoped = { organizationId: string; workspaceId: string };

/** Extracts and validates the tenant scope carried in every tenant job payload. */
export function scopeOf(payload: Record<string, unknown>): Scoped {
  const organizationId = String(payload.organizationId ?? "");
  const workspaceId = String(payload.workspaceId ?? "");
  if (!organizationId || !workspaceId) throw new PermanentJobError("Job payload is missing tenant scope");
  return { organizationId, workspaceId };
}
