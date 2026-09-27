import { z } from "zod";
import { db } from "../db/client";
import { createLead } from "./service";
import { aiAvailability } from "../ai";
import { rateLimit } from "../rate-limit";
import { logger } from "../logger";

export type FormField = { key: string; label: string; type: "text" | "email" | "tel" | "textarea"; required: boolean };

export type CaptureResult =
  | { ok: true; message: string | null; leadId: string }
  | { ok: false; status: number; error: "not_found" | "forbidden_origin" | "rate_limited" | "validation"; fields?: string[] };

const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer", "page"] as const;

/** Origins allowed to post: the app itself (the hosted embed) plus the form's configured origins. */
export function originAllowed(origin: string | null, allowed: string[], appUrl: string) {
  if (!origin) return true; // server-to-server or same-origin navigations send no Origin
  const o = origin.replace(/\/$/, "");
  if (o === new URL(appUrl).origin) return true;
  return allowed.some((a) => a.replace(/\/$/, "") === o);
}

/**
 * Public lead capture. Defences: unknown/inactive keys 404, origin allow-list,
 * per-IP and per-form rate limits, honeypot + minimum fill time, strict field
 * validation and length caps. Creates a real lead and queues qualification.
 */
export async function captureLead(publicKey: string, input: Record<string, unknown>, meta: { ip: string | null; origin: string | null; appUrl: string }): Promise<CaptureResult> {
  const form = await db.leadCaptureForm.findUnique({ where: { publicKey } });
  if (!form || !form.isActive) return { ok: false, status: 404, error: "not_found" };
  if (!originAllowed(meta.origin, form.allowedOrigins, meta.appUrl)) return { ok: false, status: 403, error: "forbidden_origin" };

  const [perIp, perForm] = await Promise.all([rateLimit(`lead:${publicKey}:${meta.ip ?? "unknown"}`, 5, 600), rateLimit(`lead-form:${publicKey}`, 300, 3600)]);
  if (!perIp.ok || !perForm.ok) return { ok: false, status: 429, error: "rate_limited" };

  // Bots: honeypot must stay empty; humans take more than ~2s to fill a form.
  const startedAt = Number(input._ts ?? 0);
  if ((typeof input.company_website === "string" && input.company_website.length > 0) || (startedAt && Date.now() - startedAt < 2000)) {
    logger.info({ publicKey }, "lead capture: spam heuristics triggered");
    return { ok: true, message: form.successMessage, leadId: "" }; // silently accept, store nothing
  }

  const fields = (form.fields as FormField[]) ?? [];
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    let s: z.ZodType = f.type === "email" ? z.string().trim().email().max(254) : z.string().trim().max(f.type === "textarea" ? 4000 : 200);
    if (!f.required) s = s.optional().or(z.literal(""));
    else s = (s as z.ZodString).min(1);
    shape[f.key] = s;
  }
  const parsed = z.object(shape).safeParse(input);
  if (!parsed.success) return { ok: false, status: 422, error: "validation", fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0])))] };
  const v = parsed.data as Record<string, string | undefined>;

  const attribution = Object.fromEntries(ATTRIBUTION_KEYS.map((k) => [k, typeof input[k] === "string" ? String(input[k]).slice(0, 200) : undefined]).filter(([, x]) => x));
  const scope = { organizationId: form.organizationId, workspaceId: form.workspaceId };
  let campaignId = form.campaignId;
  if (!campaignId && attribution.utm_campaign) {
    const c = await db.campaign.findFirst({ where: { ...scope, name: { equals: String(attribution.utm_campaign), mode: "insensitive" } }, select: { id: true } });
    campaignId = c?.id ?? null;
  }

  const lead = await createLead(
    scope,
    {
      name: v.name || v.email || "Website visitor",
      email: v.email || null,
      phone: v.phone || null,
      company: v.company || null,
      message: v.message || null,
      channel: "WEBSITE",
      source: attribution.utm_source ? `Website form (${attribution.utm_source})` : `Website form: ${form.name}`,
      campaignId,
      formFields: { ...Object.fromEntries(Object.entries(v).filter(([, x]) => x)), ...attribution } as Record<string, string>,
    },
    { type: "SYSTEM", label: form.name },
    { qualify: aiAvailability().configured },
  );
  await db.leadCaptureForm.update({ where: { id: form.id }, data: { submissions: { increment: 1 } } });
  return { ok: true, message: form.successMessage, leadId: lead.id };
}
