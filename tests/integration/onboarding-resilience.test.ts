import { describe, expect, it, vi } from "vitest";

// An AI provider that is configured but fails on every call (bad key, outage, quota).
vi.mock("@/server/ai", async (original) => {
  const actual = await original<typeof import("@/server/ai")>();
  return {
    ...actual,
    aiAvailability: () => ({ ...actual.aiAvailability(), configured: true }),
    aiStructured: async () => {
      throw new actual.AiError("ai_failed", "provider down");
    },
  };
});

import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { executeRun } from "@/server/agents/runtime";
import "@/server/agents/jobs";
import { finishSetup, saveAudience, saveBrand, saveBusiness, saveGoals } from "@/server/onboarding/setup";
import { retrySetup, setupIncomplete, skipSetup } from "@/server/onboarding/service";

const actor = (t: Awaited<ReturnType<typeof makeTenant>>) => ({ userId: t.user.id });

async function answered(name: string) {
  const t = await makeTenant(name);
  const org = t.organization.id;
  await saveBusiness(org, actor(t), { industry: "Food & restaurants", businessType: "PRODUCTS", customerType: "B2C", description: "Artisan bakery." });
  await saveAudience(org, actor(t), { customers: "Families", locations: "Cairo" });
  await saveBrand(org, actor(t), { tones: ["warm"] });
  await saveGoals(org, actor(t), { goals: ["sales"] });
  return t;
}

/** A failing setup step never blocks entering NOVA; what was skipped is recorded for Settings. */
describe("team setup resilience", () => {
  it("skips a failing step, completes the run and records it as incomplete", async () => {
    const t = await answered("Resilient Co");
    const org = t.organization.id;
    const { runId } = await finishSetup(org, actor(t));
    await executeRun(t.scope, runId);

    const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("COMPLETED");
    const steps = run.steps as { key: string; status: string }[];
    expect(steps.find((s) => s.key === "analyzing_brand")?.status).toBe("incomplete");
    expect(steps.find((s) => s.key === "preparing_team")?.status).toBe("done");

    const after = await db.organization.findUniqueOrThrow({ where: { id: org } });
    expect(after.onboardingStatus).toBe("COMPLETED");
    expect(setupIncomplete(after.onboardingData)).toEqual(["analyzing_brand"]);
    // The profile was still built, from the owner's answers.
    expect((await db.companyProfile.findFirstOrThrow({ where: t.scope })).summary).toBeTruthy();
  });

  it("retrying from Settings keeps the workspace usable", async () => {
    const t = await answered("Retry Co");
    const org = t.organization.id;
    const { runId } = await finishSetup(org, actor(t));
    await executeRun(t.scope, runId);
    const again = await retrySetup(org, t.user.id);
    expect((await db.organization.findUniqueOrThrow({ where: { id: org } })).onboardingStatus).toBe("COMPLETED");
    await executeRun(t.scope, again);
    expect((await db.agentRun.findUniqueOrThrow({ where: { id: again } })).status).toBe("COMPLETED");
  });

  it("skipSetup lets the owner in when the run itself never finished", async () => {
    const t = await answered("Skip Co");
    const org = t.organization.id;
    await finishSetup(org, actor(t)); // queued, never executed
    await skipSetup(org);
    const after = await db.organization.findUniqueOrThrow({ where: { id: org } });
    expect(after.onboardingStatus).toBe("COMPLETED");
    expect(setupIncomplete(after.onboardingData)).toEqual(["understanding_business", "analyzing_brand", "building_audience", "reviewing_services", "creating_strategy"]);
  });
});
