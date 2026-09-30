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

/** Steps of the team setup that failed and were skipped so the owner could enter NOVA (shown in Settings). */
export function setupIncomplete(onboardingData: unknown): string[] {
  const v = (onboardingData as { setupIncomplete?: unknown } | null)?.setupIncomplete;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && ONBOARDING_STEPS.includes(x)) : [];
}

/** Re-runs the team setup from Settings. The workspace stays usable (status is not reset to ANALYZING). */
export async function retrySetup(organizationId: string, userId: string) {
  const scope = await scopeFor(organizationId);
  const run = await startRun(scope, { kind: "onboarding_analysis", agent: "SOCIAL_MANAGER", steps: ONBOARDING_STEPS, requestedById: userId });
  await mergeAnswers(organizationId, { runId: run.id });
  return run.id;
}

/**
 * Escape hatch when the setup run itself failed (not just a step): let the owner in and record every step that
 * didn't finish as incomplete, to be completed from Settings.
 */
export async function skipSetup(organizationId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  if (org.onboardingStatus === "COMPLETED") return;
  const runId = (org.onboardingData as { runId?: string } | null)?.runId;
  const run = runId ? await db.agentRun.findFirst({ where: { id: runId, organizationId } }) : null;
  const done = new Set(((run?.steps ?? []) as { key: string; status: string }[]).filter((s) => s.status === "done").map((s) => s.key));
  const incomplete = ONBOARDING_STEPS.filter((k) => k !== "preparing_team" && !done.has(k));
  await db.organization.update({
    where: { id: organizationId },
    data: { onboardingStatus: "COMPLETED", onboardingData: { ...((org.onboardingData ?? {}) as object), setupIncomplete: incomplete } as Prisma.InputJsonValue },
  });
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
