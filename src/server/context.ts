import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "./db/client";
import { tenantDb, type TenantDb } from "./db/tenant";
import { getSession } from "./auth/session";
import { can, ForbiddenError, type Permission } from "./rbac";
import type { Role } from "@/generated/prisma/enums";

export type TenantContext = {
  user: { id: string; email: string; name: string | null; locale: string; isPlatformAdmin: boolean; emailVerifiedAt: Date | null };
  sessionId: string;
  organization: { id: string; name: string; slug: string; onboardingStatus: string; timezone: string; locale: string; isDemo: boolean };
  workspace: { id: string; name: string };
  role: Role;
  db: TenantDb;
  can: (p: Permission) => boolean;
};

export const getUser = cache(async () => {
  const session = await getSession();
  return session?.user ?? null;
});

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session.user;
}

/** Resolves the active organization + workspace for the signed-in user. Null when the user has no organization yet. */
export const resolveTenant = cache(async (): Promise<TenantContext | null> => {
  const session = await getSession();
  if (!session) return null;

  const memberships = await db.organizationMember.findMany({
    where: { userId: session.userId },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return null;

  const membership = memberships.find((m) => m.organizationId === session.activeOrganizationId) ?? memberships[0];
  const workspace =
    (await db.workspace.findFirst({ where: { organizationId: membership.organizationId, isDefault: true } })) ??
    (await db.workspace.findFirst({ where: { organizationId: membership.organizationId }, orderBy: { createdAt: "asc" } }));
  if (!workspace) return null;

  const role = membership.role;
  const u = session.user;
  return {
    user: { id: u.id, email: u.email, name: u.name, locale: u.locale, isPlatformAdmin: u.isPlatformAdmin, emailVerifiedAt: u.emailVerifiedAt },
    sessionId: session.id,
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      onboardingStatus: membership.organization.onboardingStatus,
      timezone: membership.organization.timezone,
      locale: membership.organization.locale,
      isDemo: membership.organization.isDemo,
    },
    workspace: { id: workspace.id, name: workspace.name },
    role,
    db: tenantDb({ organizationId: membership.organizationId, workspaceId: workspace.id }),
    can: (p) => can(role, p),
  };
});

/**
 * Use in pages/layouts: redirects to sign-in or onboarding when needed.
 * Pass `permission` to enforce RBAC (throws ForbiddenError → error boundary).
 */
export async function requireTenant(opts: { permission?: Permission; allowIncompleteOnboarding?: boolean } = {}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const ctx = await resolveTenant();
  if (!ctx) redirect("/onboarding");
  if (!opts.allowIncompleteOnboarding && ctx.organization.onboardingStatus !== "COMPLETED") redirect("/onboarding");
  if (opts.permission && !ctx.can(opts.permission)) throw new ForbiddenError(opts.permission);
  return ctx;
}

export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!user.isPlatformAdmin) throw new ForbiddenError();
  return user;
}
