import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const STATUSES = ["READY", "READY_FOR_STAGING", "WAITING_EXTERNAL_APPROVAL", "BLOCKED"];

test("admin provider readiness: one honest status per provider, nothing READY without a live validation", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/providers");
  const rows = page.locator("tr[data-provider]");
  await expect(rows.first()).toBeVisible();
  const providers = await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-provider")));
  expect(providers).toEqual(expect.arrayContaining(["openai", "anthropic", "email", "storage", "stripe", "whatsapp"]));

  for (const p of providers) {
    const row = page.locator(`tr[data-provider="${p}"]`);
    const status = await row.locator("td[data-status]").getAttribute("data-status");
    expect(STATUSES).toContain(status);
    // READY requires a recorded live test, so the "Live tested" badge must say yes.
    if (status === "READY") await expect(row.locator('[data-live-tested="yes"]')).toBeVisible();
  }
  // This environment has no AI keys: both AI providers are blocked, never "ready".
  await expect(page.locator('tr[data-provider="openai"] td[data-status]')).toHaveAttribute("data-status", "BLOCKED");
  await expect(page.locator('tr[data-provider="anthropic"] td[data-status]')).toHaveAttribute("data-status", "BLOCKED");
  await expect(page.locator('tr[data-provider="anthropic"] td[data-status]')).toContainText("Blocked");
  await page.screenshot({ path: "test-results/admin-provider-readiness-en.png", fullPage: false });
});
