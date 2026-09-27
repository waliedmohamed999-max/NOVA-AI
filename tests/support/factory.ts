import { db } from "@/server/db/client";
import { provisionOrganization } from "@/server/tenancy/provision";
import { randomUUID } from "node:crypto";

export async function makeUser(overrides: { email?: string; name?: string } = {}) {
  return db.user.create({
    data: { email: overrides.email ?? `user-${randomUUID()}@example.com`, name: overrides.name ?? "Test User", emailVerifiedAt: new Date() },
  });
}

/** A fully provisioned tenant (organization + default workspace) owned by a new user. */
export async function makeTenant(name = "Acme Studio", locale = "en") {
  const user = await makeUser();
  const { organization, workspace } = await provisionOrganization({ userId: user.id, name, locale });
  return { user, organization, workspace, scope: { organizationId: organization.id, workspaceId: workspace.id } };
}
