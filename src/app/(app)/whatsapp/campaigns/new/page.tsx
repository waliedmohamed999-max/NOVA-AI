import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireTenant } from "@/server/context";
import { whatsappConnected } from "@/server/whatsapp/numbers";
import type { Audience } from "@/server/whatsapp/campaigns";
import { CampaignWizard, type WizardInit } from "@/features/whatsapp/campaign-wizard";

export const metadata: Metadata = { title: "WhatsApp · New campaign" };

export default async function NewWhatsAppCampaign(props: PageProps<"/whatsapp/campaigns/new">) {
  const ctx = await requireTenant({ permission: "campaign:manage" });
  const sp = await props.searchParams;
  const id = typeof sp.id === "string" ? sp.id : null;
  const [templates, segments, connected, existing] = await Promise.all([
    ctx.db.whatsAppTemplate.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" }, select: { id: true, name: true, language: true, body: true, variables: true } }),
    ctx.db.customerSegment.findMany({ where: { status: { in: ["approved", "suggested"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    whatsappConnected({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }),
    id ? ctx.db.campaign.findUnique({ where: { id } }) : Promise.resolve(null),
  ]);
  if (existing && (existing.channel !== "whatsapp" || existing.waState !== "DRAFT")) redirect(`/whatsapp/campaigns/${existing.id}`);
  const init: WizardInit = existing
    ? { id: existing.id, name: existing.name, objective: existing.objective as WizardInit["objective"], templateId: existing.waTemplateId, audience: (existing.waAudience ?? {}) as Audience, variables: (existing.waVariables ?? {}) as Record<string, string>, scheduledAt: existing.scheduledAt?.toISOString() ?? null }
    : { name: "", objective: "offer", templateId: null, audience: {}, variables: {}, scheduledAt: null };
  return <CampaignWizard init={init} templates={templates.map((x) => ({ ...x, variables: (x.variables ?? {}) as Record<string, string> }))} segments={segments} connected={connected} />;
}
