import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { followupCenter } from "@/server/whatsapp/followups";
import { FollowupsView } from "@/features/whatsapp/followups";

export const metadata: Metadata = { title: "WhatsApp · Follow-ups" };

export default async function WhatsAppFollowups() {
  const ctx = await requireTenant({ permission: "leads:read" });
  const data = await followupCenter({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id });
  return <FollowupsView data={data} canSend={ctx.can("leads:manage")} />;
}
