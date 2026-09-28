import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/context";
import { LeadDetail } from "@/features/sales/lead-detail";
import { stageLabels } from "@/server/sales/queries";
import { channelFor } from "@/server/sales/channels";
import { calendarConnected } from "@/server/calendar/service";
import { leadDrawer, teamMembers } from "@/server/sales/desk";
import { aiAvailability } from "@/server/ai";
import { DeskProvider } from "@/features/sales/desk/shell";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage(props: PageProps<"/leads/[id]">) {
  const { id } = await props.params;
  const ctx = await requireTenant({ permission: "leads:read" });
  const lead = await ctx.db.lead.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 100 },
      notes: { orderBy: { createdAt: "desc" }, take: 20 },
      activities: { where: { completedAt: null }, orderBy: { dueAt: "asc" } },
      campaign: { select: { id: true, name: true } },
      conversations: { include: { messages: { orderBy: { createdAt: "asc" }, take: 50 } }, orderBy: { lastMessageAt: "desc" }, take: 3 },
    },
  });
  if (!lead) notFound();
  const labels = await stageLabels(ctx);
  const messages = lead.conversations.flatMap((c) => c.messages.map((m) => ({ id: m.id, direction: m.direction, body: m.body, status: m.status, aiDrafted: m.aiDrafted, at: m.createdAt.toISOString(), channel: c.channel })));
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  let sendable = false;
  for (const c of lead.conversations) {
    const needs = c.channel === "WHATSAPP" ? lead.phone : lead.email;
    if (needs && (await channelFor(c.channel)?.isConfigured(scope))) sendable = true;
  }

  const [calendar, meetings, profile, members] = await Promise.all([
    calendarConnected(scope),
    ctx.db.meeting.findMany({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    leadDrawer(ctx, lead.id),
    teamMembers(ctx),
  ]);
  if (!profile) notFound();

  return (
    <DeskProvider currency={lead.currency} members={members} stages={profile.stages} canManage={ctx.can("leads:manage")} aiReady={aiAvailability().configured}>
    <LeadDetail
      lead={{
        id: lead.id,
        name: lead.name,
        company: lead.company,
        email: lead.email,
        phone: lead.phone,
        stage: lead.stage,
        temperature: lead.temperature,
        score: lead.score,
        valueCents: lead.estimatedValueCents,
        currency: lead.currency,
        source: lead.source,
        channel: lead.channel,
        intent: lead.intent,
        summary: lead.summary,
        objections: lead.objections,
        interests: lead.interests,
        tags: lead.tags,
        nextAction: lead.nextAction,
        nextActionAt: lead.nextActionAt?.toISOString() ?? null,
        campaign: lead.campaign,
        createdAt: lead.createdAt.toISOString(),
        value: profile.value,
        owner: profile.owner,
        reasons: profile.reasons,
        signals: profile.signals,
        attribution: { utmSource: lead.utmSource, medium: lead.medium, utmCampaign: lead.utmCampaign, utmContent: lead.utmContent, landingUrl: lead.landingUrl, socialPostId: lead.socialPostId },
      }}
      opportunities={profile.opportunities}
      quotes={profile.quotes}
      events={lead.events.map((e) => ({ id: e.id, type: e.type, title: e.title, body: e.body, actorType: e.actorType, at: e.createdAt.toISOString() }))}
      messages={messages}
      activities={lead.activities.map((a) => ({ id: a.id, title: a.title, type: a.type, lead: { id: lead.id, name: lead.name, company: lead.company }, dueAt: a.dueAt?.toISOString() ?? null, byAgent: Boolean(a.createdByAgent) }))}
      stageLabels={labels}
      canManage={ctx.can("leads:manage")}
      sendable={sendable}
      calendar={calendar}
      meetings={meetings.map((m) => ({ id: m.id, status: m.status, title: m.title, startAt: m.startAt?.toISOString() ?? null, slots: (m.proposedSlots as { start: string }[]).map((s) => s.start), timezone: m.timezone, joinUrl: m.joinUrl }))}
    />
    </DeskProvider>
  );
}
