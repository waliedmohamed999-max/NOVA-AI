import type { ActorType, AuditCategory } from "@/generated/prisma/enums";
import { db } from "./db/client";
import { logger } from "./logger";

export type AuditEntry = {
  organizationId?: string | null;
  workspaceId?: string | null;
  category?: AuditCategory;
  actorType: ActorType;
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Append-only activity & security log. Failures never break the caller's
 * flow, but are logged loudly.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: entry.organizationId ?? null,
        workspaceId: entry.workspaceId ?? null,
        category: entry.category ?? "BUSINESS",
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        actorLabel: entry.actorLabel ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        summary: entry.summary,
        metadata: (entry.metadata ?? {}) as object,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, "audit log write failed");
  }
}
