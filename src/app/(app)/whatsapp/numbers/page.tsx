import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { connectionHealth } from "@/server/whatsapp/settings";
import { signupConfig } from "@/server/whatsapp/cloud-api";
import { NumbersView } from "@/features/whatsapp/numbers";

export const metadata: Metadata = { title: "WhatsApp · Numbers" };

export default async function WhatsAppNumbers() {
  const ctx = await requireTenant({ permission: "leads:read" });
  const health = await connectionHealth({ organizationId: ctx.organization.id, workspaceId: ctx.workspace.id }, false);
  return <NumbersView health={health} signup={signupConfig()} canManage={ctx.can("integrations:manage")} />;
}
