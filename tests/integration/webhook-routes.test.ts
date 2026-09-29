import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { POST as stripeWebhook } from "@/app/api/webhooks/stripe/route";
import { GET as waVerify, POST as waWebhook } from "@/app/api/webhooks/whatsapp/route";

/**
 * Route-level webhook behaviour (the HTTP contract providers rely on): signatures, size limits, duplicates
 * acknowledged without reprocessing, request ids echoed. No provider is called.
 */
const saved: Record<string, string | undefined> = {};
function env(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in saved)) saved[k] = process.env[k];
    process.env[k] = v;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
});

const STRIPE_SECRET = "whsec_route_test_0123456789abcdef";
const stripeSig = (payload: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", STRIPE_SECRET).update(`${t}.${payload}`).digest("hex")}`;
const req = (url: string, body: string, headers: Record<string, string>) => new NextRequest(url, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

describe("Stripe webhook route", () => {
  it("rejects unsigned/forged/stale payloads, acknowledges a duplicate delivery exactly once", async () => {
    env({ STRIPE_SECRET_KEY: "sk_test_route", STRIPE_WEBHOOK_SECRET: STRIPE_SECRET });
    // Stripe must never be called for an event type NOVA ignores.
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
    const id = `evt_route_${Date.now()}`;
    const payload = JSON.stringify({ id, type: "customer.created", created: Math.floor(Date.now() / 1000), data: { object: { id: "cus_x" } } });
    const url = "http://localhost/api/webhooks/stripe";

    expect((await stripeWebhook(req(url, payload, {}))).status).toBe(400);
    expect((await stripeWebhook(req(url, payload, { "stripe-signature": "t=1,v1=deadbeef" }))).status).toBe(400);
    expect((await stripeWebhook(req(url, payload, { "stripe-signature": stripeSig(payload, Math.floor(Date.now() / 1000) - 3600) }))).status).toBe(400);
    expect((await stripeWebhook(req(url, "x".repeat(10), { "stripe-signature": stripeSig("x".repeat(10)), "content-length": "2000000" }))).status).toBe(413);

    const first = await stripeWebhook(req(url, payload, { "stripe-signature": stripeSig(payload), "x-request-id": "req-stripe-0001" }));
    expect(first.status).toBe(200);
    expect(first.headers.get("x-request-id")).toBe("req-stripe-0001");
    const again = await stripeWebhook(req(url, payload, { "stripe-signature": stripeSig(payload) }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ received: true, outcome: "duplicate" });
    expect(await db.billingEvent.count({ where: { externalId: id } })).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("WhatsApp webhook route", () => {
  const APP_SECRET = "route-test-app-secret-0123456789ab";
  const waSig = (body: string) => `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;

  it("subscription check echoes the challenge only with the right verify token", async () => {
    env({ WHATSAPP_VERIFY_TOKEN: "route-verify-token-123", WHATSAPP_APP_SECRET: APP_SECRET });
    const ok = await waVerify(new NextRequest("http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=route-verify-token-123&hub.challenge=4242"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("4242");
    const bad = await waVerify(new NextRequest("http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=4242"));
    expect(bad.status).toBe(403);
  });

  it("rejects unsigned deliveries and ignores numbers no tenant owns", async () => {
    env({ WHATSAPP_VERIFY_TOKEN: "route-verify-token-123", WHATSAPP_APP_SECRET: APP_SECRET });
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA-X", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PN-NOBODY-OWNS", display_phone_number: "000" }, contacts: [{ wa_id: "966500009999", profile: { name: "Stranger" } }], messages: [{ id: `wamid.route.${Date.now()}`, from: "966500009999", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "hello" } }] } }] }] });
    const url = "http://localhost/api/webhooks/whatsapp";
    expect((await waWebhook(req(url, body, {}))).status).toBe(401);
    expect((await waWebhook(req(url, body, { "x-hub-signature-256": "sha256=00" }))).status).toBe(401);
    const leadsBefore = await db.lead.count();
    const res = await waWebhook(req(url, body, { "x-hub-signature-256": waSig(body) }));
    expect(res.status).toBe(200);
    expect(await db.lead.count()).toBe(leadsBefore);
    expect((await waWebhook(req(url, "not json", { "x-hub-signature-256": waSig("not json") }))).status).toBe(400);
  });
});
