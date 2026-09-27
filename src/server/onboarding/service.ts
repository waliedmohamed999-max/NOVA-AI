import { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import { provisionOrganization } from "../tenancy/provision";
import { addKnowledgeSource, type WebsiteSignals } from "../knowledge/service";
import { normalizeUrl } from "../net/safe-fetch";
import { startRun } from "../agents/runtime";
import { ONBOARDING_STEPS } from "../agents/workflows/onboarding";
import type { OnboardingAnswers } from "../agents/offline-content";

export type OnboardingSnapshot = {
  organizationId: string | null;
  companyName: string | null;
  answers: OnboardingAnswers & { step?: number; runId?: string };
  status: string;
  signals: WebsiteSignals | null;
  websiteStatus: string | null;
};

export async function loadOnboarding(userId: string): Promise<OnboardingSnapshot> {
  const member = await db.organizationMember.findFirst({ where: { userId }, include: { organization: true }, orderBy: { createdAt: "asc" } });
  if (!member) return { organizationId: null, companyName: null, answers: {}, status: "NOT_STARTED", signals: null, websiteStatus: null };
  const org = member.organization;
  const site = await db.knowledgeSource.findFirst({ where: { organizationId: org.id, type: "WEBSITE" }, orderBy: { createdAt: "desc" } });
  return {
    organizationId: org.id,
    companyName: org.name,
    answers: (org.onboardingData ?? {}) as OnboardingSnapshot["answers"],
    status: org.onboardingStatus,
    signals: ((site?.metadata as { signals?: WebsiteSignals } | null)?.signals ?? null) as WebsiteSignals | null,
    websiteStatus: site?.status ?? null,
  };
}

/** Creates the company the first time; later calls just rename it. */
export async function upsertCompany(userId: string, name: string, locale: string, timezone: string) {
  const member = await db.organizationMember.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (member) {
    await db.organization.update({ where: { id: member.organizationId }, data: { name } });
    await db.companyProfile.updateMany({ where: { organizationId: member.organizationId }, data: { name } });
    return member.organizationId;
  }
  const { organization } = await provisionOrganization({ userId, name, locale, timezone });
  return organization.id;
}

async function scopeFor(organizationId: string) {
  const ws = await db.workspace.findFirstOrThrow({ where: { organizationId, isDefault: true } });
  return { organizationId, workspaceId: ws.id };
}

export async function mergeAnswers(organizationId: string, patch: Record<string, unknown>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const next = { ...((org.onboardingData ?? {}) as object), ...patch };
  await db.organization.update({ where: { id: organizationId }, data: { onboardingData: next as Prisma.InputJsonValue } });
  return next;
}

/** Saves the website and starts reading it in the background (once per URL). */
export async function setWebsite(organizationId: string, raw: string) {
  const url = normalizeUrl(raw).toString();
  const scope = await scopeFor(organizationId);
  await db.organization.update({ where: { id: organizationId }, data: { website: url } });
  await db.companyProfile.updateMany({ where: scope, data: { website: url } });
  await mergeAnswers(organizationId, { website: url });
  const existing = await db.knowledgeSource.findFirst({ where: { ...scope, type: "WEBSITE", url } });
  if (!existing) await addKnowledgeSource(scope, { type: "WEBSITE", title: new URL(url).hostname, url });
  return url;
}

export async function beginAnalysis(organizationId: string, userId: string) {
  const scope = await scopeFor(organizationId);
  const answers = (await db.organization.findUniqueOrThrow({ where: { id: organizationId } })).onboardingData as { colors?: string[] };
  if (answers?.colors?.length) await db.brandKit.updateMany({ where: scope, data: { primaryColors: answers.colors.slice(0, 3) } });
  await db.organization.update({ where: { id: organizationId }, data: { onboardingStatus: "ANALYZING" } });
  const run = await startRun(scope, { kind: "onboarding_analysis", agent: "SOCIAL_MANAGER", steps: ONBOARDING_STEPS, requestedById: userId });
  await mergeAnswers(organizationId, { runId: run.id });
  return run.id;
}

export async function loadDiscoveries(organizationId: string) {
  const scope = await scopeFor(organizationId);
  const [profile, kit, offerings] = await Promise.all([
    db.companyProfile.findFirst({ where: scope }),
    db.brandKit.findFirst({ where: scope }),
    db.offering.findMany({ where: scope, take: 6 }),
  ]);
  return { profile, kit, offerings };
}
