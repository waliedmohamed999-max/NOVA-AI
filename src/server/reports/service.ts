import { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { aiStructured } from "../ai";
import { loadBrain } from "../agents/brain";
import { brainMeta, compactContext } from "../knowledge/company-context";
import { analyticsContext, briefContext } from "../knowledge/use-cases";
import { narrativeSchema } from "../agents/schemas";
import { engagementRate, mean, pctChange } from "../analytics/compare";
import { loadMetricRows } from "../analytics/digest";
import { notify } from "../notifications/service";
import { logger } from "../logger";

const DAY = 86_400_000;

/** Local calendar parts for a timezone (no external tz library needed). */
export function localParts(tz: string, d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday };
}

export type BriefData = {
  engagementChange: number | null;
  postsLast7: number;
  awaitingApproval: number;
  upcomingPosts: { id: string; title: string; platform: string; scheduledAt: string }[];
  newLeads: number;
  hotLeads: { id: string; name: string; company: string | null; nextAction: string | null }[];
  followUpsDue: number;
  meetingsUpcoming: number;
  insights: { id: string; title: string }[];
  attention: { integrations: number; failedPublications: number };
};

/** Every number in the brief comes from these queries — nothing is estimated. */
export async function collectBriefData(scope: TenantScope, now = new Date()): Promise<BriefData> {
  const rows = await loadMetricRows(scope, 14);
  const last7 = rows.filter((r) => r.publishedAt.getTime() > now.getTime() - 7 * DAY);
  const prev7 = rows.filter((r) => r.publishedAt.getTime() <= now.getTime() - 7 * DAY);
  const er = (rs: typeof rows) => mean(rs.map((r) => r.engagementRate ?? engagementRate(r)));
  const engagementChange = last7.length >= 2 && prev7.length >= 2 ? pctChange(er(last7), er(prev7)) : null;

  const endOfToday = new Date(now.getTime() + DAY);
  const [awaitingApproval, upcoming, newLeads, hotLeads, followUpsDue, meetingsUpcoming, insights, integrations, failedPublications] = await Promise.all([
    db.contentItem.count({ where: { ...scope, status: "PENDING_APPROVAL" } }),
    db.contentItem.findMany({ where: { ...scope, status: "SCHEDULED", scheduledAt: { gte: now, lte: new Date(now.getTime() + 3 * DAY) } }, orderBy: { scheduledAt: "asc" }, take: 5 }),
    db.lead.count({ where: { ...scope, createdAt: { gte: new Date(now.getTime() - DAY) } } }),
    db.lead.findMany({ where: { ...scope, temperature: "HOT", stage: { notIn: ["WON", "LOST"] } }, orderBy: { score: "desc" }, take: 5 }),
    db.salesActivity.count({ where: { ...scope, completedAt: null, dueAt: { lte: endOfToday } } }),
    db.salesActivity.count({ where: { ...scope, type: "MEETING", completedAt: null, dueAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY) } } }),
    db.aiInsight.findMany({ where: { ...scope, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.integration.count({ where: { ...scope, status: { in: ["ACTION_REQUIRED", "EXPIRED", "ERROR"] } } }),
    db.socialPublication.count({ where: { ...scope, status: "FAILED", updatedAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
  ]);
  return {
    engagementChange,
    postsLast7: last7.length,
    awaitingApproval,
    upcomingPosts: upcoming.map((u) => ({ id: u.id, title: u.title, platform: u.platform, scheduledAt: u.scheduledAt!.toISOString() })),
    newLeads,
    hotLeads: hotLeads.map((l) => ({ id: l.id, name: l.name, company: l.company, nextAction: l.nextAction })),
    followUpsDue,
    meetingsUpcoming,
    insights: insights.map((i) => ({ id: i.id, title: i.title })),
    attention: { integrations, failedPublications },
  };
}

/** Deterministic brief text — also the offline fallback for the AI narrative. */
export function factualBrief(d: BriefData, lang: "en" | "ar"): string {
  const s: string[] = [];
  const pct = (v: number) => `${Math.abs(Math.round(v * 100))}%`;
  if (lang === "ar") {
    if (d.engagementChange != null) s.push(`تفاعل حساباتك ${d.engagementChange >= 0 ? "ارتفع" : "انخفض"} بنسبة ${pct(d.engagementChange)} هذا الأسبوع مقارنة بالأسبوع الماضي.`);
    else s.push(d.postsLast7 ? `نشرت ${d.postsLast7} منشورات هذا الأسبوع.` : "لا توجد بيانات أداء كافية بعد للمقارنة.");
    if (d.awaitingApproval) s.push(`${d.awaitingApproval} منشورات بانتظار موافقتك.`);
    if (d.newLeads) s.push(`وصل ${d.newLeads} عملاء محتملين جدد خلال آخر 24 ساعة.`);
    if (d.hotLeads.length) s.push(`يوصي وكيل المبيعات بالتواصل اليوم مع ${d.hotLeads.slice(0, 3).map((l) => l.name).join("، ")}.`);
    if (d.followUpsDue) s.push(`${d.followUpsDue} متابعات مستحقة اليوم.`);
  } else {
    if (d.engagementChange != null) s.push(`Your social engagement is ${d.engagementChange >= 0 ? "up" : "down"} ${pct(d.engagementChange)} this week compared with last week.`);
    else s.push(d.postsLast7 ? `You published ${d.postsLast7} posts this week.` : "There isn't enough performance data yet to compare weeks.");
    if (d.awaitingApproval) s.push(`${d.awaitingApproval} post${d.awaitingApproval > 1 ? "s are" : " is"} waiting for your approval.`);
    if (d.newLeads) s.push(`${d.newLeads} new lead${d.newLeads > 1 ? "s" : ""} arrived in the last 24 hours.`);
    if (d.hotLeads.length) s.push(`The Sales Agent recommends reaching out to ${d.hotLeads.slice(0, 3).map((l) => l.name).join(", ")} today.`);
    if (d.followUpsDue) s.push(`${d.followUpsDue} follow-up${d.followUpsDue > 1 ? "s are" : " is"} due today.`);
  }
  return s.join(" ");
}

export async function generateDailyBrief(scope: TenantScope, now = new Date()) {
  const b = await loadBrain(scope);
  const tz = b.settings?.timezone ?? b.org.timezone;
  const day = localParts(tz, now).date;
  const periodStart = new Date(`${day}T00:00:00.000Z`);
  const data = await collectBriefData(scope, now);
  const factual = factualBrief(data, b.locale);
  // Selective: a short summary + approved priorities (the brief's own data carries approvals, follow-ups, campaigns).
  const brain = await briefContext(scope);
  let narrative = factual;
  let generatedBy = "rules";
  try {
    const res = await aiStructured(
      { ...scope, agentKey: "SOCIAL_MANAGER" },
      {
        task: "SUMMARIZATION",
        schemaName: "daily_brief",
        schema: narrativeSchema,
        system: ["Write a calm, 2–4 sentence morning brief for a business owner. Use ONLY the facts provided; do not add numbers.", `Write in ${b.locale === "ar" ? "Arabic" : "English"}.`, compactContext(brain)].join("\n"),
        maxTokens: 400,
        brain: brainMeta(brain),
        prompt: `Facts:\n${factual}\n\nStructured data:\n${JSON.stringify({ ...data, upcomingPosts: data.upcomingPosts.length })}`,
        offline: () => ({ narrative: factual, highlights: [] }),
      },
    );
    narrative = res.data.narrative;
    generatedBy = res.generatedBy;
  } catch (err) {
    logger.warn({ err }, "daily brief narrative failed; using factual brief");
  }
  return db.report.upsert({
    where: { workspaceId_kind_periodStart: { workspaceId: scope.workspaceId, kind: "DAILY_BRIEF", periodStart } },
    create: { ...scope, kind: "DAILY_BRIEF", periodStart, periodEnd: new Date(periodStart.getTime() + DAY), data: data as unknown as Prisma.InputJsonValue, narrative, generatedBy },
    update: { data: data as unknown as Prisma.InputJsonValue, narrative, generatedBy },
  });
}

export type WeeklyData = {
  posts: { thisWeek: number; lastWeek: number };
  reach: { thisWeek: number | null; lastWeek: number | null };
  engagement: { thisWeek: number | null; lastWeek: number | null };
  best: { id: string; caption: string | null; platform: string; engagementRate: number | null } | null;
  worst: { id: string; caption: string | null; platform: string; engagementRate: number | null } | null;
  followers: { change: number | null };
  leads: { created: number; qualified: number; won: number; wonValueCents: number; bySource: { source: string; count: number }[] };
  learned: { title: string }[];
  recommendations: string[];
};

export async function generateWeeklyReport(scope: TenantScope, now = new Date()) {
  const b = await loadBrain(scope);
  const weekStart = new Date(now.getTime() - 7 * DAY);
  const prevStart = new Date(now.getTime() - 14 * DAY);
  const rows = await loadMetricRows(scope, 14);
  const tw = rows.filter((r) => r.publishedAt >= weekStart);
  const lw = rows.filter((r) => r.publishedAt < weekStart && r.publishedAt >= prevStart);
  const sum = (rs: typeof rows) => (rs.some((r) => r.reach != null) ? rs.reduce((a, r) => a + (r.reach ?? 0), 0) : null);
  const sorted = [...tw].filter((r) => r.engagementRate != null).sort((a, b2) => b2.engagementRate! - a.engagementRate!);
  const pick = async (r?: (typeof rows)[number]) => {
    if (!r) return null;
    const p = await db.socialPost.findUnique({ where: { id: r.id } });
    return { id: r.id, caption: p?.caption?.slice(0, 160) ?? null, platform: r.platform, engagementRate: r.engagementRate };
  };
  const [snapNow, snapThen, created, qualified, won, bySource, learned] = await Promise.all([
    db.accountMetricSnapshot.aggregate({ where: { ...scope, date: { gte: new Date(now.getTime() - 2 * DAY) } }, _sum: { followers: true } }),
    db.accountMetricSnapshot.aggregate({ where: { ...scope, date: { gte: new Date(weekStart.getTime() - 2 * DAY), lte: weekStart } }, _sum: { followers: true } }),
    db.lead.count({ where: { ...scope, createdAt: { gte: weekStart } } }),
    db.leadEvent.count({ where: { ...scope, type: "STATUS_CHANGE", createdAt: { gte: weekStart }, title: { endsWith: "QUALIFIED" } } }),
    db.lead.findMany({ where: { ...scope, stage: "WON", stageChangedAt: { gte: weekStart } }, select: { estimatedValueCents: true } }),
    db.lead.groupBy({ by: ["source"], where: { ...scope, createdAt: { gte: weekStart } }, _count: true }),
    db.aiInsight.findMany({ where: { ...scope, createdAt: { gte: weekStart }, kind: { in: ["learning", "performance_comparison"] } }, take: 5, orderBy: { createdAt: "desc" } }),
  ]);
  const data: WeeklyData = {
    posts: { thisWeek: tw.length, lastWeek: lw.length },
    reach: { thisWeek: sum(tw), lastWeek: sum(lw) },
    engagement: { thisWeek: mean(tw.map((r) => r.engagementRate)), lastWeek: mean(lw.map((r) => r.engagementRate)) },
    best: await pick(sorted[0]),
    worst: sorted.length > 1 ? await pick(sorted[sorted.length - 1]) : null,
    followers: { change: snapNow._sum.followers != null && snapThen._sum.followers != null ? snapNow._sum.followers - snapThen._sum.followers : null },
    leads: {
      created,
      qualified,
      won: won.length,
      wonValueCents: won.reduce((a, l) => a + (l.estimatedValueCents ?? 0), 0),
      bySource: bySource.map((s) => ({ source: s.source ?? "—", count: s._count })),
    },
    learned: learned.map((l) => ({ title: l.title })),
    recommendations: [],
  };
  // Analytics context: approved strategy + only products mentioned by this week's best/worst posts (no CRM records).
  const brain = await analyticsContext(scope, [data.best?.caption, data.worst?.caption].filter(Boolean).join(" "));
  const res = await aiStructured(
    { ...scope, agentKey: "PERFORMANCE_ANALYST" },
    {
      task: "ANALYSIS",
      schemaName: "weekly_report",
      schema: narrativeSchema,
      system: ["You are the Performance Analyst writing the weekly growth report. Use only the data given. 'highlights' = up to 4 concrete recommended actions for next week.", `Write in ${b.locale === "ar" ? "Arabic" : "English"}.`, compactContext(brain)].join("\n"),
      maxTokens: 800,
      brain: brainMeta(brain),
      prompt: JSON.stringify(data),
      offline: () => ({
        narrative:
          b.locale === "ar"
            ? `نشرت ${tw.length} منشورات هذا الأسبوع مقابل ${lw.length} الأسبوع الماضي، ووصل ${created} عملاء محتملين جدد.`
            : `You published ${tw.length} posts this week (vs ${lw.length} last week) and received ${created} new leads.`,
        highlights: learned.slice(0, 3).map((l) => l.title),
      }),
    },
  );
  data.recommendations = res.data.highlights;
  const periodStart = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate()));
  const report = await db.report.upsert({
    where: { workspaceId_kind_periodStart: { workspaceId: scope.workspaceId, kind: "WEEKLY_REPORT", periodStart } },
    create: { ...scope, kind: "WEEKLY_REPORT", periodStart, periodEnd: now, data: data as unknown as Prisma.InputJsonValue, narrative: res.data.narrative, generatedBy: res.generatedBy },
    update: { data: data as unknown as Prisma.InputJsonValue, narrative: res.data.narrative, generatedBy: res.generatedBy, periodEnd: now },
  });
  await notify({ ...scope, type: "REPORT_READY", title: b.locale === "ar" ? "تقرير النمو الأسبوعي جاهز" : "Your weekly growth report is ready", link: `/reports/${report.id}` });
  return report;
}

/** Scheduler fan-out: generate briefs for workspaces whose local brief hour has arrived. */
export async function dueWorkspaces(kind: "DAILY_BRIEF" | "WEEKLY_REPORT", now = new Date()) {
  const settings = await db.workspaceSettings.findMany({ include: { workspace: { include: { organization: true } } }, take: 5000 });
  const due: TenantScope[] = [];
  for (const s of settings) {
    if (s.workspace.organization.onboardingStatus !== "COMPLETED") continue;
    const local = localParts(s.timezone, now);
    if (local.hour < s.dailyBriefHour) continue;
    if (kind === "WEEKLY_REPORT" && local.weekday !== s.weeklyReportDay) continue;
    const since = kind === "DAILY_BRIEF" ? new Date(`${local.date}T00:00:00.000Z`) : new Date(now.getTime() - 6 * DAY);
    const exists = await db.report.findFirst({ where: { workspaceId: s.workspaceId, kind, createdAt: { gte: since } } });
    if (!exists) due.push({ organizationId: s.organizationId, workspaceId: s.workspaceId });
  }
  return due;
}
