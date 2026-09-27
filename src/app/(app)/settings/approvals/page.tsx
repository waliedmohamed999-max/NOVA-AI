import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { DEFAULT_APPROVAL_POLICIES } from "@/server/tenancy/provision";
import { ApprovalRules } from "@/features/settings/sections";

export const metadata: Metadata = { title: "Approval rules" };

export default async function ApprovalRulesPage() {
  const ctx = await requireTenant();
  const rows = await ctx.db.approvalPolicy.findMany();
  const policies = DEFAULT_APPROVAL_POLICIES.map((action) => ({ action, requiresApproval: rows.find((r) => r.action === action)?.requiresApproval ?? action !== "send_message" }));
  return <ApprovalRules policies={policies} canEdit={ctx.can("approvals:policy")} />;
}
