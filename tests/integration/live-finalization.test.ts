import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db/client";
import { makeTenant } from "../support/factory";
import { encryptSecret } from "@/server/crypto";
import { EmailConfigError, getMailer, safeMessage, setMailer, type Mailer } from "@/server/email/mailer";
import { callbackStatus, credentialFormat, productionBlockers, providerReadiness, redact, storageRoundtrip } from "@/server/admin/readiness";
import { calendarAvailabilityTest, calendarMeetingTest, sendTestEmail, stripeDiagnostics, whatsappDiagnostics, whatsappSendTest } from "@/server/admin/live-tests";
import { redirectUriFor } from "@/server/integrations/registry";
import { freshToken, startConnect } from "@/server/integrations/service";
import { setStorageDriver, type StorageDriver } from "@/server/storage";
import { handleStripeEvent } from "@/server/billing/stripe";
import { processWebhook } from "@/server/whatsapp/service";

/** LIVE INTEGRATIONS FINALIZATION — contracts with every provider mocked (no network, no spend, no publishing). */
const saved: Record<string, string | undefined> = {};
function env(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in saved)) saved[k] = process.env[k];
    process.env[k] = v;
  }
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
type Call = { url: string; method: string; body: string };
let calls: Call[] = [];
function mockFetch(handler: (url: string, init?: RequestInit) => Response | null) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? String(init.body) : "" });
    return handler(url, init) ?? json({ error: { message: `unmocked ${url}` } }, 500);
  }));
}
beforeEach(async () => {
  await db.providerValidation.deleteMany({});
});
afterEach(() => {
  vi.unstubAllGlobals();
  setMailer(null);
  setStorageDriver(null);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
});

