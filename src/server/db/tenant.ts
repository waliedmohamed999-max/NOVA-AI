import { db } from "./client";

/**
 * Tenant isolation.
 *
 * `tenantDb(scope)` returns a Prisma client that injects the tenant scope into
 * every query on tenant-owned models:
 *  - reads / updates / deletes get `organizationId` (and `workspaceId`) added
 *    to their `where` clause, so rows from other tenants are invisible;
 *  - creates get the scope written into `data`, overriding anything supplied;
 *  - updates can never move a row to another tenant (scope keys are stripped).
 *
 * Rules for contributors:
 *  - nested writes must set `organizationId`/`workspaceId` explicitly;
 *  - raw SQL is NOT scoped — always filter by organization/workspace by hand.
 */

export type TenantScope = {
  organizationId: string;
  workspaceId: string;
};

/** Models that belong to a workspace (organizationId + workspaceId). */
export const WORKSPACE_MODELS = new Set<string>([
  "WorkspaceSettings",
  "Meeting",
  "CarouselSlide",
  "WhatsAppNumber",
  "Quote",
  "CompanyProfile",
  "Offering",
  "BrandKit",
  "BrandAsset",
  "DesignTemplate",
  "KnowledgeSource",
  "KnowledgeDocument",
  "KnowledgeChunk",
  "Agent",
  "AgentRun",
  "AgentTask",
  "Integration",
  "IntegrationAccount",
  "IntegrationCredential",
  "Campaign",
  "ContentItem",
  "ContentVersion",
  "ContentAsset",
  "ContentApproval",
  "SocialPost",
  "SocialPublication",
  "SocialMetric",
  "SocialMetricSnapshot",
  "AccountMetricSnapshot",
  "Lead",
  "LeadEvent",
  "LeadScore",
  "LeadNote",
  "LeadCaptureForm",
  "Conversation",
  "Message",
  "PipelineStage",
  "SalesOpportunity",
  "SalesActivity",
  "Approval",
  "ApprovalPolicy",
  "AiInsight",
  "Report",
]);

/** Models that belong to an organization only. */
export const ORGANIZATION_MODELS = new Set<string>([
  "OrganizationMember",
  "Invitation",
  "Workspace",
  "Subscription",
  "UsageRecord",
  "AiBudget",
  "FileObject",
  "AiRun",
  "AiUsage",
  "AuditLog",
  "DataExport",
  "Invoice",
  "Notification",
  "NotificationPreference",
  "ConversationParticipant",
]);

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

const UPDATE_OPS = new Set(["update", "updateMany", "updateManyAndReturn"]);

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

function scopeFor(model: string, scope: TenantScope): Record<string, string> | null {
  if (WORKSPACE_MODELS.has(model)) return { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  if (ORGANIZATION_MODELS.has(model)) return { organizationId: scope.organizationId };
  return null;
}

function stripScopeKeys(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const copy = { ...(data as Record<string, unknown>) };
  delete copy.organizationId;
  delete copy.workspaceId;
  return copy;
}

// Prisma's extension args are loosely typed at this level; we only touch well-known keys.
type AnyArgs = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function applyTenantScope(model: string, operation: string, args: AnyArgs, scope: TenantScope): AnyArgs {
  const s = scopeFor(model, scope);
  if (!s) return args;
  const next: AnyArgs = { ...(args ?? {}) };

  if (WHERE_OPS.has(operation)) {
    next.where = { ...(next.where ?? {}), ...s };
  }
  if (UPDATE_OPS.has(operation)) {
    next.data = stripScopeKeys(next.data);
  }
  if (operation === "create") {
    next.data = { ...(next.data ?? {}), ...s };
  }
  if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(next.data) ? next.data : [next.data];
    next.data = rows.map((row: AnyArgs) => ({ ...row, ...s }));
  }
  if (operation === "upsert") {
    next.where = { ...(next.where ?? {}), ...s };
    next.create = { ...(next.create ?? {}), ...s };
    next.update = stripScopeKeys(next.update);
  }
  return next;
}

export function tenantDb(scope: TenantScope) {
  if (!scope.organizationId || !scope.workspaceId) {
    throw new TenantScopeError("tenantDb requires organizationId and workspaceId");
  }
  return db.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(applyTenantScope(model, operation, args as AnyArgs, scope));
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantDb>;
