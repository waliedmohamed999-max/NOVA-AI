import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { completeOnboarding, resetAuthRateLimits, signUp, uniqueEmail } from "./helpers";

/**
 * WhatsApp Business end to end. The dev server runs with WHATSAPP_FAKE_TRANSPORT=true (never in production):
 * outbound Graph calls go to a recorder, nothing reaches Meta. Inbound messages are real signed webhooks
 * (WHATSAPP_APP_SECRET = E2E_WA_SECRET). Meta's template approval is simulated in the database (the only
 * step Meta itself performs).
 */

const SECRET = process.env.E2E_WA_SECRET ?? "e2e-whatsapp-secret-0123456789abcdef";

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(query, params)).rows as T[];
  } finally {
    await client.end();
  }
}

async function start(page: Page, company: string) {
  await resetAuthRateLimits();
  await signUp(page, "Wa Owner", uniqueEmail("wa"));
  await completeOnboarding(page, company);
  await page.goto("/whatsapp");
  await expect(page.getByTestId("wa-empty")).toContainText("Start your WhatsApp conversations");
  await page.getByTestId("wa-connect").click();
  await expect(page.getByTestId("wa-connection")).toContainText("Connected"); // the page refreshes into the connected view
  const [n] = await sql<{ phoneNumberId: string; organizationId: string; workspaceId: string }>(`SELECT "phoneNumberId", "organizationId", "workspaceId" FROM whatsapp_numbers WHERE "isActive" ORDER BY "createdAt" DESC LIMIT 1`);
  return n;
}

let seq = 0;
async function inbound(page: Page, phoneNumberId: string, from: string, text: string, at = new Date()) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: from, profile: { name: `Customer ${from.slice(-4)}` } }], messages: [{ from, id: `wamid.e2e.${Date.now()}.${++seq}`, timestamp: String(Math.floor(at.getTime() / 1000)), type: "text", text: { body: text } }] } }] }],
  });
  const sig = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
  const res = await page.request.post("/api/webhooks/whatsapp", { data: body, headers: { "content-type": "application/json", "x-hub-signature-256": sig } });
  expect(res.status()).toBe(200);
}

async function lead(scope: { organizationId: string; workspaceId: string }, name: string, phone: string, tags: string[]) {
  await sql(`INSERT INTO leads (id, "organizationId", "workspaceId", name, phone, tags, "updatedAt") VALUES ('e2e' || md5(random()::text), $1, $2, $3, $4, $5, now())`, [scope.organizationId, scope.workspaceId, name, phone, tags]);
}

async function openConversation(page: Page, name: RegExp | string) {
  await page.goto("/whatsapp/inbox");
  await page.getByTestId("wa-conversations").getByRole("button", { name }).first().click();
  await expect(page.getByTestId("wa-thread")).toBeVisible();
}

