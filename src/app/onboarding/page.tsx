import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/context";
import { loadOnboarding } from "@/server/onboarding/service";
import { INTEGRATION_CATALOG, SOCIAL_PROVIDERS } from "@/server/integrations/registry";
import { OnboardingFlow } from "@/features/onboarding/flow";

export const metadata: Metadata = { title: "Set up your AI team" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const snap = await loadOnboarding(user.id);
  if (snap.status === "COMPLETED") redirect("/onboarding/ready");
  const providers = INTEGRATION_CATALOG.filter((c) => c.stage === "available" && c.oauth).map((c) => ({
    provider: c.provider,
    oauth: c.oauth!,
    configured: SOCIAL_PROVIDERS[c.oauth!].isConfigured(),
  }));
  return <OnboardingFlow userName={user.name ?? user.email.split("@")[0]} initial={snap} providers={providers} />;
}
