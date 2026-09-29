import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { aiAvailability } from "@/server/ai";
import { whatsappConnected } from "@/server/whatsapp/numbers";
import { TemplatesView, type TemplateRow } from "@/features/whatsapp/templates";

export const metadata: Metadata = { title: "WhatsApp · Templates" };

export default async function WhatsAppTemplates() {
  const ctx = await requireTenant({ permission: "leads:read" });
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const [rows, connected] = await Promise.all([ctx.db.whatsAppTemplate.findMany({ orderBy: { updatedAt: "desc" }, take: 200 }), whatsappConnected(scope)]);
  const data: TemplateRow[] = rows.map((r) => ({ id: r.id, name: r.name, language: r.language, category: r.category, status: r.status, header: r.header, body: r.body, footer: r.footer, buttons: (r.buttons ?? []) as TemplateRow["buttons"], variables: (r.variables ?? {}) as Record<string, string>, rejectedReason: r.rejectedReason }));
  return <TemplatesView rows={data} canManage={ctx.can("campaign:manage")} connected={connected} aiReady={aiAvailability().configured} />;
}
