import type { TenantContext } from "./context";
import { collectBriefData, localParts } from "./reports/service";

export type PriorityItem = {
  key: "approvals" | "followups" | "hot_leads" | "performance" | "opportunity" | "meetings" | "integrations" | "failed_publishing" | "setup_knowledge" | "connect_accounts";
  count?: number;
  value?: number;
  tone: "accent" | "info" | "success" | "warning" | "danger" | "neutral";
  href: string;
  title?: string;
};

/** "What needs my attention today?" — ranked, factual, and short. */
export async function loadHome(ctx: TenantContext) {
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const [data, brief, agents, integrations, knowledgeCount, opportunity] = await Promise.all([
    collectBriefData(scope),
    ctx.db.report.findFirst({ where: { kind: "DAILY_BRIEF" }, orderBy: { periodStart: "desc" } }),
    ctx.db.agent.findMany({ orderBy: { createdAt: "asc" } }),
    ctx.db.integration.count({ where: { status: "CONNECTED" } }),
    ctx.db.knowledgeSource.count({ where: { status: "READY" } }),
    ctx.db.aiInsight.findFirst({ where: { status: "ACTIVE", kind: { in: ["recommendation", "learning"] } }, orderBy: { createdAt: "desc" } }),
  ]);

  const items: PriorityItem[] = [];
  if (data.awaitingApproval) items.push({ key: "approvals", count: data.awaitingApproval, tone: "accent", href: "/content?view=approval" });
  if (data.followUpsDue) items.push({ key: "followups", count: data.followUpsDue, tone: "warning", href: "/sales?view=followups" });
  if (data.hotLeads.length) items.push({ key: "hot_leads", count: data.hotLeads.length, tone: "accent", href: "/leads?temperature=HOT" });
  if (data.engagementChange != null && Math.abs(data.engagementChange) >= 0.05)
    items.push({ key: "performance", value: data.engagementChange, tone: data.engagementChange > 0 ? "success" : "warning", href: "/analytics" });
  if (opportunity) items.push({ key: "opportunity", tone: "info", href: "/analytics", title: opportunity.title });
  if (data.meetingsUpcoming) items.push({ key: "meetings", count: data.meetingsUpcoming, tone: "success", href: "/sales" });
  if (data.attention.integrations) items.push({ key: "integrations", count: data.attention.integrations, tone: "danger", href: "/integrations" });
  if (data.attention.failedPublications) items.push({ key: "failed_publishing", count: data.attention.failedPublications, tone: "danger", href: "/content?view=scheduled" });
  if (integrations === 0) items.push({ key: "connect_accounts", tone: "neutral", href: "/integrations" });
  if (knowledgeCount < 2) items.push({ key: "setup_knowledge", tone: "neutral", href: "/knowledge" });

  const local = localParts(ctx.organization.timezone);
  const period = local.hour < 12 ? "morning" : local.hour < 18 ? "afternoon" : "evening";
  return { data, brief, agents, items, period, actionable: items.filter((i) => !["connect_accounts", "setup_knowledge"].includes(i.key)).length };
}
