import type { TenantContext } from "./context";
import { localParts } from "./reports/service";

const DAY = 86_400_000;

export type RailRow = { id: string; kind: string; title: string; subtitle?: string | null; href: string; tone: "danger" | "warning" | "info" | "success" | "neutral"; at?: string | null };

function approvalHref(a: { category: string; entityType: string | null; entityId: string | null; payload: unknown }) {
  if (a.entityType === "ContentItem" && a.entityId) return `/content/${a.entityId}`;
  if (a.entityType === "Campaign" && a.entityId) return `/campaigns/${a.entityId}`;
  const leadId = (a.payload as { leadId?: string } | null)?.leadId;
  if (a.entityType === "Message" && leadId) return `/leads/${leadId}`;
  return `/approvals?tab=${a.category}`;
}

/**
 * Home command center read model. Every number comes from the database;
 * empty workspaces simply show zeros and empty states.
 */
export async function loadCommandCenter(ctx: TenantContext) {
  const now = new Date();
  const tz = ctx.organization.timezone;
  const local = localParts(tz, now);
  // Local-day window (approximate the zone offset from the local hour).
  const utcHour = now.getUTCHours();
  const offsetHours = ((local.hour - utcHour + 36) % 24) - 12;
  const dayStart = new Date(Date.parse(`${local.date}T00:00:00.000Z`) - offsetHours * 3600_000);
  const dayEnd = new Date(dayStart.getTime() + DAY);

  const openStages = { notIn: ["WON", "LOST"] as ("WON" | "LOST")[] };
  const [
    approvalsCount,
    approvals,
    failedPubs,
    integrationIssues,
    overdue,
    activitiesToday,
    postsToday,
    activeDeals,
    awaitingFollowUp,
    deals,
    inboundConversations,
    needsHuman,
    brief,
    agentsWorking,
    connected,
  ] = await Promise.all([
    ctx.db.approval.count({ where: { status: "PENDING" } }),
    ctx.db.approval.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 3 }),
    ctx.db.socialPublication.findMany({ where: { status: "FAILED", updatedAt: { gte: new Date(now.getTime() - 7 * DAY) } }, include: { contentItem: { select: { id: true, title: true } } }, take: 3 }),
    ctx.db.integration.findMany({ where: { status: { in: ["EXPIRED", "ERROR", "ACTION_REQUIRED"] } }, take: 3 }),
    ctx.db.salesActivity.findMany({ where: { completedAt: null, dueAt: { lt: dayStart } }, include: { lead: { select: { id: true, name: true } } }, orderBy: { dueAt: "asc" }, take: 3 }),
    ctx.db.salesActivity.findMany({ where: { completedAt: null, dueAt: { gte: dayStart, lt: dayEnd } }, include: { lead: { select: { id: true, name: true, company: true } } }, orderBy: { dueAt: "asc" }, take: 5 }),
    ctx.db.contentItem.findMany({ where: { status: { in: ["SCHEDULED", "PENDING_APPROVAL"] }, scheduledAt: { gte: dayStart, lt: dayEnd } }, orderBy: { scheduledAt: "asc" }, take: 5 }),
    ctx.db.lead.count({ where: { stage: { in: ["QUALIFIED", "PROPOSAL", "NEGOTIATION"] } } }),
    ctx.db.lead.count({ where: { stage: openStages, nextActionAt: { lt: dayEnd } } }),
    ctx.db.lead.findMany({ where: { stage: { in: ["QUALIFIED", "PROPOSAL", "NEGOTIATION"] } }, orderBy: [{ temperature: "asc" }, { estimatedValueCents: "desc" }], take: 2 }),
    ctx.db.conversation.findMany({ where: { status: { not: "CLOSED" } }, orderBy: { lastMessageAt: "desc" }, take: 30, include: { lead: { select: { id: true, name: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } } }),
    ctx.db.message.count({ where: { status: "PENDING_APPROVAL" } }),
    ctx.db.report.findFirst({ where: { kind: "DAILY_BRIEF" }, orderBy: { periodStart: "desc" } }),
    ctx.db.agent.count({ where: { status: "WORKING" } }),
    ctx.db.integration.count({ where: { status: "CONNECTED" } }),
  ]);

  const unread = inboundConversations.filter((c) => c.messages[0]?.direction === "INBOUND");
  const critical = failedPubs.length + integrationIssues.length + overdue.length;

  const attention: RailRow[] = [
    ...approvals.map<RailRow>((a) => ({ id: a.id, kind: `approval:${a.category}`, title: a.title, href: approvalHref(a), tone: a.category === "PRICING" || a.category === "SALES" ? "danger" : "warning" })),
    ...failedPubs.map<RailRow>((p) => ({ id: p.id, kind: "publish_failed", title: p.contentItem.title, href: `/content/${p.contentItem.id}`, tone: "danger" })),
    ...integrationIssues.map<RailRow>((i) => ({ id: i.id, kind: "integration", title: i.provider, href: "/settings/connected-accounts", tone: "danger" })),
    ...overdue.map<RailRow>((a) => ({ id: a.id, kind: "overdue", title: a.lead.name, subtitle: a.title, href: `/leads/${a.lead.id}`, tone: "danger" })),
  ].slice(0, 3);

  const today: RailRow[] = [
    ...activitiesToday.map<RailRow>((a) => ({ id: a.id, kind: a.type === "MEETING" ? "meeting" : "followup", title: `${a.title} — ${a.lead.name}`, href: `/leads/${a.lead.id}`, tone: "info", at: a.dueAt?.toISOString() ?? null })),
    ...postsToday.map<RailRow>((p) => ({ id: p.id, kind: p.status === "PENDING_APPROVAL" ? "content_approval" : "post", title: p.title, href: `/content/${p.id}`, tone: "info", at: p.scheduledAt?.toISOString() ?? null })),
  ]
    .sort((x, y) => (x.at ?? "").localeCompare(y.at ?? ""))
    .slice(0, 3);

  const dealRows: RailRow[] = deals.map((d) => ({ id: d.id, kind: "deal", title: d.company ?? d.name, subtitle: d.nextAction ?? d.intent, href: `/leads/${d.id}`, tone: d.temperature === "HOT" ? "warning" : "info" }));

  const messageRows: RailRow[] = unread.slice(0, 2).map((c) => ({ id: c.id, kind: "message", title: c.lead?.name ?? "—", subtitle: c.messages[0]?.body.slice(0, 90) ?? null, href: c.lead ? `/leads/${c.lead.id}` : "/inbox", tone: "danger" }));

  const period = local.hour < 12 ? "morning" : local.hour < 18 ? "afternoon" : "evening";
  return {
    period: period as "morning" | "afternoon" | "evening",
    agentsWorking,
    connected,
    attention: { approvals: approvalsCount, critical, rows: attention },
    today: { rows: today },
    deals: { active: activeDeals, awaitingFollowUp, rows: dealRows },
    messages: { unread: unread.length, needsHuman, rows: messageRows },
    brief: brief ? { id: brief.id, narrative: brief.narrative, createdAt: brief.createdAt.toISOString(), offline: brief.generatedBy.includes("offline") } : null,
  };
}

export type CommandCenterData = Awaited<ReturnType<typeof loadCommandCenter>>;
