import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/context";
import { db } from "@/server/db/client";
import { loadOnboarding } from "@/server/onboarding/service";
import { OnboardingFlow } from "@/features/onboarding/flow";

export const metadata: Metadata = { title: "Set up your AI team" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const snap = await loadOnboarding(user.id);
  if (snap.status === "COMPLETED") redirect("/onboarding/ready");
  const connectedCount = snap.organizationId ? await db.integration.count({ where: { organizationId: snap.organizationId, status: "CONNECTED" } }) : 0;
  return <OnboardingFlow userName={user.name ?? user.email.split("@")[0]} initial={snap} connectedCount={connectedCount} />;
}
