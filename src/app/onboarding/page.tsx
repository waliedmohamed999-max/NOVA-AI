import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/context";
import { db } from "@/server/db/client";
import { aiAvailability } from "@/server/ai";
import { loadSetup } from "@/server/onboarding/setup";
import { SetupExperience } from "@/features/onboarding/setup/setup";
import type { SetupInit } from "@/features/onboarding/setup/state";

export const metadata: Metadata = { title: "Set up your AI team" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const member = await db.organizationMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  const userName = user.name ?? user.email.split("@")[0];
  const aiConfigured = aiAvailability().configured;
  let init: SetupInit;
  let unread: number | null = null;
  if (member) {
    const snap = await loadSetup(member.organizationId);
    if (snap.status === "COMPLETED") redirect("/home");
    unread = await db.notification.count({ where: { userId: user.id, readAt: null } });
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
    };
  } else {
    init = { userName, hasOrg: false, companyName: "", answers: {}, logoUrl: null, strategy: null, websiteImport: null, websiteSource: null, brandPrefilled: false, aiConfigured };
  }
  return <SetupExperience init={init} user={{ name: user.name, email: user.email, isPlatformAdmin: user.isPlatformAdmin }} unread={unread} />;
}
