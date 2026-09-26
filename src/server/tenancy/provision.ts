import { db } from "../db/client";
import { AGENTS, AGENT_DEFAULT_NAMES } from "@/config/agents";
import { PLANS } from "@/config/plans";
import { audit } from "../audit";
import type { LeadStage } from "@/generated/prisma/enums";

export const DEFAULT_PIPELINE: { stage: LeadStage; en: string; ar: string; probability: number }[] = [
  { stage: "NEW", en: "New", ar: "جديد", probability: 5 },
  { stage: "CONTACTED", en: "Contacted", ar: "تم التواصل", probability: 15 },
  { stage: "QUALIFIED", en: "Qualified", ar: "مؤهل", probability: 35 },
  { stage: "PROPOSAL", en: "Proposal", ar: "عرض سعر", probability: 55 },
  { stage: "NEGOTIATION", en: "Negotiation", ar: "تفاوض", probability: 75 },
  { stage: "WON", en: "Won", ar: "تم الفوز", probability: 100 },
  { stage: "LOST", en: "Lost", ar: "خسارة", probability: 0 },
];

/** Sensitive sales actions that always require human approval by default. */
export const DEFAULT_APPROVAL_POLICIES = [
  "discount",
  "custom_pricing",
  "contract_promise",
  "refund",
  "legal_commitment",
  "unusual_delivery",
  "send_message",
  "publish_content",
] as const;

export const DEFAULT_TEMPLATES = [
  { name: "Square post", format: "SQUARE", spec: { width: 1080, height: 1080, zones: ["headline", "body", "logo"] } },
  { name: "Portrait post", format: "PORTRAIT", spec: { width: 1080, height: 1350, zones: ["headline", "body", "cta", "logo"] } },
  { name: "Story", format: "STORY", spec: { width: 1080, height: 1920, safeArea: { top: 250, bottom: 340 }, zones: ["headline", "cta"] } },
  { name: "Carousel slide", format: "CAROUSEL", spec: { width: 1080, height: 1350, slides: { min: 3, max: 10 }, zones: ["kicker", "headline", "body"] } },
  { name: "LinkedIn post", format: "LINKEDIN", spec: { width: 1200, height: 627, zones: ["headline", "body", "logo"] } },
] as const;

function slugify(name: string) {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "company";
}

async function uniqueSlug(name: string) {
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!(await db.organization.findUnique({ where: { slug } }))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export type ProvisionInput = {
  userId: string;
  name: string;
  locale?: string;
  timezone?: string;
  website?: string | null;
  isDemo?: boolean;
};

/**
 * Creates an organization with everything a new AI Growth Team needs:
 * owner membership, default workspace, settings, trial subscription, AI budget,
 * the six agents, pipeline stages, approval policies, company brain shell,
 * brand kit and design templates.
 */
export async function provisionOrganization(input: ProvisionInput) {
  const slug = await uniqueSlug(input.name);
  const locale = input.locale === "ar" ? "ar" : "en";
  const plan = PLANS.STARTER;

  return db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: input.name,
        slug,
        locale,
        timezone: input.timezone ?? "UTC",
        website: input.website ?? null,
        isDemo: input.isDemo ?? false,
        onboardingStatus: "IN_PROGRESS",
      },
    });
    const organizationId = org.id;
    await tx.organizationMember.create({ data: { organizationId, userId: input.userId, role: "OWNER" } });
    const ws = await tx.workspace.create({ data: { organizationId, name: input.name, slug: "main", isDefault: true } });
    const workspaceId = ws.id;
    const scope = { organizationId, workspaceId };

    await tx.workspaceSettings.create({ data: { ...scope, timezone: input.timezone ?? "UTC" } });
    await tx.subscription.create({
      data: { organizationId, plan: plan.tier, status: "TRIALING", trialEndsAt: new Date(Date.now() + 14 * 86_400_000) },
    });
    await tx.aiBudget.create({ data: { organizationId, monthlyAllowanceMicro: plan.aiMonthlyAllowanceMicro } });

    await tx.agent.createMany({
      data: AGENTS.map((a) => ({
        ...scope,
        key: a.key,
        name: AGENT_DEFAULT_NAMES[a.key][locale],
        status: "IDLE" as const,
        enabled: (plan.agents as readonly string[]).includes(a.key),
      })),
    });
    await tx.pipelineStage.createMany({
      data: DEFAULT_PIPELINE.map((s, i) => ({ ...scope, stage: s.stage, label: s[locale], position: i, probability: s.probability })),
    });
    await tx.approvalPolicy.createMany({
      data: DEFAULT_APPROVAL_POLICIES.map((action) => ({ ...scope, action, requiresApproval: true })),
    });
    await tx.companyProfile.create({ data: { ...scope, name: input.name, website: input.website ?? null } });
    await tx.brandKit.create({ data: { ...scope } });
    await tx.designTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => ({ ...scope, name: t.name, format: t.format, spec: t.spec, isDefault: true })),
    });
    await tx.scheduledJob.create({
      data: {
        key: `agent:weekly_plan:${workspaceId}`,
        type: "agent.weekly_plan",
        intervalSeconds: 7 * 86_400,
        nextRunAt: new Date(Date.now() + 7 * 86_400_000),
        enabled: false, // turned on by the user ("plan my week automatically")
        organizationId,
        workspaceId,
        payload: { workspaceId, organizationId },
      },
    });
    return { organization: org, workspace: ws };
  }).then(async (res) => {
    await audit({
      organizationId: res.organization.id,
      workspaceId: res.workspace.id,
      actorType: "USER",
      actorId: input.userId,
      action: "organization.created",
      entityType: "Organization",
      entityId: res.organization.id,
      summary: `Organization "${res.organization.name}" was created`,
    });
    return res;
  });
}
