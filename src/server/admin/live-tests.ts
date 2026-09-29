import { db } from "../db/client";
import type { TenantScope } from "../db/tenant";
import { audit } from "../audit";
import { UserFacingError } from "../errors";
import { getMailer, safeMessage } from "../email/mailer";
import { SOCIAL_PROVIDERS } from "../integrations/registry";
import { freshToken, providerIdFor } from "../integrations/service";
import { isCalendar, isMailbox, type CalendarApi } from "../integrations/providers/workspace-apis";
import { ProviderError } from "../integrations/types";
import { mailboxFor } from "../integrations/workspace";
import { normalizePhone, sendTemplate as waSendTemplate, sendText as waSendText, whatsappStatus } from "../whatsapp/cloud-api";
import { call, errCode, errText, recordValidation } from "./readiness";

/**
 * Manual live tests for platform admins. Each one is triggered by a button (never by automated tests),
 * records a ProviderValidation row (with HTTP status / error code / correlation id for the admin), and
 * never stores or returns secrets. Tests that could reach a real person or create data require a typed
 * confirmation and clean up after themselves.
 */
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "") ?? "";
type Actor = { userId: string; organizationId?: string | null };
const providerErr = (e: unknown) =>
  e instanceof ProviderError ? { httpStatus: e.status ?? null, errorCode: e.kind, detail: `${e.message}${e.detail ? ` — ${String(e.detail).slice(0, 300)}` : ""}` } : { httpStatus: null, errorCode: "error", detail: e instanceof Error ? e.message : String(e) };

// ── WhatsApp ──

const graph = (path: string) => `https://graph.facebook.com/${clean(process.env.WHATSAPP_API_VERSION) || "v21.0"}/${path}`;
const waAuth = () => ({ authorization: `Bearer ${clean(process.env.WHATSAPP_ACCESS_TOKEN)}` });

export type WhatsappDiagnostics = {
  configured: boolean;
  missing: string[];
  tokenValid: boolean;
  phoneNumbers: { id: string; display: string | null; verifiedName: string | null; quality: string | null; status: string | null; codeVerification: string | null; nameStatus: string | null; ok: boolean; error?: string }[];
  webhookConfigured: boolean | null;
  webhookDetail: string;
  templates: { total: number; approved: number } | null;
  messaging: boolean;
  summary: string;
  httpStatus: number | null;
  errorCode: string | null;
};

/** Read-only WhatsApp diagnostics: token, phone numbers, webhook subscription, templates. Sends nothing. */
export async function whatsappDiagnostics(): Promise<WhatsappDiagnostics> {
  const st = whatsappStatus();
  const out: WhatsappDiagnostics = { configured: st.configured, missing: st.missing, tokenValid: false, phoneNumbers: [], webhookConfigured: null, webhookDetail: "", templates: null, messaging: false, summary: "", httpStatus: null, errorCode: null };
  if (!st.configured) {
    out.summary = `Not configured (${st.missing.join(", ")})`;
    return out;
  }
  const me = await call(graph("me?fields=id,name"), { headers: waAuth() });
  out.tokenValid = me.status === 200;
  if (!out.tokenValid) {
    out.httpStatus = me.status;
    out.errorCode = errCode(me.body);
    out.summary = `Token rejected: ${errText(me.body)}`;
    return out;
  }
  const linked = await db.whatsAppNumber.findMany({ where: { isActive: true }, select: { phoneNumberId: true } });
  const ids = [...new Set([clean(process.env.WHATSAPP_PHONE_NUMBER_ID), ...linked.map((l) => l.phoneNumberId)].filter(Boolean))];
  for (const id of ids) {
    const r = await call(graph(`${encodeURIComponent(id)}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status`), { headers: waAuth() });
    if (r.status !== 200) {
      out.phoneNumbers.push({ id, display: null, verifiedName: null, quality: null, status: null, codeVerification: null, nameStatus: null, ok: false, error: errText(r.body) });
      continue;
    }
    const b = r.body as Record<string, string | undefined>;
    const ok = (b.status ?? "CONNECTED") === "CONNECTED";
    out.phoneNumbers.push({ id, display: b.display_phone_number ?? null, verifiedName: b.verified_name ?? null, quality: b.quality_rating ?? null, status: b.status ?? null, codeVerification: b.code_verification_status ?? null, nameStatus: b.name_status ?? null, ok });
  }
  out.messaging = out.phoneNumbers.some((p) => p.ok);
  const waba = clean(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);
  const webhookSecrets = Boolean(clean(process.env.WHATSAPP_VERIFY_TOKEN) && clean(process.env.WHATSAPP_APP_SECRET));
  if (waba) {
    const [tpl, subs] = await Promise.all([
      call(graph(`${encodeURIComponent(waba)}/message_templates?fields=name,status,language&limit=100`), { headers: waAuth() }),
      call(graph(`${encodeURIComponent(waba)}/subscribed_apps`), { headers: waAuth() }),
    ]);
    if (tpl.status === 200) {
      const data = ((tpl.body.data as { status?: string }[]) ?? []);
      out.templates = { total: data.length, approved: data.filter((t) => t.status === "APPROVED").length };
    }
    const subscribed = subs.status === 200 && ((subs.body.data as unknown[]) ?? []).length > 0;
    out.webhookConfigured = webhookSecrets && subscribed;
    out.webhookDetail = !webhookSecrets ? "WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET missing" : subscribed ? "App subscribed to the WABA webhooks" : "No app subscribed to this WABA's webhooks";
  } else {
    out.webhookConfigured = webhookSecrets ? null : false;
    out.webhookDetail = webhookSecrets ? "Set WHATSAPP_BUSINESS_ACCOUNT_ID to verify the webhook subscription and templates" : "WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET missing";
  }
  out.summary = [
    "Token valid",
    ids.length ? `${out.phoneNumbers.filter((p) => p.ok).length}/${ids.length} phone number(s) connected` : "no phone number configured or linked",
    out.templates ? `${out.templates.approved}/${out.templates.total} templates approved` : null,
    out.webhookDetail,
  ]
    .filter(Boolean)
    .join(" · ");
  return out;
}

