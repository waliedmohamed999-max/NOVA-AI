import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { UserFacingError } from "../errors";
import { audit } from "../audit";
import { normalizePhone, validPhone, whatsappStatus, embeddedSignupStatus } from "./cloud-api";
import { AUTO_REPLY_LEVELS, SAFE_INTENTS, parseLevel } from "./policy";

type Actor = { userId: string; label: string };

export const WA_GOALS = ["receive", "answer", "followup", "campaigns", "all"] as const;

export const settingsSchema = z
  .object({
    level: z.enum(AUTO_REPLY_LEVELS),
    safeIntents: z.array(z.enum(SAFE_INTENTS)).max(SAFE_INTENTS.length),
    optOutKeywords: z.array(z.string().trim().min(1).max(30)).max(10),
    requireConsent: z.boolean(),
    goals: z.array(z.enum(WA_GOALS)).max(WA_GOALS.length),
  })
  .partial();

export async function loadWhatsAppSettings(scope: TenantScope) {
  const s = await db.workspaceSettings.findFirst({ where: scope, select: { whatsappAutoReply: true, whatsappConfig: true } });
  const cfg = (s?.whatsappConfig ?? {}) as { safeIntents?: string[]; optOutKeywords?: string[]; requireConsent?: boolean; goals?: string[]; safeRepliesReviewed?: boolean };
  return {
    level: parseLevel(s?.whatsappAutoReply),
    safeIntents: (cfg.safeIntents ?? ["greeting", "opening_hours", "location", "contact_details"]) as string[],
    optOutKeywords: cfg.optOutKeywords ?? [],
    requireConsent: Boolean(cfg.requireConsent),
    goals: cfg.goals ?? [],
    safeRepliesReviewed: Boolean(cfg.safeRepliesReviewed),
  };
}

/**
 * Saves preferences. Choosing goals (e.g. during onboarding) stores preferences only — it never switches
 * on automatic sending; only an explicit level change does.
 */
export async function saveWhatsAppSettings(scope: TenantScope, input: z.input<typeof settingsSchema>, actor: Actor) {
  const p = settingsSchema.parse(input);
  const cur = await db.workspaceSettings.findFirst({ where: scope });
  if (!cur) throw new UserFacingError("item_not_found");
  const cfg = { ...((cur.whatsappConfig ?? {}) as Record<string, unknown>) };
  for (const k of ["safeIntents", "optOutKeywords", "requireConsent", "goals"] as const) if (p[k] !== undefined) cfg[k] = p[k];
  if (p.level !== undefined || p.safeIntents !== undefined) cfg.safeRepliesReviewed = true;
  await db.workspaceSettings.update({ where: { id: cur.id }, data: { whatsappConfig: cfg as Prisma.InputJsonValue, ...(p.level ? { whatsappAutoReply: p.level } : {}) } });
  if (p.level && p.level !== cur.whatsappAutoReply) await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.auto_reply_level", summary: `WhatsApp auto-reply: ${cur.whatsappAutoReply} → ${p.level}` });
  return loadWhatsAppSettings(scope);
}

export async function listSuppressions(scope: TenantScope, page = 1) {
  const t = tenantDb(scope);
  const [rows, total] = await Promise.all([t.whatsAppSuppression.findMany({ orderBy: { createdAt: "desc" }, take: 50, skip: (page - 1) * 50 }), t.whatsAppSuppression.count()]);
  return { rows: rows.map((r) => ({ id: r.id, phone: r.phone, reason: r.reason, note: r.note, at: r.createdAt.toISOString() })), total };
}

export async function addSuppression(scope: TenantScope, phone: string, reason: "blocked" | "invalid" | "manual", note: string | null, actor: Actor) {
  const digits = normalizePhone(phone);
  if (!validPhone(digits)) throw new UserFacingError("whatsapp_invalid_phone");
  await db.whatsAppSuppression.upsert({ where: { workspaceId_phone: { workspaceId: scope.workspaceId, phone: digits } }, create: { ...scope, phone: digits, reason, note: note?.slice(0, 200) ?? null, createdById: actor.userId }, update: { reason, note: note?.slice(0, 200) ?? null } });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.suppressed", summary: `…${digits.slice(-4)} added to the WhatsApp suppression list (${reason})` });
}

export async function removeSuppression(scope: TenantScope, id: string, actor: Actor) {
  const row = await tenantDb(scope).whatsAppSuppression.findUnique({ where: { id } });
  if (!row) throw new UserFacingError("item_not_found");
  // Someone who opted out stays out until they opt in themselves (START).
  if (row.reason === "opt_out") throw new UserFacingError("whatsapp_opt_out_locked");
  await tenantDb(scope).whatsAppSuppression.delete({ where: { id } });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.unsuppressed", summary: `…${row.phone.slice(-4)} removed from the WhatsApp suppression list` });
}

/** Connection health: simple for customers, technical detail only for platform admins (never secrets). */
export async function connectionHealth(scope: TenantScope, admin: boolean) {
  const t = tenantDb(scope);
  const numbers = await t.whatsAppNumber.findMany({ orderBy: { createdAt: "asc" } });
  const [approved, lastSend] = await Promise.all([t.whatsAppTemplate.count({ where: { status: "APPROVED" } }), t.message.findFirst({ where: { direction: "OUTBOUND", status: "SENT", conversation: { channel: "WHATSAPP" } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } })]);
  const st = whatsappStatus();
  return {
    numbers: numbers.map((n) => ({ id: n.id, display: n.displayPhone, name: n.verifiedName, status: n.isActive ? n.status : "disconnected", quality: n.qualityRating, tier: n.messagingLimit, connectedAt: n.connectedAt.toISOString(), lastWebhookAt: n.lastWebhookAt?.toISOString() ?? null, lastSendAt: n.lastSendAt?.toISOString() ?? null, lastError: n.lastError, via: n.integrationId ? "embedded_signup" : "platform" })),
    approvedTemplates: approved,
    lastSuccessfulSend: lastSend?.sentAt?.toISOString() ?? null,
    webhookReady: st.webhookReady,
    signupAvailable: embeddedSignupStatus().available,
    ...(admin ? { admin: { missingEnv: st.missing, embeddedConfig: Boolean(embeddedSignupStatus().configId) } } : {}),
  };
}
export type ConnectionHealth = Awaited<ReturnType<typeof connectionHealth>>;