describe("email: production safety + header injection", () => {
  it("rejects header injection and multi-recipient addresses; flattens the subject", () => {
    expect(() => safeMessage({ to: "a@b.test\r\nBcc: x@evil.test", subject: "s", text: "t" })).toThrow(EmailConfigError);
    expect(() => safeMessage({ to: "a@b.test, c@d.test", subject: "s", text: "t" })).toThrow(EmailConfigError);
    expect(() => safeMessage({ to: "a@b.test", replyTo: "x@y.test\nBcc: z", subject: "s", text: "t" })).toThrow(EmailConfigError);
    expect(safeMessage({ to: " a@b.test ", subject: "Hi\r\nBcc: x@evil.test", text: "t" })).toMatchObject({ to: "a@b.test", subject: "Hi Bcc: x@evil.test" });
  });

  it("production never falls back to Mailpit and fails clearly when no provider is configured", async () => {
    env({ NODE_ENV: "production", EMAIL_PROVIDER: "smtp", SMTP_HOST: "localhost" });
    setMailer(null);
    expect(getMailer().configured).toBe(false);
    await expect(getMailer().send({ to: "a@b.test", subject: "Magic link", text: "x" })).rejects.toMatchObject({ code: "email_not_configured" });
    env({ EMAIL_PROVIDER: "", SMTP_HOST: "" });
    setMailer(null);
    await expect(getMailer().send({ to: "a@b.test", subject: "Reset", text: "x" })).rejects.toBeInstanceOf(EmailConfigError);
  });

  it("Resend returns the provider message id; the admin test records it as 'accepted' (not delivered)", async () => {
    env({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_key_1234567890", SMTP_HOST: "" });
    setMailer(null);
    mockFetch((url) => (url === "https://api.resend.com/emails" ? json({ id: "resend-msg-123" }) : null));
    const t = await makeTenant();
    const r = await sendTestEmail(t.scope, { userId: t.user.id }, "ops@company.test");
    expect(r).toEqual({ provider: "resend", messageId: "resend-msg-123", status: "accepted", developmentMailbox: false });
    const sent = JSON.parse(calls[0].body);
    expect(sent).toMatchObject({ to: ["ops@company.test"], subject: "NOVA email integration test", text: "This is a live email delivery test from NOVA." });
    const v = await db.providerValidation.findFirstOrThrow({ where: { provider: "email", check: "send_test_email" } });
    expect(v).toMatchObject({ ok: true, live: true });
    expect(v.meta).toMatchObject({ provider: "resend", messageId: "resend-msg-123", status: "accepted", workspaceId: t.workspace.id });
  });

  it("a development mailbox test is recorded but never counts as live", async () => {
    env({ EMAIL_PROVIDER: "smtp", SMTP_HOST: "localhost" });
    const fake: Mailer = { name: "smtp", configured: true, send: async () => ({ messageId: "<dev@mailpit>" }), testConnection: async () => ({ ok: true, detail: "dev" }) };
    setMailer(fake);
    const t = await makeTenant();
    const r = await sendTestEmail(t.scope, { userId: t.user.id }, "me@company.test", "platform");
    expect(r.developmentMailbox).toBe(true);
    expect((await db.providerValidation.findFirstOrThrow({ where: { check: "send_test_email" } })).live).toBe(false);
  });
});

describe("readiness: credential format, callbacks, blockers", () => {
  it("catches credentials pasted in the wrong place", () => {
    expect(credentialFormat("openai", { OPENAI_API_KEY: "not-a-key" } as unknown as NodeJS.ProcessEnv)).toEqual(["OPENAI_API_KEY: expected an sk-… API key"]);
    expect(credentialFormat("openai", {} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(credentialFormat("stripe", { STRIPE_SECRET_KEY: "sk_test_abcdefghijkl", STRIPE_PUBLISHABLE_KEY: "pk_live_abcdefghijkl", STRIPE_WEBHOOK_SECRET: "whsec_abcdefghijkl", STRIPE_PRICE_GROWTH: "prod_123" } as unknown as NodeJS.ProcessEnv)).toEqual(["STRIPE_PRICE_GROWTH: expected price_…", "STRIPE keys: secret and publishable keys are from different modes"]);
    expect(credentialFormat("whatsapp", { WHATSAPP_ACCESS_TOKEN: "EAAG" + "x".repeat(30), WHATSAPP_APP_SECRET: "short", WHATSAPP_PHONE_NUMBER_ID: "12ab" } as unknown as NodeJS.ProcessEnv)).toEqual(["WHATSAPP_APP_SECRET: expected the 32-character app secret", "WHATSAPP_PHONE_NUMBER_ID: expected a numeric phone_number_id"]);
    expect(credentialFormat("microsoft", { MICROSOFT_CLIENT_ID: "11111111-2222-3333-4444-555555555555", MICROSOFT_CLIENT_SECRET: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" } as unknown as NodeJS.ProcessEnv)).toEqual(["MICROSOFT_CLIENT_SECRET: looks like a secret ID, not the secret value"]);
    expect(credentialFormat("email", { SMTP_HOST: "localhost" } as unknown as NodeJS.ProcessEnv)).toEqual(["SMTP_HOST: development mailbox (Mailpit) — not a real provider"]);
  });

  it("localhost callbacks are dev-only; staging/production require public HTTPS", () => {
    const dev = callbackStatus("linkedin", { APP_URL: "http://localhost:3000", NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv);
    expect(dev).toMatchObject({ ok: false, blockers: [] });
    const staging = callbackStatus("linkedin", { APP_URL: "http://staging.nova.test", APP_ENV: "staging" } as unknown as NodeJS.ProcessEnv);
    expect(staging.blockers).toEqual(["linkedin: not_https"]);
    expect(callbackStatus("stripe", { APP_URL: "https://staging.nova.test", APP_ENV: "staging" } as unknown as NodeJS.ProcessEnv)).toMatchObject({ ok: true, entries: [{ url: "https://staging.nova.test/api/webhooks/stripe" }] });
    expect(productionBlockers("stripe", { configured: true, formatProblems: [], liveTested: true, callbacksOk: true }, { STRIPE_SECRET_KEY: "sk_test_x" } as unknown as NodeJS.ProcessEnv)).toEqual(["stripe_test_mode"]);
    expect(productionBlockers("facebook", { configured: true, formatProblems: [], liveTested: false, callbacksOk: false })).toEqual(["not_live_validated", "external_review", "https_callbacks"]);
  });

  it("outside development an http/localhost OAuth callback is refused before contacting the provider", async () => {
    env({ APP_ENV: "staging", APP_URL: "http://localhost:3000", LINKEDIN_REDIRECT_URI: "" });
    expect(() => redirectUriFor("linkedin")).toThrow(/public https/);
    const t = await makeTenant();
    const before = await db.oAuthState.count();
    await expect(startConnect(t.scope, t.user.id, "linkedin")).rejects.toMatchObject({ code: "integration_not_configured" });
    expect(await db.oAuthState.count()).toBe(before);
    env({ APP_URL: "https://staging.nova.test" });
    expect(redirectUriFor("linkedin")).toBe("https://staging.nova.test/api/integrations/linkedin/callback");
  });

  it("the readiness row carries incident detail without secrets", async () => {
    mockFetch(() => json({ error: { message: "Incorrect API key provided: sk-proj-abcdefghijklmnopqrstuvwx", code: "invalid_api_key", type: "invalid_request_error" } }, 401));
    env({ OPENAI_API_KEY: "sk-proj-abcdefghijklmnopqrstuvwx" });
    const { validateCredentials } = await import("@/server/admin/readiness");
    const row = await validateCredentials("openai", { userId: "admin" });
    expect(row).toMatchObject({ ok: false, httpStatus: 401, errorCode: "invalid_api_key" });
    expect(JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("abcdefghijklmnopqrstuvwx");
    const r = (await providerReadiness()).find((x) => x.provider === "openai")!;
    expect(r.lastError).toMatchObject({ httpStatus: 401, errorCode: "invalid_api_key", correlationId: row.id });
    expect(r.liveTested).toBe(false);
    expect(redact("code=4/0AbCd&state=x Authorization: Bearer ya29.a0Af whsec_abc123")).not.toMatch(/0AbCd|ya29\.a0Af|abc123/);
  });

  it("storage test removes its object and confirms deletion", async () => {
    const objects = new Map<string, Buffer>();
    setStorageDriver({ name: "memory-s3", put: async (k, d) => void objects.set(k, d), get: async (k) => { const b = objects.get(k); if (!b) throw new Error("NoSuchKey"); return b; }, delete: async (k) => void objects.delete(k) } satisfies StorageDriver);
    const r = await storageRoundtrip({ userId: "admin" });
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.step)).toEqual(["upload", "read (local driver: signed app URLs)", "delete", "confirm_deleted"]);
    expect(objects.size).toBe(0);
  });
});

describe("WhatsApp: diagnostics + guarded send", () => {
  const waEnv = () => env({ WHATSAPP_ACCESS_TOKEN: "EAAG" + "t".repeat(30), WHATSAPP_APP_SECRET: "0123456789abcdef0123456789abcdef", WHATSAPP_VERIFY_TOKEN: "verify-token-123", WHATSAPP_PHONE_NUMBER_ID: "1098765432101", WHATSAPP_BUSINESS_ACCOUNT_ID: "2098765432101", WHATSAPP_TEST_RECIPIENT: "+20 100 222 3333" });
  const graph = (url: string) => {
    if (/\/me\?/.test(url)) return json({ id: "sys-user", name: "NOVA System User" });
    if (/\/1098765432101\?fields=/.test(url)) return json({ id: "1098765432101", display_phone_number: "+20 100 000 0000", verified_name: "NOVA Test", quality_rating: "GREEN", code_verification_status: "VERIFIED", name_status: "APPROVED", status: "CONNECTED" });
    if (/message_templates/.test(url)) return json({ data: [{ name: "hello_world", status: "APPROVED" }, { name: "promo", status: "REJECTED" }] });
    if (/subscribed_apps/.test(url)) return json({ data: [{ whatsapp_business_api_data: { id: "app" } }] });
    if (/\/1098765432101\/messages$/.test(url)) return json({ messages: [{ id: "wamid.TEST1" }] });
    return null;
  };

  it("diagnostics: token, phone status, templates, webhook subscription — sends nothing", async () => {
    waEnv();
    mockFetch(graph);
    const d = await whatsappDiagnostics();
    expect(d).toMatchObject({ configured: true, tokenValid: true, messaging: true, webhookConfigured: true, templates: { total: 2, approved: 1 } });
    expect(d.phoneNumbers[0]).toMatchObject({ id: "1098765432101", verifiedName: "NOVA Test", quality: "GREEN", ok: true });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("send test: typed confirmation, configured test number only, template outside the 24h window", async () => {
    waEnv();
    mockFetch(graph);
    await expect(whatsappSendTest({ userId: "admin" }, "yes")).rejects.toMatchObject({ code: "validation" });
    const r = await whatsappSendTest({ userId: "admin" }, "SEND TEST WHATSAPP");
    expect(r).toEqual({ messageId: "wamid.TEST1", mode: "template" });
    const body = JSON.parse(calls.find((c) => c.method === "POST")!.body);
    expect(body).toMatchObject({ to: "201002223333", type: "template", template: { name: "hello_world", language: { code: "en_US" } } });
    env({ WHATSAPP_TEST_RECIPIENT: "" });
    await expect(whatsappSendTest({ userId: "admin" }, "SEND TEST WHATSAPP")).rejects.toMatchObject({ code: "whatsapp_test_recipient_missing" });
  });

  it("webhook routes each number to its own workspace and never duplicates a lead", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await db.whatsAppNumber.create({ data: { ...a.scope, phoneNumberId: "PNA-1" } });
    await db.whatsAppNumber.create({ data: { ...b.scope, phoneNumberId: "PNB-1" } });
    const msg = (pn: string, id: string) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: pn }, contacts: [{ wa_id: "201009990000", profile: { name: "Same Person" } }], messages: [{ from: "201009990000", id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "hi" } }] } }] }] });
    await processWebhook(msg("PNA-1", "wamid.A1"));
    await processWebhook(msg("PNA-1", "wamid.A2"));
    await processWebhook(msg("PNB-1", "wamid.B1"));
    expect(await db.lead.count({ where: a.scope })).toBe(1);
    expect(await db.lead.count({ where: b.scope })).toBe(1);
    expect(await db.message.count({ where: a.scope })).toBe(2);
  });
});