export async function whatsappConnectionTest(actor: Actor) {
  const d = await whatsappDiagnostics();
  const ok = d.configured && d.tokenValid && d.messaging;
  await recordValidation({ provider: "whatsapp", check: "connection_test", ok, live: d.configured && d.tokenValid, detail: d.summary, httpStatus: d.httpStatus, errorCode: d.errorCode, meta: { phoneNumbers: d.phoneNumbers, templates: d.templates, webhookConfigured: d.webhookConfigured }, actorId: actor.userId, organizationId: actor.organizationId });
  return d;
}

export const WHATSAPP_SEND_CONFIRMATION = "SEND TEST WHATSAPP";

/**
 * Sends ONE test message to WHATSAPP_TEST_RECIPIENT only. Free text only inside the 24h customer-service
 * window (that number wrote to us recently); otherwise an approved template (WHATSAPP_TEST_TEMPLATE).
 */
export async function whatsappSendTest(actor: Actor, confirmation: string) {
  if (confirmation !== WHATSAPP_SEND_CONFIRMATION) throw new UserFacingError("validation");
  const to = normalizePhone(clean(process.env.WHATSAPP_TEST_RECIPIENT));
  if (!to || to.length < 8) throw new UserFacingError("whatsapp_test_recipient_missing");
  if (!whatsappStatus().configured) throw new UserFacingError("integration_not_configured");
  const phoneNumberId = clean(process.env.WHATSAPP_PHONE_NUMBER_ID) || (await db.whatsAppNumber.findFirst({ where: { isActive: true }, select: { phoneNumberId: true } }))?.phoneNumberId;
  if (!phoneNumberId) throw new UserFacingError("integration_not_configured");
  const lastInbound = await db.message.findFirst({ where: { direction: "INBOUND", conversation: { channel: "WHATSAPP", externalThreadId: to } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const windowOpen = Boolean(lastInbound && Date.now() - lastInbound.createdAt.getTime() < 24 * 3_600_000);
  const template = { name: clean(process.env.WHATSAPP_TEST_TEMPLATE) || "hello_world", language: clean(process.env.WHATSAPP_TEST_TEMPLATE_LANG) || "en_US" };
  const started = Date.now();
  try {
    const token = clean(process.env.WHATSAPP_ACCESS_TOKEN);
    const r = windowOpen ? await waSendText(phoneNumberId, to, "NOVA WhatsApp integration test.", token) : await waSendTemplate(phoneNumberId, to, template, token);
    await recordValidation({ provider: "whatsapp", check: "send_test", ok: Boolean(r.externalId), detail: `${windowOpen ? "free text (24h window open)" : `template ${template.name}/${template.language}`} → accepted ${r.externalId ?? "(no id)"}`, durationMs: Date.now() - started, meta: { messageId: r.externalId, to: `…${to.slice(-4)}`, mode: windowOpen ? "text" : "template" }, actorId: actor.userId, organizationId: actor.organizationId });
    await audit({ category: "SECURITY", actorType: "USER", actorId: actor.userId, action: "admin.whatsapp_test_sent", summary: `WhatsApp test sent to …${to.slice(-4)}` });
    return { messageId: r.externalId, mode: windowOpen ? "text" : "template" };
  } catch (e) {
    const pe = providerErr(e);
    await recordValidation({ provider: "whatsapp", check: "send_test", ok: false, detail: pe.detail, httpStatus: pe.httpStatus, errorCode: pe.errorCode, durationMs: Date.now() - started, actorId: actor.userId, organizationId: actor.organizationId });
    throw new UserFacingError("integration_error", { cause: e });
  }
}

// ── Stripe ──

export type StripeDiagnostics = {
  configured: boolean;
  mode: "test" | "live" | null;
  apiReachable: boolean;
  prices: { plan: string; id: string | null; ok: boolean; detail: string }[];
  pricesValid: boolean;
  webhookConfigured: boolean;
  webhookDetail: string;
  summary: string;
  httpStatus: number | null;
  errorCode: string | null;
};

const WEBHOOK_EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"];

/** Read-only Stripe diagnostics: key, prices, registered webhook endpoint. Creates nothing. */
export async function stripeDiagnostics(): Promise<StripeDiagnostics> {
  const key = clean(process.env.STRIPE_SECRET_KEY);
  const out: StripeDiagnostics = { configured: Boolean(key), mode: key.includes("_live_") ? "live" : key ? "test" : null, apiReachable: false, prices: [], pricesValid: false, webhookConfigured: false, webhookDetail: "", summary: "", httpStatus: null, errorCode: null };
  if (!key) {
    out.summary = "Not configured (STRIPE_SECRET_KEY)";
    return out;
  }
  const h = { authorization: `Bearer ${key}` };
  const bal = await call("https://api.stripe.com/v1/balance", { headers: h });
  out.apiReachable = bal.status === 200;
  if (!out.apiReachable) {
    out.httpStatus = bal.status;
    out.errorCode = errCode(bal.body);
    out.summary = `API rejected the key: ${errText(bal.body)}`;
    return out;
  }
  for (const plan of ["STARTER", "GROWTH", "SCALE"]) {
    const id = clean(process.env[`STRIPE_PRICE_${plan}`]) || null;
    if (!id) {
      out.prices.push({ plan, id, ok: plan !== "GROWTH", detail: plan === "GROWTH" ? "missing (required)" : "not set" });
      continue;
    }
    const r = await call(`https://api.stripe.com/v1/prices/${encodeURIComponent(id)}`, { headers: h });
    const b = r.body as { active?: boolean; recurring?: unknown; currency?: string; unit_amount?: number; livemode?: boolean };
    const ok = r.status === 200 && Boolean(b.active) && Boolean(b.recurring) && (b.livemode ?? false) === (out.mode === "live");
    out.prices.push({ plan, id, ok, detail: r.status !== 200 ? errText(r.body) : !b.active ? "inactive" : !b.recurring ? "not recurring" : ok ? `${(b.unit_amount ?? 0) / 100} ${String(b.currency).toUpperCase()}/period` : "price mode doesn't match key mode" });
  }
  out.pricesValid = out.prices.every((p) => p.ok);
  const expectedUrl = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/webhooks/stripe`;
  const eps = await call("https://api.stripe.com/v1/webhook_endpoints?limit=100", { headers: h });
  const list = (eps.body.data as { url: string; status: string; enabled_events: string[] }[] | undefined) ?? [];
  const ep = list.find((e) => e.url === expectedUrl);
  const missingEvents = ep && !ep.enabled_events.includes("*") ? WEBHOOK_EVENTS.filter((e) => !ep.enabled_events.includes(e)) : [];
  out.webhookConfigured = Boolean(ep && ep.status === "enabled" && !missingEvents.length && clean(process.env.STRIPE_WEBHOOK_SECRET));
  out.webhookDetail = !ep ? `No endpoint registered for ${expectedUrl}` : ep.status !== "enabled" ? "Endpoint disabled" : missingEvents.length ? `Missing events: ${missingEvents.join(", ")}` : !clean(process.env.STRIPE_WEBHOOK_SECRET) ? "STRIPE_WEBHOOK_SECRET missing" : "Endpoint registered and enabled";
  out.summary = [`Key valid (${out.mode} mode)`, out.pricesValid ? "prices valid" : `prices: ${out.prices.filter((p) => !p.ok).map((p) => `${p.plan} ${p.detail}`).join(", ")}`, out.webhookDetail].join(" · ");
  return out;
}

// ── Email ──

export const EMAIL_TEST_SUBJECT = "NOVA email integration test";
export const EMAIL_TEST_BODY = "This is a live email delivery test from NOVA.";

/**
 * Sends ONE email to an address the admin typed. Order: the workspace's connected Gmail / Outlook mailbox,
 * then the platform provider. Records the provider's message id and "accepted" — not delivery or reading,
 * which providers don't report here.
 */
export async function sendTestEmail(scope: TenantScope, actor: Actor, to: string, via: "auto" | "platform" = "auto") {
  const { to: address } = safeMessage({ to, subject: EMAIL_TEST_SUBJECT, text: EMAIL_TEST_BODY });
  const started = Date.now();
  const box = via === "auto" ? await mailboxFor(scope) : null;
  const provider = box ? (box.provider === "GOOGLE" ? "gmail" : "outlook") : getMailer().name;
  try {
    let messageId: string | null = null;
    if (box) messageId = (await box.api.sendEmail(box.token, { to: address, subject: EMAIL_TEST_SUBJECT, text: EMAIL_TEST_BODY })).externalId;
    else {
      if (!getMailer().configured) throw new UserFacingError("email_not_configured");
      messageId = (await getMailer().send({ to: address, subject: EMAIL_TEST_SUBJECT, text: EMAIL_TEST_BODY }))?.messageId ?? null;
    }
    const dev = !box && /^(localhost|127\.0\.0\.1|mailpit)$/i.test(clean(process.env.SMTP_HOST)) && getMailer().name === "smtp";
    await recordValidation({ provider: "email", check: "send_test_email", ok: true, live: !dev, detail: `${provider}: accepted${messageId ? ` (${messageId})` : ""}${dev ? " — development mailbox" : ""}`, durationMs: Date.now() - started, meta: { provider, workspaceId: scope.workspaceId, messageId, status: "accepted", to: address.replace(/^(.).*(@.*)$/, "$1…$2") }, actorId: actor.userId, organizationId: scope.organizationId });
    await audit({ ...scope, category: "SECURITY", actorType: "USER", actorId: actor.userId, action: "admin.email_test_sent", summary: `Test email sent via ${provider}` });
    return { provider, messageId, status: "accepted" as const, developmentMailbox: dev };
  } catch (e) {
    if (e instanceof UserFacingError) {
      await recordValidation({ provider: "email", check: "send_test_email", ok: false, live: false, detail: e.code, errorCode: e.code, actorId: actor.userId, organizationId: scope.organizationId });
      throw e;
    }
    const pe = providerErr(e);
    await recordValidation({ provider: "email", check: "send_test_email", ok: false, detail: `${provider}: ${pe.detail}`, httpStatus: pe.httpStatus, errorCode: pe.errorCode, durationMs: Date.now() - started, actorId: actor.userId, organizationId: scope.organizationId });
    throw new UserFacingError("integration_error", { cause: e });
  }
}

// ── Calendar (Google / Microsoft connected in the admin's own workspace) ──

async function calendarIntegration(scope: TenantScope, integrationId: string) {
  const row = await db.integration.findFirst({ where: { ...scope, id: integrationId, provider: { in: ["GOOGLE", "MICROSOFT"] } }, include: { accounts: { where: { isActive: true }, take: 1 } } });
  if (!row || !row.accounts[0]) throw new UserFacingError("item_not_found");
  const provider = SOCIAL_PROVIDERS[providerIdFor(row.provider)];
  if (!isCalendar(provider)) throw new UserFacingError("capability_unavailable");
  const cal: CalendarApi = provider;
  return { row, account: row.accounts[0], cal, key: row.provider === "GOOGLE" ? "google" : "microsoft" };
}

async function workspaceTimezone(scope: TenantScope) {
  const s = await db.workspaceSettings.findFirst({ where: scope, select: { timezone: true } });
  if (s?.timezone && s.timezone !== "UTC") return s.timezone;
  return (await db.organization.findUnique({ where: { id: scope.organizationId }, select: { timezone: true } }))?.timezone ?? "UTC";
}

/** Reads free/busy for the next 24h. Creates nothing. Also proves the refresh token works. */
export async function calendarAvailabilityTest(scope: TenantScope, actor: Actor, integrationId: string) {
  const { row, account, cal, key } = await calendarIntegration(scope, integrationId);
  const timezone = await workspaceTimezone(scope);
  const started = Date.now();
  try {
    const fresh = await freshToken(row.id, account.id, { force: true });
    if (!fresh) throw new ProviderError("expired", "Refresh token rejected — reconnect the account");
    const from = new Date();
    const busy = await cal.freeBusy(fresh.token, { from, to: new Date(from.getTime() + 86_400_000), timezone });
    const detail = `free/busy read (${timezone}): ${busy.length} busy interval(s) in the next 24h · token ${fresh.refreshed ? "refreshed" : "still valid"}`;
    await recordValidation({ provider: key, check: "calendar_availability", ok: true, detail, durationMs: Date.now() - started, meta: { timezone, busy: busy.length, refreshed: fresh.refreshed }, actorId: actor.userId, organizationId: scope.organizationId });
    return { timezone, busy: busy.length, refreshed: fresh.refreshed };
  } catch (e) {
    const pe = providerErr(e);
    await recordValidation({ provider: key, check: "calendar_availability", ok: false, detail: pe.detail, httpStatus: pe.httpStatus, errorCode: pe.errorCode, durationMs: Date.now() - started, actorId: actor.userId, organizationId: scope.organizationId });
    throw new UserFacingError("integration_error", { cause: e });
  }
}

export const CALENDAR_TEST_CONFIRMATION = "CREATE TEST MEETING";

/**
 * Creates a 15-minute "NOVA Integration Test" event with no attendees in the connected calendar, then
 * cancels it immediately. Stores the external event id and both outcomes.
 */
export async function calendarMeetingTest(scope: TenantScope, actor: Actor, integrationId: string, confirmation: string) {
  if (confirmation !== CALENDAR_TEST_CONFIRMATION) throw new UserFacingError("validation");
  const { row, account, cal, key } = await calendarIntegration(scope, integrationId);
  const timezone = await workspaceTimezone(scope);
  const started = Date.now();
  const fresh = await freshToken(row.id, account.id);
  if (!fresh) throw new UserFacingError("integration_expired");
  const start = new Date(Math.ceil((Date.now() + 3_600_000) / 900_000) * 900_000);
  const end = new Date(start.getTime() + 15 * 60_000);
  let externalId: string | null = null;
  try {
    const created = await cal.createEvent(fresh.token, { title: "NOVA Integration Test", description: "Created and cancelled automatically by a NOVA admin integration test.", start, end, timezone, attendees: [] });
    externalId = created.externalId;
    let cancelled = false;
    let cancelError: string | null = null;
    try {
      await cal.cancelEvent(fresh.token, externalId);
      cancelled = true;
    } catch (e) {
      cancelError = providerErr(e).detail;
    }
    const ok = cancelled;
    await recordValidation({ provider: key, check: "calendar_meeting", ok, detail: `created ${externalId} (${start.toISOString()} ${timezone}, 15 min) · ${cancelled ? "cancelled" : `NOT cancelled: ${cancelError}`}`, durationMs: Date.now() - started, meta: { externalEventId: externalId, start: start.toISOString(), timezone, cancelled }, actorId: actor.userId, organizationId: scope.organizationId });
    await audit({ ...scope, category: "SECURITY", actorType: "USER", actorId: actor.userId, action: "admin.calendar_test", summary: `Calendar test event ${externalId} ${cancelled ? "created and cancelled" : "created (cancel failed)"}` });
    return { externalEventId: externalId, start: start.toISOString(), timezone, cancelled };
  } catch (e) {
    const pe = providerErr(e);
    await recordValidation({ provider: key, check: "calendar_meeting", ok: false, detail: `${externalId ? `created ${externalId}, then ` : ""}${pe.detail}`, httpStatus: pe.httpStatus, errorCode: pe.errorCode, durationMs: Date.now() - started, meta: { externalEventId: externalId }, actorId: actor.userId, organizationId: scope.organizationId });
    throw new UserFacingError("integration_error", { cause: e });
  }
}

/** Connected Google/Microsoft accounts in the admin's workspace, with what each can do (for the admin UI). */
export async function workspaceAccountDiagnostics(scope: TenantScope) {
  const rows = await db.integration.findMany({ where: { ...scope, provider: { in: ["GOOGLE", "MICROSOFT"] }, status: { not: "DISCONNECTED" } }, include: { accounts: { where: { isActive: true }, take: 1 } } });
  return rows.map((r) => {
    const provider = SOCIAL_PROVIDERS[providerIdFor(r.provider)];
    const caps = provider.capabilities?.({ platform: r.provider }, r.scopes) ?? [];
    const can = (k: string) => caps.some((c) => c.key === k && c.available);
    return {
      integrationId: r.id,
      provider: r.provider as "GOOGLE" | "MICROSOFT",
      account: r.accounts[0]?.handle ?? r.accounts[0]?.name ?? null,
      identity: can("identity"),
      emailSend: can("email_send") && isMailbox(provider),
      calendarRead: can("calendar_read"),
      calendarWrite: can("calendar_write"),
      reauthNeeded: r.status !== "CONNECTED",
    };
  });
}
