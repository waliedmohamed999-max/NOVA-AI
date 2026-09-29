import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/context";
import { db } from "@/server/db/client";
import { aiAvailability } from "@/server/ai";
import { loadSetup } from "@/server/onboarding/setup";
import { SetupExperience } from "@/features/onboarding/setup/setup";
import type { SetupInit } from "@/features/onboarding/setup/state";
import { signupConfig } from "@/server/whatsapp/cloud-api";
import { numberFor, whatsappConnected } from "@/server/whatsapp/numbers";
import { loadWhatsAppSettings } from "@/server/whatsapp/settings";

export const metadata: Metadata = { title: "Set up your AI team" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const member = await db.organizationMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  const userName = user.name ?? user.email.split("@")[0];
  const aiConfigured = aiAvailability().configured;
  let init: SetupInit;
  let unread: number | null = null;
  let channels: SetupInit["channels"] = { instagram: false, facebook: false, linkedin: false, email: false, whatsapp: { connected: false, display: null }, whatsappGoals: [], signup: signupConfig() };
  if (member) {
    const snap = await loadSetup(member.organizationId);
    if (snap.status === "COMPLETED") redirect("/home");
    unread = await db.notification.count({ where: { userId: user.id, readAt: null } });
    const ws = await db.workspace.findFirstOrThrow({ where: { organizationId: member.organizationId, isDefault: true }, select: { id: true } });
    const scope = { organizationId: member.organizationId, workspaceId: ws.id };
    const [ints, waNumber, waLive, waSettings] = await Promise.all([
      db.integration.findMany({ where: { ...scope, status: "CONNECTED" }, select: { provider: true } }),
      numberFor(scope),
      whatsappConnected(scope),
      loadWhatsAppSettings(scope),
    ]);
    const has = (p: string) => ints.some((i) => i.provider === p);
    channels = { instagram: has("INSTAGRAM"), facebook: has("FACEBOOK"), linkedin: has("LINKEDIN"), email: has("GOOGLE") || has("MICROSOFT"), whatsapp: { connected: waLive, display: waNumber?.displayPhone ?? null }, whatsappGoals: waSettings.goals, signup: signupConfig() };
    init = {
      userName,
      hasOrg: true,
      companyName: snap.companyName,
      answers: snap.answers,
      logoUrl: snap.logoUrl,
      strategy: snap.strategy,
      websiteImport: snap.websiteImport,
      websiteSource: snap.websiteSource,
      brandPrefilled: snap.brandPrefilled,
      aiConfigured,
      channels,
    };
  } else {
    init = { userName, hasOrg: false, companyName: "", answers: {}, logoUrl: null, strategy: null, websiteImport: null, websiteSource: null, brandPrefilled: false, aiConfigured, channels };
  }
  return <SetupExperience init={init} user={{ name: user.name, email: user.email, isPlatformAdmin: user.isPlatformAdmin }} unread={unread} />;
}