describe("Stripe: diagnostics + webhook hardening", () => {
  it("diagnostics check key mode, prices and the registered webhook endpoint — create nothing", async () => {
    env({ STRIPE_SECRET_KEY: "sk_test_abcdefghijkl", STRIPE_WEBHOOK_SECRET: "whsec_abcdefghijkl", STRIPE_PRICE_GROWTH: "price_growth123", STRIPE_PRICE_STARTER: "", STRIPE_PRICE_SCALE: "", APP_URL: "https://staging.nova.test" });
    mockFetch((url) => {
      if (url.endsWith("/v1/balance")) return json({ available: [] });
      if (url.includes("/v1/prices/price_growth123")) return json({ active: true, recurring: { interval: "month" }, currency: "sar", unit_amount: 49900, livemode: false });
      if (url.includes("/v1/webhook_endpoints")) return json({ data: [{ url: "https://staging.nova.test/api/webhooks/stripe", status: "enabled", enabled_events: ["*"] }] });
      return null;
    });
    const d = await stripeDiagnostics();
    expect(d).toMatchObject({ mode: "test", apiReachable: true, pricesValid: true, webhookConfigured: true });
    expect(d.prices.find((p) => p.plan === "GROWTH")?.detail).toBe("499 SAR/period");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("payment_failed marks the subscription past due (re-read from Stripe) and replays are ignored", async () => {
    env({ STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_PRICE_GROWTH: "price_growth" });
    const t = await makeTenant();
    await db.subscription.update({ where: { organizationId: t.organization.id }, data: { billingProvider: "stripe", providerCustomerId: "cus_pf1", providerSubscriptionId: "sub_pf1", status: "ACTIVE", plan: "GROWTH" } });
    mockFetch((url) => (url.includes("/v1/subscriptions/sub_pf1") ? json({ id: "sub_pf1", customer: "cus_pf1", status: "past_due", cancel_at_period_end: false, current_period_end: 1_900_000_000, items: { data: [{ id: "si", price: { id: "price_growth" } }] } }) : null));
    const ev = { id: "evt_pf1", type: "invoice.payment_failed", created: 1, data: { object: { id: "in_pf1", customer: "cus_pf1", status: "open", amount_due: 4900, amount_paid: 0, currency: "usd", subscription: "sub_pf1" } } };
    expect(await handleStripeEvent(ev)).toBe("processed");
    expect((await db.subscription.findUniqueOrThrow({ where: { organizationId: t.organization.id } })).status).toBe("PAST_DUE");
    expect(await handleStripeEvent(ev)).toBe("duplicate");
    expect(await db.invoice.count({ where: { providerInvoiceId: "in_pf1" } })).toBe(1);
  });
});

describe("Google/Microsoft tokens + calendar live tests (mocked)", () => {
  async function googleCalendar(t: Awaited<ReturnType<typeof makeTenant>>, expiresInMs: number) {
    const integration = await db.integration.create({ data: { ...t.scope, provider: "GOOGLE", status: "CONNECTED", scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.freebusy", "https://www.googleapis.com/auth/calendar.events"] } });
    const account = await db.integrationAccount.create({ data: { ...t.scope, integrationId: integration.id, platform: "GOOGLE", externalId: "g-1", name: "Ops", handle: "ops@company.test", isActive: true } });
    await db.integrationCredential.create({ data: { ...t.scope, integrationId: integration.id, accountId: null, accessTokenEnc: encryptSecret("old-access"), refreshTokenEnc: encryptSecret("1//refresh"), expiresAt: new Date(Date.now() + expiresInMs) } });
    return { integration, account };
  }
  const google = (url: string, init?: RequestInit) => {
    if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "new-access", expires_in: 3600 });
    if (url.startsWith("https://www.googleapis.com/calendar/v3/freeBusy")) return json({ calendars: { primary: { busy: [{ start: "2030-01-01T10:00:00Z", end: "2030-01-01T11:00:00Z" }] } } });
    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events") && init?.method === "POST") return json({ id: "evt-test-1" });
    if (url.includes("/events/evt-test-1") && init?.method === "DELETE") return new Response(null, { status: 204 });
    return null;
  };

  it("an expiring token is refreshed on use and re-encrypted", async () => {
    env({ GOOGLE_CLIENT_ID: "1-abc.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "s" });
    const t = await makeTenant();
    const { integration, account } = await googleCalendar(t, 30_000);
    mockFetch(google);
    const f = await freshToken(integration.id, account.id);
    expect(f).toMatchObject({ refreshed: true, token: { accessToken: "new-access" } });
    const cred = await db.integrationCredential.findFirstOrThrow({ where: { integrationId: integration.id }, omit: { accessTokenEnc: false } });
    expect(cred.accessTokenEnc).not.toContain("new-access");
    expect((await freshToken(integration.id, account.id))?.refreshed).toBe(false);
  });

  it("availability reads free/busy (creates nothing); the meeting test creates and cancels a 15-minute event", async () => {
    env({ GOOGLE_CLIENT_ID: "1-abc.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "s" });
    const t = await makeTenant();
    const { integration } = await googleCalendar(t, 3_600_000);
    mockFetch(google);
    const a = await calendarAvailabilityTest(t.scope, { userId: t.user.id }, integration.id);
    expect(a).toMatchObject({ busy: 1, refreshed: true });
    expect(calls.some((c) => c.url.includes("/events"))).toBe(false);

    await expect(calendarMeetingTest(t.scope, { userId: t.user.id }, integration.id, "yes")).rejects.toMatchObject({ code: "validation" });
    const m = await calendarMeetingTest(t.scope, { userId: t.user.id }, integration.id, "CREATE TEST MEETING");
    expect(m).toMatchObject({ externalEventId: "evt-test-1", cancelled: true });
    const created = JSON.parse(calls.find((c) => c.method === "POST" && c.url.includes("/events"))!.body);
    expect(created.summary).toBe("NOVA Integration Test");
    expect(created.attendees).toEqual([]);
    expect((new Date(created.end.dateTime).getTime() - new Date(created.start.dateTime).getTime()) / 60_000).toBe(15);
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("evt-test-1"))).toBe(true);
    const v = await db.providerValidation.findFirstOrThrow({ where: { provider: "google", check: "calendar_meeting" } });
    expect(v.meta).toMatchObject({ externalEventId: "evt-test-1", cancelled: true });
    // Another workspace can't run tests on this calendar.
    const other = await makeTenant();
    await expect(calendarAvailabilityTest(other.scope, { userId: other.user.id }, integration.id)).rejects.toMatchObject({ code: "item_not_found" });
  });

  it("a Google webhook-style signature helper exists for WhatsApp (constant-time)", () => {
    env({ WHATSAPP_APP_SECRET: "0123456789abcdef0123456789abcdef" });
    const body = "{}";
    const sig = `sha256=${createHmac("sha256", "0123456789abcdef0123456789abcdef").update(body).digest("hex")}`;
    return import("@/server/whatsapp/cloud-api").then(({ verifySignature }) => {
      expect(verifySignature(body, sig)).toBe(true);
      expect(verifySignature(body, sig.replace(/.$/, "0"))).toBe(false);
    });
  });
});
