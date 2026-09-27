"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { NotificationType, Role } from "@/generated/prisma/enums";
import { tenantAction } from "@/server/action";
import { db } from "@/server/db/client";
import { audit } from "@/server/audit";
import { canAssignRole } from "@/server/rbac";
import { UserFacingError } from "@/server/errors";
import { hashToken, randomToken } from "@/server/crypto";
import { getMailer, renderEmail } from "@/server/email/mailer";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { passwordSchema } from "@/server/auth/service";
import { enqueue } from "@/server/jobs/queue";
import { endSession } from "@/server/auth/session";
import { deleteUserAccount } from "@/server/privacy/service";
import { requestPlanChange } from "@/server/billing/service";
import { assertWithinLimit } from "@/server/billing/entitlements";

const ROLES = ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"] as const;
const who = (ctx: { user: { id: string; name: string | null; email: string } }) => ({ actorType: "USER" as const, actorId: ctx.user.id, actorLabel: ctx.user.name ?? ctx.user.email });
const scopeOf = (ctx: { organization: { id: string }; workspace: { id: string } }) => ({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });

export const saveOrganization = tenantAction(
  { name: "settings.org", permission: "settings:manage" },
  z.object({ name: z.string().trim().min(1).max(120), timezone: z.string().max(60), locale: z.enum(["en", "ar"]), website: z.string().trim().max(300).optional() }),
  async (input, ctx) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone });
    } catch {
      throw new UserFacingError("validation");
    }
    await ctx.db.organization.update({ where: { id: ctx.organization.id }, data: { name: input.name, timezone: input.timezone, locale: input.locale, website: input.website || null } });
    await ctx.db.workspaceSettings.updateMany({ data: { timezone: input.timezone } });
    await audit({ ...scopeOf(ctx), ...who(ctx), action: "org.updated", summary: "Organization settings updated" });
    revalidatePath("/settings");
    return { ok: true };
  },
);

export const saveProfile = tenantAction({ name: "settings.profile" }, z.object({ name: z.string().trim().min(1).max(120), locale: z.enum(["en", "ar"]) }), async (input, ctx) => {
  await db.user.update({ where: { id: ctx.user.id }, data: input });
  revalidatePath("/settings/profile");
  return { ok: true };
});

export const changePassword = tenantAction({ name: "settings.password", rateLimit: 5 }, z.object({ current: z.string().max(200), next: z.string().max(200) }), async ({ current, next }, ctx) => {
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, omit: { passwordHash: false } });
  if (user.passwordHash && !(await verifyPassword(user.passwordHash, current))) throw new UserFacingError("invalid_credentials");
  const parsed = passwordSchema.safeParse(next);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "validation");
  await db.user.update({ where: { id: ctx.user.id }, data: { passwordHash: await hashPassword(parsed.data) } });
  await db.session.deleteMany({ where: { userId: ctx.user.id, id: { not: ctx.sessionId } } });
  await audit({ category: "SECURITY", ...who(ctx), organizationId: ctx.organization.id, action: "auth.password_changed", summary: "Password changed; other sessions signed out" });
  return { ok: true };
});

export const revokeSession = tenantAction({ name: "settings.session" }, z.object({ id: z.string().optional(), all: z.boolean().optional() }), async ({ id, all }, ctx) => {
  if (all) await db.session.deleteMany({ where: { userId: ctx.user.id, id: { not: ctx.sessionId } } });
  else if (id) await db.session.deleteMany({ where: { userId: ctx.user.id, id } });
  await audit({ category: "SECURITY", ...who(ctx), organizationId: ctx.organization.id, action: "auth.sessions_revoked", summary: all ? "Signed out all other sessions" : "Signed out a session" });
  revalidatePath("/settings/security");
  return { ok: true };
});

