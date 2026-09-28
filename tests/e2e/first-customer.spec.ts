import { expect, test } from "@playwright/test";
import { completeOnboarding, signUp, uniqueEmail } from "./helpers";

/**
 * First-customer journey, end to end on a fresh account. Steps that need a live provider (OpenAI, Stripe,
 * calendars, social OAuth) must show their real reason — never a fake success.
 */
test.describe("first customer journey", () => {
  test("sign up → onboarding → channels → content → first lead → meetings → analytics → approvals → billing", async ({ page }) => {
    const email = uniqueEmail("first");
    await signUp(page, "Salma Founder", email);
    await completeOnboarding(page, "Salma Studio");

    // Connected accounts: guided first-channel prompt; Google/Microsoft cards replace "coming soon".
    await page.goto("/settings/connected-accounts");
    await expect(page.getByTestId("first-channel")).toContainText("Connect your first channel");
    const google = page.locator('[data-account="GOOGLE"]');
    const microsoft = page.locator('[data-account="MICROSOFT"]');
    await expect(google).toContainText("Google (Gmail + Calendar)");
    await expect(microsoft).toContainText("Microsoft (Outlook + Calendar)");
    await expect(google).toContainText("never asks for or stores your password");
    await expect(page.getByText("Google / Email")).toHaveCount(0); // the old "coming soon" email card is gone
    // Unconfigured providers say so; nothing pretends to connect.
    await expect(page.locator('[data-platform="TIKTOK"]').getByText(/Not available yet|Not connected/)).toBeVisible();

    // Content: guided empty state.
    await page.goto("/content");
    await expect(page.getByText("Create your first week of content").first()).toBeVisible();

    // Sales: first lead by hand.
    await page.goto("/sales");
    await expect(page.getByText("Add your first customer").first()).toBeVisible();
    await page.getByTestId("start-add-customer").click();
    await page.getByTestId("add-customer-form").getByLabel("Name").fill("Omar Buyer");
    await page.getByTestId("add-customer-form").getByLabel("Email").fill("omar@buyer.test");
    await page.getByTestId("add-customer-form").getByRole("button", { name: "Save customer" }).click();
    await page.getByTestId("open-profile").click();
    await page.waitForURL(/\/leads\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: "Omar Buyer" })).toBeVisible();

    // Meetings: no calendar connected → says so, links to connect, offers no booking.
    const meetings = page.getByTestId("meetings-card");
    await expect(meetings).toContainText("No calendar is connected");
    await expect(meetings.getByRole("link", { name: "Connect Google or Microsoft calendar" })).toBeVisible();
    await expect(meetings.getByRole("button", { name: "Propose 3 times" })).toHaveCount(0);

    // Analytics: results appear after the first post; attribution counts the real lead.
    await page.goto("/analytics");
    await expect(page.getByText("Results will appear after your first post")).toBeVisible();
    await expect(page.getByTestId("attribution")).toContainText("Where customers come from");

    // Approval policies in business language; the locked topics can't be switched off.
    await page.goto("/settings/approvals");
    await expect(page.getByText("Always ask me before publishing")).toBeVisible();
    await expect(page.getByText("Always needs your approval (can't be turned off)")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Discounts" })).toBeDisabled();

    // Billing: no Stripe keys → honest message, no fake checkout.
    await page.goto("/settings/billing");
    await expect(page.getByText("Online payments aren't set up for this installation yet.")).toBeVisible();
  });

  test("legal pages are public and linked for app review", async ({ page }) => {
    for (const [path, heading] of [["/privacy", /Privacy/], ["/terms", /Terms/], ["/data-deletion", /data deletion|Delete/i], ["/acceptable-use", /Acceptable use/i]] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
    }
  });

  test("public webhooks reject unsigned requests", async ({ request }) => {
    expect((await request.post("/api/webhooks/stripe", { data: { id: "evt_x" } })).status()).toBe(400);
    expect((await request.post("/api/webhooks/whatsapp", { data: { object: "whatsapp_business_account" } })).status()).toBe(401);
    expect((await request.get("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1")).status()).toBe(403);
  });
});
