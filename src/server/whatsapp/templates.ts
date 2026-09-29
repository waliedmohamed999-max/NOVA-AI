import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "../db/client";
import { tenantDb, type TenantScope } from "../db/tenant";
import { NotFoundError, UserFacingError } from "../errors";
import { audit } from "../audit";
import { aiAvailability, aiStructured } from "../ai";
import { brainMeta, compactContext, retrieveCompanyContext } from "../knowledge/company-context";
import { createTemplate, listTemplates } from "./cloud-api";
import { numberFor, tokenFor } from "./numbers";
import { TEMPLATE_NAME, VARIABLE_SOURCES, renderTemplate, templateVariables, variablesSequential } from "./policy";

/**
 * WhatsApp templates. A local DRAFT is only a working copy: it can be sent only after Meta APPROVES it.
 * Submitting to Meta is an explicit owner action; statuses come from Meta (sync), never assumed.
 */

type Actor = { userId: string; label: string };

const button = z.object({ type: z.enum(["QUICK_REPLY", "URL"]), text: z.string().trim().min(1).max(25), url: z.string().url().max(2000).optional() });
export const templateSchema = z
  .object({
    name: z.string().trim().regex(TEMPLATE_NAME),
    language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/),
    category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
    header: z.string().trim().max(60).nullable().optional(),
    body: z.string().trim().min(1).max(1024),
    footer: z.string().trim().max(60).nullable().optional(),
    buttons: z.array(button).max(3).default([]),
    variables: z.record(z.string().regex(/^\d+$/), z.string().max(200)).default({}),
  })
  .refine((t) => variablesSequential(t.body), { message: "variables_not_sequential", path: ["body"] })
  .refine((t) => templateVariables(t.body).every((n) => typeof t.variables[String(n)] === "string" && t.variables[String(n)].length > 0), { message: "variables_unmapped", path: ["variables"] })
  .refine((t) => Object.values(t.variables).every((v) => (VARIABLE_SOURCES as readonly string[]).includes(v.split(":")[0])), { message: "variables_unknown_source", path: ["variables"] })
  .refine((t) => t.buttons.every((b) => b.type !== "URL" || b.url), { message: "button_url", path: ["buttons"] });
export type TemplateInput = z.input<typeof templateSchema>;

export async function listTemplatesByStatus(scope: TenantScope, status?: string) {
  return tenantDb(scope).whatsAppTemplate.findMany({ where: status ? { status } : {}, orderBy: { updatedAt: "desc" }, take: 200 });
}

export async function saveTemplateDraft(scope: TenantScope, input: TemplateInput, actor: Actor, id?: string) {
  const d = templateSchema.parse(input);
  const t = tenantDb(scope);
  const data = { name: d.name, language: d.language, category: d.category, header: d.header || null, body: d.body, footer: d.footer || null, buttons: d.buttons as Prisma.InputJsonValue, variables: d.variables as Prisma.InputJsonValue };
  if (id) {
    const cur = await t.whatsAppTemplate.findUnique({ where: { id } });
    if (!cur) throw new NotFoundError("item");
    // What Meta reviewed can't be edited in place: approved / pending templates are read-only here.
    if (!["DRAFT", "REJECTED"].includes(cur.status)) throw new UserFacingError("whatsapp_template_locked");
    return t.whatsAppTemplate.update({ where: { id }, data: { ...data, status: "DRAFT", rejectedReason: null } });
  }
  const dup = await t.whatsAppTemplate.findFirst({ where: { name: d.name, language: d.language } });
  if (dup) throw new UserFacingError("whatsapp_template_exists");
  const row = await t.whatsAppTemplate.create({ data: { ...data, organizationId: scope.organizationId, workspaceId: scope.workspaceId, status: "DRAFT", createdById: actor.userId } });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.template_draft", entityType: "WhatsAppTemplate", entityId: row.id, summary: `Template draft "${row.name}"` });
  return row;
}

export async function deleteTemplateDraft(scope: TenantScope, id: string) {
  const t = tenantDb(scope);
  const cur = await t.whatsAppTemplate.findUnique({ where: { id } });
  if (!cur) throw new NotFoundError("item");
  if (!["DRAFT", "REJECTED"].includes(cur.status)) throw new UserFacingError("whatsapp_template_locked");
  await t.whatsAppTemplate.delete({ where: { id } });
}

const SAMPLE: Record<string, { ar: string; en: string }> = {
  customer_name: { ar: "سارة", en: "Sara" },
  company: { ar: "شركة المثال", en: "Example Co" },
  appointment: { ar: "الأحد 10:00 ص", en: "Sunday 10:00 AM" },
  order: { ar: "طلب رقم 1024", en: "Order 1024" },
  quote_amount: { ar: "5,000 ر.س", en: "SAR 5,000" },
  agent_name: { ar: "أحمد", en: "Ahmed" },
};

