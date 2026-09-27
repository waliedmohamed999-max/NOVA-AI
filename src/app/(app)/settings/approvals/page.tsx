import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { DEFAULT_APPROVAL_POLICIES } from "@/server/tenancy/provision";
import { ApprovalRules } from "@/features/settings/sections";
import { BusinessPolicies } from "@/features/settings/policies";
import { loadPolicies, LOCKED_SALES_TOPICS } from "@/server/approvals/policies";

export const metadata: Metadata = { title: "Approval rules" };

export default async function ApprovalRulesPage() {
  const ctx = await requireTenant();
  const rows = await ctx.db.approvalPolicy.findMany();
  const locked = new Set<string>(LOCKED_SALES_TOPICS);
  const policies = DEFAULT_APPROVAL_POLICIES.filter((a) => a !== "send_message" && a !== "publish_content").map((action) => ({
    action,
    locked: locked.has(action),
    requiresApproval: locked.has(action) || (rows.find((r) => r.action === action)?.requiresApproval ?? true),
  }));
  const business = await loadPolicies({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
  const salesAutoReply = rows.find((r) => r.action === "send_message")?.requiresApproval === false;
  const canEdit = ctx.can("approvals:policy");
  return (
    <div className="space-y-6">
      <BusinessPolicies initial={business} salesAutoReply={salesAutoReply} canEdit={canEdit} />
      <ApprovalRules policies={policies} canEdit={canEdit} />
    </div>
  );
}
