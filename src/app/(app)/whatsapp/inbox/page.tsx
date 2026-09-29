import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { listConversations } from "@/server/whatsapp/inbox";
import { WhatsAppInbox } from "@/features/whatsapp/inbox";

export const metadata: Metadata = { title: "WhatsApp · Conversations" };

export default async function WhatsAppInboxPage(props: PageProps<"/whatsapp/inbox">) {
  const ctx = await requireTenant({ permission: "leads:read" });
  const sp = await props.searchParams;
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const [initial, templates] = await Promise.all([
    listConversations(scope, { filter: "all" }),
    ctx.db.whatsAppTemplate.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" }, select: { id: true, name: true, language: true, body: true } }),
  ]);
  const selected = typeof sp.c === "string" ? sp.c : null;
  return <WhatsAppInbox initial={initial} initialSelected={selected} templates={templates} canSend={ctx.can("leads:manage")} />;
}
