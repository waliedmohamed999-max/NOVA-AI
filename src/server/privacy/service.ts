import { db } from "../db/client";
import { ORGANIZATION_MODELS, WORKSPACE_MODELS } from "../db/tenant";
import { storage, saveUpload } from "../storage";
import { audit } from "../audit";
import { notify } from "../notifications/service";
import { logger } from "../logger";

/** Prisma delegate name for a model (e.g. "ContentItem" → "contentItem"). */
const delegate = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

/** Tables never included in exports (secrets). */
const EXCLUDED_FROM_EXPORT = new Set(["IntegrationCredential"]);

/** Builds a JSON export of every tenant-owned row. Credentials are never exported. */
export async function exportOrganization(organizationId: string, exportId: string) {
  await db.dataExport.update({ where: { id: exportId }, data: { status: "PROCESSING" } });
  try {
    const out: Record<string, unknown[]> = {};
    const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
    out.organization = [org];
    for (const model of [...ORGANIZATION_MODELS, ...WORKSPACE_MODELS]) {
      if (EXCLUDED_FROM_EXPORT.has(model)) continue;
      const d = (db as unknown as Record<string, { findMany: (a: object) => Promise<unknown[]> }>)[delegate(model)];
      out[model] = await d.findMany({ where: { organizationId } });
    }
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), organizationId, data: out }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
    const file = await saveUpload({ organizationId, fileName: `export-${org.slug}-${new Date().toISOString().slice(0, 10)}.json`, data: Buffer.from(json), purpose: "data_export" });
    const exp = await db.dataExport.update({ where: { id: exportId }, data: { status: "READY", fileId: file.id, completedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    await notify({ organizationId, type: "REPORT_READY", title: org.locale === "ar" ? "تصدير بياناتك جاهز" : "Your data export is ready", link: "/settings/data", userIds: [exp.requestedById] });
    return { fileId: file.id };
  } catch (err) {
    await db.dataExport.update({ where: { id: exportId }, data: { status: "FAILED", error: "unexpected" } });
    throw err;
  }
}

/** Permanently deletes an organization and all of its data, including stored files. */
export async function deleteOrganization(organizationId: string, actorId: string) {
  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (!org) return { deleted: false };
  const files = await db.fileObject.findMany({ where: { organizationId }, select: { storageKey: true } });
  for (const f of files) await storage.delete(f.storageKey).catch((err) => logger.warn({ err }, "file delete failed"));
  await db.$transaction(async (tx) => {
    // Children first (tables without FKs to the organization are cleared explicitly).
    for (const model of [...WORKSPACE_MODELS].reverse()) {
      await (tx as unknown as Record<string, { deleteMany: (a: object) => Promise<unknown> }>)[delegate(model)].deleteMany({ where: { organizationId } });
    }
    for (const model of ["UsageRecord", "FileObject", "AiRun", "AiUsage", "DataExport", "Notification", "NotificationPreference", "ConversationParticipant", "AuditLog"]) {
      await (tx as unknown as Record<string, { deleteMany: (a: object) => Promise<unknown> }>)[delegate(model)].deleteMany({ where: { organizationId } });
    }
    await tx.job.deleteMany({ where: { organizationId } });
    await tx.scheduledJob.deleteMany({ where: { organizationId } });
    await tx.oAuthState.deleteMany({ where: { organizationId } });
    await tx.session.updateMany({ where: { activeOrganizationId: organizationId }, data: { activeOrganizationId: null } });
    await tx.organization.delete({ where: { id: organizationId } }); // cascades members, invitations, workspaces, subscription, budget
  });
  await audit({ category: "SECURITY", actorType: "USER", actorId, action: "organization.deleted", summary: `Organization "${org.name}" and all its data were permanently deleted`, metadata: { organizationId } });
  return { deleted: true };
}

/** Deletes a user account. Organizations where they are the only owner are deleted too. */
export async function deleteUserAccount(userId: string) {
  const owned = await db.organizationMember.findMany({ where: { userId, role: "OWNER" } });
  for (const m of owned) {
    const owners = await db.organizationMember.count({ where: { organizationId: m.organizationId, role: "OWNER" } });
    if (owners === 1) await deleteOrganization(m.organizationId, userId);
  }
  await db.user.delete({ where: { id: userId } });
  await audit({ category: "SECURITY", actorType: "USER", actorId: userId, action: "user.deleted", summary: "A user deleted their account" });
}