test.describe("WhatsApp Business", () => {
  test("flow 1: connect → inbound message → lead + conversation → NOVA drafts from the brain → a human sends", async ({ page }) => {
    const n = await start(page, "Wa Inbox Co");
    await expect(page.getByTestId("wa-connection")).toContainText("Connected");
    await sql(`INSERT INTO brain_faqs (id, "organizationId", "workspaceId", question, answer, status, "updatedAt") VALUES ('e2e' || md5(random()::text), $1, $2, 'What are your working hours?', 'We are open Sunday to Thursday, 9am to 6pm.', 'approved', now())`, [n.organizationId, n.workspaceId]);

    await inbound(page, n.phoneNumberId, "966501110001", "What are your working hours?");
    const leads = await sql<{ name: string; channel: string }>(`SELECT name, channel FROM leads WHERE "workspaceId" = $1 AND "phoneDigits" = '966501110001'`, [n.workspaceId]);
    expect(leads).toEqual([{ name: "Customer 0001", channel: "WHATSAPP" }]);

    await openConversation(page, /Customer 0001/);
    await expect(page.getByTestId("wa-thread")).toContainText("What are your working hours?");
    // The reply job (inline worker) prepares a draft from the approved FAQ — default level: drafts only.
    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("wa-draft")).toContainText("Sunday to Thursday", { timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await page.getByTestId("wa-send-draft").click();
    await expect(page.getByTestId("wa-thread")).toContainText("AI-assisted");
    await expect(page.getByTestId("wa-draft")).toHaveCount(0);
    const sent = await sql<{ status: string; aiDrafted: boolean }>(`SELECT status, "aiDrafted" FROM messages WHERE "workspaceId" = $1 AND direction = 'OUTBOUND'`, [n.workspaceId]);
    expect(sent).toEqual([{ status: "SENT", aiDrafted: true }]);

    // Customer context panel = the same CRM lead.
    await expect(page.getByTestId("wa-context")).toContainText("Customer 0001");
  });

  test("flow 2: template → campaign wizard (audience, template, review) → approval → queued batches → completed", async ({ page }) => {
    const n = await start(page, "Wa Campaign Co");
    await lead(n, "Buyer One", "+966 50 222 0001", ["promo"]);
    await lead(n, "Buyer Two", "+966502220002", ["promo"]);
    await lead(n, "Unreachable", "+966502230000", ["promo"]); // the test transport rejects numbers ending 0000

    // Template: draft → submitted to Meta (PENDING) → Meta approves (simulated in DB).
    await page.goto("/whatsapp/templates");
    await page.getByTestId("wa-new-template").click();
    await page.getByTestId("tpl-name").fill("promo_offer");
    await page.getByTestId("tpl-body").fill("Hi {{1}}, our new offer is live.");
    await expect(page.getByTestId("tpl-preview")).toContainText("Hi Sara, our new offer is live.");
    await page.getByRole("button", { name: "Submit to Meta" }).click();
    await page.getByRole("button", { name: /Submit to Meta ✓/ }).click();
    await expect(page.getByRole("tab", { name: /Pending 1/ })).toBeVisible();
    await sql(`UPDATE whatsapp_templates SET status = 'APPROVED' WHERE "workspaceId" = $1 AND name = 'promo_offer'`, [n.workspaceId]);

    await page.goto("/whatsapp/campaigns/new");
    await page.getByTestId("wz-name").fill("Autumn offer");
    await page.getByTestId("wz-next").click();
    await page.getByTestId("wz-tags").fill("promo");
    await page.getByTestId("wz-tags").press("Enter");
    await expect(page.getByTestId("wz-eligible")).toHaveText("3");
    await page.getByTestId("wz-next").click();
    await page.getByTestId("wz-tpl-promo_offer").click();
    await page.getByTestId("wz-next").click();
    await expect(page.getByTestId("wz-sample")).toContainText("our new offer is live");
    await page.getByTestId("wz-next").click();
    await page.getByTestId("wz-next").click();
    await expect(page.getByText("Nothing is sent until the campaign is approved.")).toBeVisible();
    await page.getByTestId("wz-submit").click();
    await expect(page.getByTestId("wz-result")).toContainText("Sent for approval");
    expect((await sql(`SELECT 1 FROM campaign_recipients r JOIN campaigns c ON c.id = r."campaignId" WHERE c."workspaceId" = $1`, [n.workspaceId])).length).toBe(0); // nothing before approval

    await page.goto("/approvals");
    const card = page.locator("li").filter({ hasText: "WhatsApp: Autumn offer" }).first();
    await card.getByRole("button", { name: "Approve", exact: true }).click();

    await page.goto("/whatsapp/campaigns");
    await page.getByRole("link", { name: /Autumn offer/ }).click();
    await page.waitForURL(/\/whatsapp\/campaigns\/c/);
    await expect(async () => {
      await page.reload();
      await expect(page.getByTestId("wa-campaign")).toContainText("Completed", { timeout: 2000 });
    }).toPass({ timeout: 45_000 });
    const rows = await sql<{ status: string; n: number }>(`SELECT r.status, count(*)::int AS n FROM campaign_recipients r JOIN campaigns c ON c.id = r."campaignId" WHERE c."workspaceId" = $1 GROUP BY r.status ORDER BY r.status`, [n.workspaceId]);
    expect(rows).toEqual([{ status: "FAILED", n: 1 }, { status: "SENT", n: 2 }]);
  });

  test("flow 3: outside the 24h window free text is blocked and an approved template is required", async ({ page }) => {
    const n = await start(page, "Wa Window Co");
    await inbound(page, n.phoneNumberId, "966503330003", "Hello from last week", new Date(Date.now() - 48 * 3600_000));
    await openConversation(page, /Customer 0003/);
    await expect(page.getByTestId("wa-window-closed")).toContainText("The conversation window has ended. Choose an approved template to send a message.");
    await expect(page.getByTestId("wa-composer")).toHaveCount(0);
    await expect(page.getByText("No approved templates yet.")).toBeVisible();
  });

  test("flow 4: a customer who sent STOP is excluded from campaigns (with the reason)", async ({ page }) => {
    const n = await start(page, "Wa Optout Co");
    await lead(n, "Stays", "+966504440001", ["vip"]);
    await lead(n, "Leaves", "+966504440002", ["vip"]);
    await inbound(page, n.phoneNumberId, "966504440002", "STOP");
    const [row] = await sql<{ whatsappOptOut: boolean }>(`SELECT "whatsappOptOut" FROM leads WHERE "workspaceId" = $1 AND "phoneDigits" = '966504440002'`, [n.workspaceId]);
    expect(row.whatsappOptOut).toBe(true);
    await page.goto("/whatsapp/campaigns/new");
    await page.getByTestId("wz-name").fill("VIP");
    await page.getByTestId("wz-next").click();
    await page.getByTestId("wz-tags").fill("vip");
    await page.getByTestId("wz-tags").press("Enter");
    await expect(page.getByTestId("wz-eligible")).toHaveText("1");
    await expect(page.getByTestId("wz-audience")).toContainText("Opted out: 1");
  });

  test("flow 5: Sales Desk → follow up on WhatsApp → NOVA draft waits for approval in the inbox", async ({ page }) => {
    const n = await start(page, "Wa Desk Co");
    await page.goto("/sales");
    await page.getByTestId("start-add-customer").click();
    const form = page.getByTestId("add-customer-form");
    await form.getByLabel("Name").fill("Desk Customer");
    await form.getByLabel("Phone").fill("+966 50 555 0005");
    await form.getByRole("button", { name: "Save customer" }).click();
    await expect(page.getByTestId("customer-drawer")).toBeVisible();
    // The customer writes first (opens the 24h window) — matched to the same CRM lead, not a duplicate.
    await inbound(page, n.phoneNumberId, "966505550005", "Any news on my request?");
    expect((await sql(`SELECT 1 FROM leads WHERE "workspaceId" = $1 AND "phoneDigits" = '966505550005'`, [n.workspaceId])).length).toBe(1);

    await page.getByTestId("followup-whatsapp").click();
    await page.waitForURL(/\/whatsapp\/inbox\?c=/);
    await expect(page.getByTestId("wa-draft")).toBeVisible();
    const out = await sql<{ status: string }>(`SELECT m.status FROM messages m JOIN conversations c ON c.id = m."conversationId" WHERE m."workspaceId" = $1 AND m.direction = 'OUTBOUND' AND c.channel = 'WHATSAPP'`, [n.workspaceId]);
    expect(out.map((m) => m.status)).toContain("DRAFT");
    expect(out.filter((m) => m.status === "SENT")).toHaveLength(0); // nothing reaches the customer without a human
    await page.getByTestId("wa-send-draft").click();
    await expect(page.getByTestId("wa-draft")).toHaveCount(0);
  });
});