export const inviteMember = tenantAction(
  { name: "team.invite", permission: "team:manage", rateLimit: 20 },
  z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ROLES) }),
  async ({ email, role }, ctx) => {
    if (!canAssignRole(ctx.role, role as Role)) throw new UserFacingError("forbidden");
    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser && (await ctx.db.organizationMember.findFirst({ where: { userId: existingUser.id } }))) throw new UserFacingError("already_member");
    await assertWithinLimit(ctx.organization.id, "seats");
    const token = randomToken();
    await ctx.db.invitation.deleteMany({ where: { email, acceptedAt: null } });
    await ctx.db.invitation.create({ data: { organizationId: ctx.organization.id, email, role: role as Role, tokenHash: hashToken(token), invitedById: ctx.user.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    const url = `${process.env.APP_URL ?? ""}/invite/${token}`;
    const ar = ctx.organization.locale === "ar";
    const { html, text } = renderEmail({
      locale: ctx.organization.locale,
      heading: ar ? `دعوة للانضمام إلى ${ctx.organization.name}` : `Join ${ctx.organization.name}`,
      body: ar ? `دعاك ${ctx.user.name ?? ctx.user.email} للانضمام إلى فريق النمو الذكي.` : `${ctx.user.name ?? ctx.user.email} invited you to their AI Growth Team.`,
      ctaLabel: ar ? "قبول الدعوة" : "Accept invitation",
      ctaUrl: url,
    });
    await getMailer().send({ to: email, subject: ar ? "دعوة للانضمام" : `You're invited to ${ctx.organization.name}`, html, text });
    await audit({ category: "SECURITY", ...scopeOf(ctx), ...who(ctx), action: "team.invited", summary: `Invited ${email} as ${role}` });
    revalidatePath("/settings/team");
    return { ok: true };
  },
);

export const revokeInvite = tenantAction({ name: "team.revoke", permission: "team:manage" }, z.object({ id: z.string() }), async ({ id }, ctx) => {
  await ctx.db.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
  revalidatePath("/settings/team");
  return { ok: true };
});

export const changeRole = tenantAction({ name: "team.role", permission: "team:manage" }, z.object({ memberId: z.string(), role: z.enum(ROLES) }), async ({ memberId, role }, ctx) => {
  const m = await ctx.db.organizationMember.findUnique({ where: { id: memberId } });
  if (!m) throw new UserFacingError("item_not_found");
  if (!canAssignRole(ctx.role, role as Role) || !canAssignRole(ctx.role, m.role)) throw new UserFacingError("forbidden");
  if (m.role === "OWNER" && role !== "OWNER" && (await ctx.db.organizationMember.count({ where: { role: "OWNER" } })) === 1) throw new UserFacingError("last_owner");
  await ctx.db.organizationMember.update({ where: { id: memberId }, data: { role: role as Role } });
  await audit({ category: "SECURITY", ...scopeOf(ctx), ...who(ctx), action: "team.role_changed", summary: `Changed a member's role to ${role}` });
  revalidatePath("/settings/team");
  return { ok: true };
});

export const removeMember = tenantAction({ name: "team.remove", permission: "team:manage" }, z.object({ memberId: z.string() }), async ({ memberId }, ctx) => {
  const m = await ctx.db.organizationMember.findUnique({ where: { id: memberId } });
  if (!m) throw new UserFacingError("item_not_found");
  if (!canAssignRole(ctx.role, m.role)) throw new UserFacingError("forbidden");
  if (m.role === "OWNER" && (await ctx.db.organizationMember.count({ where: { role: "OWNER" } })) === 1) throw new UserFacingError("last_owner");
  await ctx.db.organizationMember.delete({ where: { id: memberId } });
  await db.session.updateMany({ where: { userId: m.userId, activeOrganizationId: ctx.organization.id }, data: { activeOrganizationId: null } });
  await audit({ category: "SECURITY", ...scopeOf(ctx), ...who(ctx), action: "team.removed", summary: "Removed a team member" });
  revalidatePath("/settings/team");
  return { ok: true };
});

export const saveAiSettings = tenantAction(
  { name: "settings.ai", permission: "agents:configure" },
  z.object({
    salesAutonomy: z.enum(["ASSIST", "COPILOT", "AUTOPILOT"]),
    autopilotAllowedTasks: z.array(z.enum(["send_follow_up", "send_first_reply", "schedule_reminder"])).max(5),
    requireContentApproval: z.boolean(),
    weeklyAutoPlan: z.boolean(),
    dailyBriefHour: z.number().int().min(0).max(23),
  }),
  async ({ weeklyAutoPlan, ...input }, ctx) => {
    await ctx.db.workspaceSettings.updateMany({ data: input });
    await db.scheduledJob.updateMany({ where: { key: `agent:weekly_plan:${ctx.workspace.id}` }, data: { enabled: weeklyAutoPlan } });
    await audit({ ...scopeOf(ctx), ...who(ctx), action: "settings.ai", summary: `AI settings updated (sales autonomy: ${input.salesAutonomy})` });
    revalidatePath("/settings/ai");
    return { ok: true };
  },
);

export const saveApprovalPolicy = tenantAction({ name: "settings.policy", permission: "approvals:policy" }, z.object({ action: z.string().max(40), requiresApproval: z.boolean() }), async ({ action, requiresApproval }, ctx) => {
  await ctx.db.approvalPolicy.upsert({
    where: { workspaceId_action: { workspaceId: ctx.workspace.id, action } },
    create: { organizationId: "", workspaceId: "", action, requiresApproval },
    update: { requiresApproval },
  });
  await audit({ ...scopeOf(ctx), ...who(ctx), action: "settings.approval_policy", summary: `Approval for "${action}" ${requiresApproval ? "required" : "not required"}` });
  revalidatePath("/settings/approvals");
  return { ok: true };
});

export const saveNotificationPref = tenantAction({ name: "settings.notif" }, z.object({ type: z.string(), inApp: z.boolean(), email: z.boolean() }), async ({ type, inApp, email }, ctx) => {
  await db.notificationPreference.upsert({
    where: { organizationId_userId_type: { organizationId: ctx.organization.id, userId: ctx.user.id, type: type as NotificationType } },
    create: { organizationId: ctx.organization.id, userId: ctx.user.id, type: type as NotificationType, inApp, email },
    update: { inApp, email },
  });
  return { ok: true };
});

export const saveAiBudget = tenantAction({ name: "settings.budget", permission: "billing:manage" }, z.object({ monthlyAllowanceUsd: z.number().min(1).max(100_000), softLimitPercent: z.number().int().min(10).max(100), hardLimitEnabled: z.boolean() }), async (input, ctx) => {
  await ctx.db.aiBudget.update({ where: { organizationId: ctx.organization.id }, data: { monthlyAllowanceMicro: BigInt(Math.round(input.monthlyAllowanceUsd * 1_000_000)), softLimitPercent: input.softLimitPercent, hardLimitEnabled: input.hardLimitEnabled } });
  await audit({ ...scopeOf(ctx), ...who(ctx), action: "billing.ai_budget", summary: `AI allowance set to $${input.monthlyAllowanceUsd}` });
  revalidatePath("/settings/billing");
  return { ok: true };
});

export const startCheckout = tenantAction({ name: "billing.checkout", permission: "billing:manage" }, z.object({ plan: z.enum(["STARTER", "GROWTH", "SCALE"]) }), async ({ plan }, ctx) => {
  return requestPlanChange({ organizationId: ctx.organization.id, plan, email: ctx.user.email, actorId: ctx.user.id });
});

export const requestExport = tenantAction({ name: "data.export", permission: "data:export", rateLimit: 3 }, z.object({}), async (_, ctx) => {
  const exp = await db.dataExport.create({ data: { organizationId: ctx.organization.id, requestedById: ctx.user.id } });
  await enqueue("privacy.export", { organizationId: ctx.organization.id, exportId: exp.id }, { organizationId: ctx.organization.id });
  await audit({ category: "SECURITY", ...scopeOf(ctx), ...who(ctx), action: "data.export_requested", summary: "Data export requested" });
  revalidatePath("/settings/data");
  return { ok: true };
});

export const deleteOrganizationAction = tenantAction({ name: "data.delete_org", permission: "org:delete", rateLimit: 3 }, z.object({ confirm: z.string() }), async ({ confirm }, ctx) => {
  if (confirm.trim() !== ctx.organization.name) throw new UserFacingError("confirm_mismatch");
  await audit({ category: "SECURITY", organizationId: ctx.organization.id, ...who(ctx), action: "organization.delete_requested", summary: `Deletion requested for "${ctx.organization.name}"` });
  await enqueue("privacy.delete_org", { organizationId: ctx.organization.id, actorId: ctx.user.id }, { maxAttempts: 5 });
  await db.organizationMember.deleteMany({ where: { organizationId: ctx.organization.id } });
  redirect("/onboarding");
});

export const deleteAccount = tenantAction({ name: "data.delete_account", rateLimit: 3 }, z.object({ confirm: z.string() }), async ({ confirm }, ctx) => {
  if (confirm.trim().toLowerCase() !== ctx.user.email.toLowerCase()) throw new UserFacingError("confirm_mismatch");
  await deleteUserAccount(ctx.user.id);
  await endSession();
  redirect("/");
});

export const saveLeadForm = tenantAction(
  { name: "leads.form", permission: "settings:manage" },
  z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(80), allowedOrigins: z.array(z.string().url()).max(10), successMessage: z.string().max(300).optional(), isActive: z.boolean() }),
  async ({ id, ...data }, ctx) => {
    if (id) await ctx.db.leadCaptureForm.update({ where: { id }, data });
    else
      await ctx.db.leadCaptureForm.create({
        data: {
          organizationId: "",
          workspaceId: "",
          publicKey: randomToken(12),
          fields: [
            { key: "name", label: "Name", type: "text", required: true },
            { key: "email", label: "Email", type: "email", required: true },
            { key: "phone", label: "Phone", type: "tel", required: false },
            { key: "message", label: "How can we help?", type: "textarea", required: true },
          ],
          ...data,
        },
      });
    revalidatePath("/settings/lead-capture");
    return { ok: true };
  },
);

/** Content studio defaults: speed (fast / highest quality) and style (brand template / AI creative). */
export const saveContentAiDefaults = tenantAction(
  { name: "settings.content_ai", permission: "agents:configure" },
  z.object({ imageQuality: z.enum(["fast", "quality"]), imageMode: z.enum(["brand_template", "ai_creative"]) }),
  async (input, ctx) => {
    await ctx.db.workspaceSettings.updateMany({ data: input });
    await audit({ ...scopeOf(ctx), ...who(ctx), action: "settings.content_ai", summary: `Content AI defaults: ${input.imageQuality}, ${input.imageMode}` });
    revalidatePath("/settings/ai");
    return { ok: true };
  },
);