/** Examples Meta requires for review (never real customer data). */
function examplesFor(variables: Record<string, string>, body: string, lang: "ar" | "en") {
  return templateVariables(body).map((n) => {
    const src = variables[String(n)] ?? "static";
    return src.startsWith("static:") ? src.slice(7) || "—" : (SAMPLE[src]?.[lang] ?? "—");
  });
}

/** Explicit submission for Meta review → PENDING (Meta decides; we never mark it approved ourselves). */
export async function submitTemplate(scope: TenantScope, id: string, actor: Actor) {
  const t = tenantDb(scope);
  const tpl = await t.whatsAppTemplate.findUnique({ where: { id } });
  if (!tpl) throw new NotFoundError("item");
  if (!["DRAFT", "REJECTED"].includes(tpl.status)) throw new UserFacingError("invalid_transition");
  const number = await numberFor(scope);
  if (!number?.wabaId) throw new UserFacingError("integration_not_configured");
  const token = await tokenFor(number);
  if (!token) throw new UserFacingError("integration_not_configured");
  const lang = tpl.language.startsWith("ar") ? "ar" : "en";
  const r = await createTemplate(number.wabaId, { name: tpl.name, language: tpl.language, category: tpl.category, header: tpl.header, body: tpl.body, footer: tpl.footer, buttons: (tpl.buttons ?? []) as { type: "QUICK_REPLY" | "URL"; text: string; url?: string }[], examples: examplesFor((tpl.variables ?? {}) as Record<string, string>, tpl.body, lang) }, token);
  const status = ["APPROVED", "REJECTED", "PENDING"].includes(r.status) ? r.status : "PENDING";
  const row = await t.whatsAppTemplate.update({ where: { id }, data: { status, externalId: r.id ?? null, category: r.category ?? tpl.category, lastSyncedAt: new Date(), rejectedReason: null } });
  await audit({ ...scope, actorType: "USER", actorId: actor.userId, actorLabel: actor.label, action: "whatsapp.template_submitted", entityType: "WhatsAppTemplate", entityId: id, summary: `Template "${tpl.name}" submitted to Meta (${status})` });
  return row;
}

/** Pulls every template's current status from Meta (and templates created in Meta's own tools). */
export async function syncTemplates(scope: TenantScope) {
  const number = await numberFor(scope);
  if (!number?.wabaId) throw new UserFacingError("integration_not_configured");
  const token = await tokenFor(number);
  if (!token) throw new UserFacingError("integration_not_configured");
  const remote = await listTemplates(number.wabaId, token);
  const t = tenantDb(scope);
  let updated = 0;
  for (const r of remote) {
    const body = r.components?.find((c) => c.type === "BODY")?.text ?? "";
    const header = r.components?.find((c) => c.type === "HEADER" && (c.format ?? "TEXT") === "TEXT")?.text ?? null;
    const footer = r.components?.find((c) => c.type === "FOOTER")?.text ?? null;
    const buttons = (r.components?.find((c) => c.type === "BUTTONS")?.buttons ?? []).map((b) => ({ type: b.type === "URL" ? "URL" : "QUICK_REPLY", text: b.text, url: b.url }));
    const status = ["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"].includes(r.status) ? r.status : "PENDING";
    const existing = await t.whatsAppTemplate.findFirst({ where: { name: r.name, language: r.language } });
    if (existing) await t.whatsAppTemplate.update({ where: { id: existing.id }, data: { status, externalId: r.id ?? existing.externalId, category: r.category, rejectedReason: r.rejected_reason && r.rejected_reason !== "NONE" ? r.rejected_reason : null, lastSyncedAt: new Date(), ...(body ? { body } : {}), header, footer, buttons: buttons as Prisma.InputJsonValue } });
    else {
      // Templates made in Meta's tools: variables default to the customer name for {{1}}, the rest "static".
      const vars = Object.fromEntries(templateVariables(body).map((n) => [String(n), n === 1 ? "customer_name" : "static:"]));
      await t.whatsAppTemplate.create({ data: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, name: r.name, language: r.language, category: r.category, status, body: body || "—", header, footer, buttons: buttons as Prisma.InputJsonValue, variables: vars, externalId: r.id ?? null, lastSyncedAt: new Date() } });
    }
    updated++;
  }
  return { updated };
}

type LeadLike = { id: string; name: string; company: string | null; ownerId: string | null; externalId?: string | null; lastOrderAt?: Date | null; purchaseCategories?: string[] };

