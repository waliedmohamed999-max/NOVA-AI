import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { completeOnboarding, resetAuthRateLimits, signUp, uniqueEmail } from "./helpers";

/**
 * Company Brain (Company Intelligence OS) — real flows through the UI:
 * 1 website → extract → review → import · 2 CSV customers → map → preview → import → segments
 * 3 PDF → extract FAQs → approve · 4 strategy wizard → draft → review → approve.
 * Website pages come from tests/e2e/fixtures/web (*.fixture.test; dev server started with BRAIN_FETCH_FIXTURES=true).
 */

const fixture = (f: string) => path.join(process.cwd(), "tests/e2e/fixtures", f);

async function openReview(page: Page) {
  const review = page.locator("[data-import-review]");
  await expect(review).toHaveAttribute("data-import-review", "REVIEW", { timeout: 60_000 });
  return review;
}

test.describe("Company Brain", () => {
  test.describe.configure({ mode: "serial" });
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", viewport: { width: 1440, height: 900 }, locale: "en-US" })).newPage();
    await resetAuthRateLimits();
    await signUp(page, "Brain Owner", uniqueEmail("brain"));
    await completeOnboarding(page, "Brain Studio");
  });
  test.afterAll(async () => {
    await page.context().close();
  });

  test("overview: hero, brain map, statuses in words, what's missing", async () => {
    await page.goto("/knowledge");
    await expect(page.getByRole("heading", { name: "Your company's brain, in one place." })).toBeVisible();
    await expect(page.locator("[data-brain-map] [data-map-node]")).toHaveCount(7);
    await expect(page.locator("[data-brain-overall]")).toHaveText(/Weak|Needs info|Ready|Complete/);
    await expect(page.locator("[data-brain-missing]")).toContainText("No customer segments");
    for (const tab of ["Company profile", "Products & services", "Customers", "Strategy", "Market & competitors", "Sales knowledge", "Content knowledge", "FAQs", "Knowledge sources", "Data imports", "Brain health"]) {
      await expect(page.getByRole("link", { name: tab, exact: true }).first()).toBeVisible();
    }
  });

  test("flow 1: website → extract → review → import (critical items not pre-selected)", async () => {
    await page.goto("/knowledge?tab=imports");
    await page.locator("[data-import-card='website']").click();
    await page.getByLabel("Link").fill("https://acme.fixture.test/");
    await page.getByRole("button", { name: "Start" }).click();
    const review = await openReview(page);
    await expect(review.locator("[data-found]")).toContainText("Products & services");
    await expect(review.locator("[data-found]")).toContainText("Pricing");
    await expect(review.getByRole("checkbox", { name: /Landing page package/ })).not.toBeChecked();
    await expect(review.getByRole("checkbox", { name: "Website development" })).toBeChecked();
    await page.getByRole("button", { name: /^Add \d+ items?$/ }).click();
    // The review sheet closes only after the import has been applied.
    await expect(page.locator("[data-import-review]")).toHaveCount(0, { timeout: 60_000 });
    await page.goto("/knowledge?tab=products");
    await expect(page.locator("[data-entity-list='offering']")).toContainText("Website development");
    await page.goto("/knowledge?tab=faq");
    await expect(page.locator("[data-entity-list='faq']")).toContainText("How long does a website take?");
  });

  test("flow 2: CSV customers → map → preview duplicates → import → segments", async () => {
    await page.goto("/knowledge?tab=imports");
    await page.locator("[data-import-file]").setInputFiles(fixture("customers.csv"));
    const review = await openReview(page);
    await expect(review.locator("[data-mapping]")).toContainText("Customer ID");
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(review.locator("[data-customer-preview]")).toContainText("13");
    await expect(review.locator("[data-customer-preview]")).toContainText("Duplicates");
    await page.getByRole("button", { name: "Import 13 customers" }).click();
    // The review sheet closes only after the import has been applied.
    await expect(page.locator("[data-import-review]")).toHaveCount(0, { timeout: 60_000 });
    await page.goto("/knowledge?tab=customers");
    await expect(page.locator("[data-customer-overview]")).toContainText("13");
    await expect(page.locator("[data-customer-insights]")).toContainText("Customers in Riyadh buy Serums more");
    const segments = page.locator("[data-entity-list='segment']");
    await expect(segments).toContainText("Repeat customers");
    await expect(segments).toContainText("Suggested");
    await segments.locator("[data-entity-row]").filter({ hasText: "Repeat customers" }).getByRole("button", { name: "Approve" }).click();
    await expect(segments.locator("[data-entity-row]").filter({ hasText: "Repeat customers" })).toContainText("Approved");
  });

  test("flow 3: PDF → extract FAQs → import → approve the critical policy", async () => {
    await page.goto("/knowledge?tab=imports");
    await page.locator("[data-import-file]").setInputFiles(fixture("handbook.pdf"));
    const review = await openReview(page);
    await expect(review.getByRole("checkbox", { name: "Do you offer a warranty on websites?" })).toBeChecked();
    const policy = review.getByRole("checkbox", { name: "Refund policy" });
    await expect(policy).not.toBeChecked();
    await policy.check();
    await page.getByRole("button", { name: /^Add \d+ items?$/ }).click();
    // The review sheet closes only after the import has been applied.
    await expect(page.locator("[data-import-review]")).toHaveCount(0, { timeout: 60_000 });
    await page.goto("/knowledge?tab=faq");
    await expect(page.locator("[data-entity-list='faq']")).toContainText("Do you offer a warranty on websites?");
    await page.goto("/knowledge?tab=profile");
    const fact = page.locator("[data-facts] li[data-status='pending']").filter({ hasText: "Deposits are refundable" });
    await expect(fact).toContainText("Critical");
    await fact.getByRole("button", { name: "Approve" }).click();
    await expect(page.locator("[data-facts] li").filter({ hasText: "Deposits are refundable" })).toHaveAttribute("data-status", "approved");
  });

  test("flow 4: strategy questions → wizard → draft → review → approve", async () => {
    await page.goto("/knowledge?tab=strategy");
    const q = page.locator("[data-next-question]");
    // Onboarding already recorded the main goal, so NOVA doesn't ask it again — it asks the next gap.
    await expect(page.locator("[data-question='goal_90d']")).toHaveAttribute("data-status", "answered");
    const key = (await q.getAttribute("data-next-question"))!;
    expect(key).not.toBe("goal_90d");
    await q.getByRole("textbox").fill("Our retainer package for B2B clients in Riyadh");
    await q.getByRole("button", { name: "Save answer" }).click();
    await expect(page.locator("[data-next-question]")).not.toHaveAttribute("data-next-question", key);
    await expect(page.locator(`[data-question='${key}']`)).toHaveAttribute("data-status", "answered");
    await page.getByRole("button", { name: "Build a strategy", exact: true }).click();
    const list = page.locator("[data-entity-list='strategy']");
    await expect(list.locator("[data-entity-row]")).toHaveCount(1);
    const row = list.locator("[data-entity-row]").first();
    await expect(row).toContainText("Draft");
    await row.getByRole("button", { name: "Send to review" }).click();
    await expect(row).toContainText("In review");
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(row).toContainText("Approved");
  });

  test("brain search and health", async () => {
    await page.goto("/knowledge?tab=health");
    await expect(page.locator("[data-health] [data-area]")).toHaveCount(8);
    await expect(page.locator("[data-area='products']")).toHaveAttribute("data-status", /ready|needs_info/);
    await page.getByLabel("Search the Company Brain").fill("warranty");
    await expect(page.locator("[data-brain-search-results]")).toContainText("Do you offer a warranty on websites?");
  });
});
