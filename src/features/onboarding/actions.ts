"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { brand } from "@/config/brand";
import { getSession } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { mapError, type ActionResult } from "@/server/action";
import { UserFacingError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { skipSetup, upsertCompany } from "@/server/onboarding/service";
import {
  analyzeWebsite,
  applyWebsite,
  buildStrategyPreview,
  finishSetup,
  saveAudience,
  saveBrand,
  saveBusiness,
  saveGoals,
  saveLogo,
  setStep,
  suggestAudience,
  websiteFindings,
  type StrategyPreview,
  type WebsiteFindings,
} from "@/server/onboarding/setup";
import { SETUP_STEPS, businessSchema, type SetupStep } from "@/lib/onboarding-setup";

async function guard<T>(name: string, body: (userId: string) => Promise<T>, limit = 120): Promise<ActionResult<T>> {
  try {
    const session = await getSession();
    if (!session) throw new UserFacingError("unauthenticated");
    await enforceRateLimit(`onboarding:${name}:${session.userId}`, limit, 60);
    return { ok: true, data: await body(session.userId) };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: "validation" };
    return mapError(err, name);
  }
}

/** The caller's organization — only its owner/admin can run the setup (tenant + role checked on every call). */
async function ownedOrg(userId: string) {
  const m = await db.organizationMember.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (!m) throw new UserFacingError("no_organization");
  if (!["OWNER", "ADMIN"].includes(m.role)) throw new UserFacingError("forbidden");
  return m.organizationId;
}

/** Step 1. The first save with a company name creates the organization (with the browser's time zone). */
export async function saveBusinessAction(input: z.input<typeof businessSchema>, timezone?: string): Promise<ActionResult<{ saved: true; created: boolean }>> {
  return guard("onboarding.business", async (userId) => {
    const member = await db.organizationMember.findFirst({ where: { userId } });
    let created = false;
    if (!member) {
      const name = z.string().trim().min(1).max(120).parse(input.companyName);
      const locale = (await cookies()).get(brand.localeCookie)?.value === "ar" ? "ar" : "en";
      let tz = "UTC";
      try {
        if (timezone) new Intl.DateTimeFormat("en", { timeZone: timezone });
        tz = timezone || "UTC";
      } catch {
        /* keep UTC */
      }
      await upsertCompany(userId, name, locale, tz);
      created = true;
    }
    await saveBusiness(await ownedOrg(userId), { userId }, input);
    return { saved: true as const, created };
  });
}

export async function saveAudienceAction(input: Parameters<typeof saveAudience>[2]): Promise<ActionResult<{ saved: true }>> {
  return guard("onboarding.audience", async (userId) => saveAudience(await ownedOrg(userId), { userId }, input));
}

export async function saveBrandAction(input: Parameters<typeof saveBrand>[2]): Promise<ActionResult<{ saved: true }>> {
  return guard("onboarding.brand", async (userId) => saveBrand(await ownedOrg(userId), { userId }, input));
}

export async function saveGoalsAction(input: Parameters<typeof saveGoals>[2]): Promise<ActionResult<{ saved: true }>> {
  return guard("onboarding.goals", async (userId) => saveGoals(await ownedOrg(userId), { userId }, input));
}

export async function uploadLogoAction(form: FormData): Promise<ActionResult<{ url: string }>> {
  return guard(
    "onboarding.logo",
    async (userId) => {
      const file = form.get("file");
      if (!(file instanceof File)) throw new UserFacingError("validation");
      return saveLogo(await ownedOrg(userId), { userId }, file);
    },
    20,
  );
}

export async function setStepAction(current: SetupStep, completed?: SetupStep): Promise<ActionResult<{ saved: true }>> {
  return guard("onboarding.step", async (userId) => {
    const step = z.enum(SETUP_STEPS);
    await setStep(await ownedOrg(userId), step.parse(current), completed ? step.parse(completed) : undefined);
    return { saved: true as const };
  });
}

export async function analyzeWebsiteAction(url: string): Promise<ActionResult<{ importId: string }>> {
  return guard("onboarding.website", async (userId) => analyzeWebsite(await ownedOrg(userId), { userId }, z.string().trim().min(3).max(300).parse(url)), 20);
}

export async function websiteFindingsAction(importId: string): Promise<ActionResult<WebsiteFindings>> {
  return guard("onboarding.website_status", async (userId) => websiteFindings(await ownedOrg(userId), z.string().min(1).max(40).parse(importId)), 240);
}

export async function applyWebsiteAction(importId: string, offeringIds: string[]): Promise<ActionResult<{ imported: Record<string, number>; offerings: string[] }>> {
  return guard("onboarding.website_apply", async (userId) =>
    applyWebsite(await ownedOrg(userId), { userId }, z.string().min(1).max(40).parse(importId), z.array(z.string().max(60)).max(100).parse(offeringIds)),
  );
}

export async function suggestAudienceAction(): Promise<ActionResult<{ painPoints: string[]; buyingTriggers: string[]; decisionMaker: string; generatedBy: string }>> {
  return guard("onboarding.suggest_audience", async (userId) => suggestAudience(await ownedOrg(userId)), 10);
}

export async function buildStrategyAction(): Promise<ActionResult<StrategyPreview>> {
  return guard("onboarding.strategy", async (userId) => buildStrategyPreview(await ownedOrg(userId), { userId }), 10);
}

/** Runs the team setup (with or without an AI provider) and returns the run to follow. */
export async function finishSetupAction(): Promise<ActionResult<{ runId: string }>> {
  return guard("onboarding.finish", async (userId) => finishSetup(await ownedOrg(userId), { userId }), 10);
}

/** The setup run failed outright: enter NOVA anyway; unfinished steps are listed in Settings to complete later. */
export async function skipSetupAction(): Promise<ActionResult<{ skipped: true }>> {
  return guard("onboarding.skip", async (userId) => {
    await skipSetup(await ownedOrg(userId));
    return { skipped: true as const };
  }, 10);
}
