"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { brand } from "@/config/brand";
import { getSession } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { mapError, type ActionResult } from "@/server/action";
import { UserFacingError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { beginAnalysis, loadOnboarding, mergeAnswers, setWebsite, upsertCompany, type OnboardingSnapshot } from "@/server/onboarding/service";

async function guard<T>(name: string, body: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const session = await getSession();
    if (!session) throw new UserFacingError("unauthenticated");
    await enforceRateLimit(`onboarding:${session.userId}`, 90, 60);
    return { ok: true, data: await body(session.userId) };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: "validation" };
    if (err instanceof TypeError && /URL/i.test(err.message)) return { ok: false, error: "website_unreachable" };
    return mapError(err, name);
  }
}

async function ownedOrg(userId: string) {
  const m = await db.organizationMember.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (!m) throw new UserFacingError("no_organization");
  if (!["OWNER", "ADMIN"].includes(m.role)) throw new UserFacingError("forbidden");
  return m.organizationId;
}

export async function getOnboardingState(): Promise<ActionResult<OnboardingSnapshot>> {
  return guard("onboarding.state", (userId) => loadOnboarding(userId));
}

export async function saveCompanyName(name: string, timezone: string): Promise<ActionResult<{ id: string }>> {
  return guard("onboarding.company", async (userId) => {
    const clean = z.string().trim().min(1).max(120).parse(name);
    const locale = (await cookies()).get(brand.localeCookie)?.value === "ar" ? "ar" : "en";
    let tz = "UTC";
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      tz = timezone;
    } catch {
      /* keep UTC */
    }
    const id = await upsertCompany(userId, clean, locale, tz);
    await mergeAnswers(id, { step: 2 });
    return { id };
  });
}

export async function saveWebsite(url: string | null): Promise<ActionResult<{ url: string | null }>> {
  return guard("onboarding.website", async (userId) => {
    const orgId = await ownedOrg(userId);
    if (!url) {
      await mergeAnswers(orgId, { website: null, step: 3 });
      return { url: null };
    }
    const saved = await setWebsite(orgId, z.string().trim().min(3).max(300).parse(url));
    await mergeAnswers(orgId, { step: 3 });
    return { url: saved };
  });
}

const patchSchema = z
  .object({
    description: z.string().trim().max(2000),
    sells: z.string().trim().max(500),
    offerings: z.array(z.string().trim().min(1).max(120)).max(12),
    customers: z.string().trim().max(1000),
    customerType: z.enum(["B2B", "B2C", "BOTH"]),
    markets: z.string().trim().max(200),
    tone: z.array(z.string().trim().max(40)).max(8),
    colors: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)).max(6),
    goals: z.array(z.string().max(60)).max(6),
    step: z.number().int().min(0).max(12),
  })
  .partial();

export async function saveAnswers(patch: z.input<typeof patchSchema>): Promise<ActionResult<{ saved: true }>> {
  return guard("onboarding.answers", async (userId) => {
    await mergeAnswers(await ownedOrg(userId), patchSchema.parse(patch));
    return { saved: true as const };
  });
}

export async function startOnboardingAnalysis(): Promise<ActionResult<{ runId: string }>> {
  // Runs with or without an AI provider: without one the workflow builds the profile from the owner's answers.
  return guard("onboarding.analyze", async (userId) => {
    return { runId: await beginAnalysis(await ownedOrg(userId), userId) };
  });
}
