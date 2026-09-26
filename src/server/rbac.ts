import type { Role } from "@/generated/prisma/enums";

/**
 * Role-based access control. Permissions are checked server-side in every
 * action and route handler via `requireTenant({ permission })`.
 */
export const PERMISSIONS = [
  "workspace:read",
  "content:create",
  "content:approve",
  "content:publish",
  "campaign:manage",
  "leads:read",
  "leads:manage",
  "sales:approve",
  "knowledge:manage",
  "brand:manage",
  "agents:command",
  "agents:configure",
  "integrations:manage",
  "analytics:read",
  "team:manage",
  "billing:manage",
  "settings:manage",
  "approvals:policy",
  "data:export",
  "org:delete",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = ["workspace:read", "leads:read", "analytics:read"];
const MEMBER: Permission[] = [...VIEWER, "content:create", "leads:manage", "agents:command", "knowledge:manage"];
const MANAGER: Permission[] = [
  ...MEMBER,
  "content:approve",
  "content:publish",
  "campaign:manage",
  "sales:approve",
  "brand:manage",
  "agents:configure",
  "audit:read",
];
const ADMIN: Permission[] = [
  ...MANAGER,
  "integrations:manage",
  "team:manage",
  "settings:manage",
  "approvals:policy",
  "data:export",
];
const OWNER: Permission[] = [...ADMIN, "billing:manage", "org:delete"];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  VIEWER: new Set(VIEWER),
  MEMBER: new Set(MEMBER),
  MANAGER: new Set(MANAGER),
  ADMIN: new Set(ADMIN),
  OWNER: new Set(OWNER),
};

export const ROLE_RANK: Record<Role, number> = { VIEWER: 0, MEMBER: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 };

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** A member may only assign roles strictly below their own (owners may assign any). */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === "OWNER") return true;
  return ROLE_RANK[target] < ROLE_RANK[actor];
}

export class ForbiddenError extends Error {
  constructor(public permission?: Permission) {
    super(permission ? `Missing permission: ${permission}` : "Forbidden");
    this.name = "ForbiddenError";
  }
}