/** Fills {{n}} from the CRM. Missing values are reported — a recipient without them is not sent to. */
export async function resolveVariables(scope: TenantScope, lead: LeadLike, mapping: Record<string, string>, overrides: Record<string, string> = {}, agentName?: string) {
  const keys = Object.keys(mapping).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
  const values: string[] = [];
  const missing: number[] = [];
  let meetingCache: string | null | undefined;
  let quoteCache: string | null | undefined;
  for (const n of keys) {
    const src = mapping[String(n)] ?? "";
    let v: string | null = overrides[String(n)]?.trim() || null;
    if (!v) {
      if (src.startsWith("static:")) v = src.slice(7).trim() || null;
      else if (src === "customer_name") v = lead.name?.split(/\s+/)[0] || null;
      else if (src === "company") v = lead.company;
      else if (src === "agent_name") v = agentName ?? (lead.ownerId ? ((await db.user.findUnique({ where: { id: lead.ownerId }, select: { name: true } }))?.name ?? null) : null);
      else if (src === "appointment") {
        if (meetingCache === undefined) {
          const m = await tenantDb(scope).meeting.findFirst({ where: { leadId: lead.id, startAt: { gte: new Date() } }, orderBy: { startAt: "asc" }, select: { startAt: true } });
          meetingCache = m?.startAt ? m.startAt.toISOString().slice(0, 16).replace("T", " ") : null;
        }
        v = meetingCache;
      } else if (src === "quote_amount") {
        if (quoteCache === undefined) {
          const q = await tenantDb(scope).quote.findFirst({ where: { leadId: lead.id, status: { in: ["SENT", "VIEWED", "ACCEPTED"] } }, orderBy: { createdAt: "desc" }, select: { totalCents: true, currency: true } });
          quoteCache = q ? `${(q.totalCents / 100).toLocaleString("en")} ${q.currency}` : null;
        }
        v = quoteCache;
      } else if (src === "order") v = lead.externalId ?? lead.purchaseCategories?.[0] ?? null;
    }
    if (v) values.push(v.slice(0, 200));
    else {
      values.push("");
      missing.push(n);
    }
  }
  return { values, missing };
}

export async function previewTemplate(scope: TenantScope, templateId: string, leadId: string | null) {
  const t = tenantDb(scope);
  const tpl = await t.whatsAppTemplate.findUnique({ where: { id: templateId } });
  if (!tpl) throw new NotFoundError("item");
  const mapping = (tpl.variables ?? {}) as Record<string, string>;
  if (!leadId) {
    const lang = tpl.language.startsWith("ar") ? "ar" : "en";
    return { text: renderTemplate(tpl.body, examplesFor(mapping, tpl.body, lang)), missing: [] as number[], sample: true };
  }
  const lead = await t.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new NotFoundError("lead");
  const r = await resolveVariables(scope, lead, mapping);
  return { text: renderTemplate(tpl.body, r.values.map((v, i) => v || `{{${i + 1}}}`)), missing: r.missing, sample: false };
}

const draftSchema = z.object({ name: z.string().max(60), body: z.string().max(900), footer: z.string().max(60) });

/**
 * NOVA helps write a template: brand tone + the relevant offering from the Company Brain (small context).
 * Without an AI provider the owner writes it — nothing is invented.
 */
export async function draftTemplateText(scope: TenantScope, input: { objective: string; topic?: string; locale: "ar" | "en" }) {
  if (!aiAvailability().configured) throw new UserFacingError("ai_not_configured");
  const ctx = await retrieveCompanyContext(scope, { purpose: "content", query: input.topic ?? input.objective, budget: "small", topK: 2 });
  const res = await aiStructured(
    { organizationId: scope.organizationId, workspaceId: scope.workspaceId, agentKey: "CONTENT_STRATEGIST" },
    {
      task: "COPYWRITING",
      schemaName: "whatsapp_template",
      schema: draftSchema,
      maxTokens: 400,
      brain: brainMeta(ctx),
      system: [
        "Write a WhatsApp Business message template. Use {{1}} for the customer's first name. Keep it under 500 characters, one clear call to action.",
        "No prices, discounts or claims that are not in the company knowledge. Template name: lowercase letters, digits and underscores only.",
        `Write in ${input.locale === "ar" ? "Arabic" : "English"}.`,
        "",
        compactContext(ctx),
      ].join("\n"),
      prompt: `Objective: ${input.objective}${input.topic ? `\nTopic: ${input.topic}` : ""}`,
      offline: () => ({ name: `${input.objective.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40) || "message"}`, body: input.locale === "ar" ? "مرحبًا {{1}}، لدينا جديد يهمك. هل تود معرفة التفاصيل؟" : "Hi {{1}}, we have something new for you. Would you like the details?", footer: "" }),
    },
  );
  return { ...res.data, name: res.data.name.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 60) || "message", generatedBy: res.offline ? "offline" : "ai" };
}
