import type { Metadata } from "next";
import { requireTenant } from "@/server/context";
import { connectionHealth, listSuppressions, loadWhatsAppSettings } from "@/server/whatsapp/settings";
import { SettingsView } from "@/features/whatsapp/settings";

export const metadata: Metadata = { title: "WhatsApp · Settings" };

export default async function WhatsAppSettings() {
  const ctx = await requireTenant({ permission: "leads:read" });
  const scope = { organizationId: ctx.organization.id, workspaceId: ctx.workspace.id };
  const admin = ctx.user.isPlatformAdmin;
  const [s, suppressions, health] = await Promise.all([loadWhatsAppSettings(scope), listSuppressions(scope), connectionHealth(scope, admin)]);
  return <SettingsView initial={{ level: s.level, safeIntents: s.safeIntents, optOutKeywords: s.optOutKeywords, requireConsent: s.requireConsent }} suppressions={suppressions} health={health} canManage={ctx.can("settings:manage")} isAdmin={admin} />;
}
