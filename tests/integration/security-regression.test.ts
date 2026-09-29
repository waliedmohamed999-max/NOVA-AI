import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as ready } from "@/app/api/ready/route";
import { POST as cronTick } from "@/app/api/cron/tick/route";
import { POST as stripeWebhook } from "@/app/api/webhooks/stripe/route";
import { POST as waWebhook } from "@/app/api/webhooks/whatsapp/route";
import { resetHealthCaches } from "@/server/health";

/** Security regression: every machine endpoint fails CLOSED when its secret is missing or wrong. */
const saved: Record<string, string | undefined> = {};
function env(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    if (!(k in saved)) saved[k] = process.env[k];
    process.env[k] = v;
  }
}
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
  resetHealthCaches();
});
const post = (url: string, body: string, headers: Record<string, string> = {}) => new NextRequest(url, { method: "POST", body, headers });

describe("fail-closed machine endpoints", () => {
  it("/api/ready shows details only with the right bearer token", async () => {
    env({ READY_TOKEN: "ready-token-for-tests-0123456789" });
    const pub = await (await ready(new NextRequest("http://localhost/api/ready"))).json();
    expect(Object.values(pub.checks).every((c) => Object.keys(c as object).join() === "status")).toBe(true);
    const wrong = await (await ready(new NextRequest("http://localhost/api/ready", { headers: { authorization: "Bearer nope" } }))).json();
    expect(JSON.stringify(wrong)).not.toContain("detail");
    const full = await (await ready(new NextRequest("http://localhost/api/ready", { headers: { authorization: "Bearer ready-token-for-tests-0123456789" } }))).json();
    expect(full.checks.database).toHaveProperty("ms");
    expect(JSON.stringify(full)).not.toContain("ready-token-for-tests");
  });

  it("cron tick refuses without CRON_SECRET, even when the secret is unset", async () => {
    env({ CRON_SECRET: "" });
    expect((await cronTick(post("http://localhost/api/cron/tick", "", { authorization: "Bearer " }))).status).toBe(401);
    env({ CRON_SECRET: "cron-secret-for-tests" });
    expect((await cronTick(post("http://localhost/api/cron/tick", ""))).status).toBe(401);
    expect((await cronTick(post("http://localhost/api/cron/tick", "", { authorization: "Bearer wrong" }))).status).toBe(401);
  });

  it("Stripe webhook can't be bypassed when the webhook secret is unset", async () => {
    env({ STRIPE_WEBHOOK_SECRET: "" });
    const body = JSON.stringify({ id: "evt_bypass", type: "customer.subscription.updated", data: { object: {} } });
    const t = Math.floor(Date.now() / 1000);
    const emptyKeySig = `t=${t},v1=${createHmac("sha256", "").update(`${t}.${body}`).digest("hex")}`;
    expect((await stripeWebhook(post("http://localhost/api/webhooks/stripe", body, { "stripe-signature": emptyKeySig }))).status).toBe(400);
  });

  it("WhatsApp webhook can't be bypassed when the app secret is unset", async () => {
    env({ WHATSAPP_APP_SECRET: "" });
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const emptyKeySig = `sha256=${createHmac("sha256", "").update(body).digest("hex")}`;
    expect((await waWebhook(post("http://localhost/api/webhooks/whatsapp", body, { "x-hub-signature-256": emptyKeySig }))).status).toBe(401);
  });
});
