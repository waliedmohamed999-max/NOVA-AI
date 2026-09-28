import { expect, test, type Page } from "@playwright/test";
import { completeOnboarding, signUp, uniqueEmail } from "./helpers";

/** Sales Desk end to end on fresh workspaces (real DB, offline AI provider in E2E). */

async function freshWorkspace(page: Page, company: string) {
  await signUp(page, "Desk Owner", uniqueEmail("desk"));
  await completeOnboarding(page, company);
}

async function addCustomer(page: Page, name: string, email: string) {
  await page.getByTestId("add-customer-form").getByLabel("Name").fill(name);
  await page.getByTestId("add-customer-form").getByLabel("Email").fill(email);
  await page.getByTestId("add-customer-form").getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByTestId("customer-drawer")).toBeVisible();
}

test.describe("Sales Desk", () => {
  test("empty workspace: Getting started → first customer → full workspace", async ({ page }) => {
    await freshWorkspace(page, "Empty Desk Co");
    await page.goto("/leads");
    await page.waitForURL(/\/sales\?view=customers/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stronger relationships. Closer deals.");
    await expect(page.getByTestId("getting-started")).toContainText("Start your Sales Desk");
    await expect(page.getByTestId("kpis")).toHaveCount(0);
    await expect(page.getByTestId("status-strip")).toContainText("CRM");
    await expect(page.locator('[data-channel="whatsapp"]')).toContainText(/Not set up|Not connected/);

    await page.getByTestId("start-add-customer").click();
    await addCustomer(page, "First Customer", "first@customer.test");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("getting-started")).toHaveCount(0);
    await expect(page.getByTestId("kpis")).toBeVisible();
    await expect(page.getByTestId("hero-overdue")).toContainText("0");
    // Unknown values are never shown as 0.
    await expect(page.locator('[data-kpi="pipelineValue"]')).toContainText("—");
  });

  test("lead → opportunity → quote needs approval → move stages → follow-up → won", async ({ page }) => {
    await freshWorkspace(page, "Pipeline Co");
    await page.goto("/sales");
    await page.getByTestId("start-add-customer").click();
    await addCustomer(page, "Falcon Group", "cfo@falcon.test");

    // Opportunity from the drawer (3 steps for an existing customer).
    const drawer = page.getByTestId("customer-drawer");
    await drawer.getByRole("button", { name: "Opportunity" }).click();
    await page.getByLabel("Opportunity title").fill("ERP Implementation");
    await page.getByTestId("b2b-next").click();
    await page.getByLabel(/Estimated value/).fill("45000");
    await page.getByTestId("b2b-next").click();
    await page.getByTestId("b2b-step-stage").getByLabel("Stage", { exact: true }).selectOption("QUALIFIED");
    await page.getByTestId("b2b-step-stage").getByLabel(/^Next step(?! date)/).fill("Send the proposal");
    await page.getByTestId("b2b-save").click();
    await expect(page.getByText("Opportunity created")).toBeVisible();

    // Pipeline shows the card with its value in Qualified.
    await page.goto("/sales?view=pipeline");
    const qualified = page.locator('[data-stage="QUALIFIED"]:visible');
    await expect(qualified).toContainText("Falcon Group");
    await expect(qualified).toContainText("ERP Implementation");
    await expect(qualified).toContainText("45,000");

    // Quote with a discount → needs approval, can't be sent yet.
    await qualified.getByRole("button", { name: /Open Falcon Group/ }).click();
    await page.getByTestId("customer-drawer").getByRole("button", { name: "Quote" }).click();
    const quote = page.getByTestId("quote-form");
    await quote.getByLabel("Title").fill("ERP proposal");
    await quote.getByPlaceholder("Description").fill("Implementation");
    await quote.getByPlaceholder("Unit price").fill("45000");
    await quote.getByLabel(/Discount/).fill("2000");
    await expect(quote).toContainText("need approval");
    await page.getByTestId("quote-save").click();
    await page.waitForURL(/view=quotes/);
    await expect(page.getByTestId("quotes")).toContainText("Needs approval");
    await page.goto("/approvals");
    await expect(page.getByText(/Q-\d{4}-0001 — Falcon Group/)).toBeVisible();

    // Move stages from the drawer, schedule a follow-up, mark won.
    await page.goto("/sales?view=pipeline");
    await page.locator('[data-card]:visible').filter({ hasText: "Falcon Group" }).first().getByRole("button", { name: /Open Falcon Group/ }).click();
    await page.getByTestId("drawer-stage").selectOption("NEGOTIATION");
    await expect(page.getByText(/Falcon Group → /).first()).toBeVisible();
    await page.getByTestId("customer-drawer").getByRole("button", { name: "Follow-up" }).click();
    await page.getByLabel("What's the follow-up about?").fill("Confirm the start date");
    await page.getByLabel("When").fill("2030-01-15T10:00");
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await expect(page.getByText("Follow-up scheduled")).toBeVisible();
    await page.getByTestId("customer-drawer").getByRole("button", { name: "Mark won" }).click();
    await expect(page.getByTestId("drawer-stage")).toHaveValue("WON");
    await page.keyboard.press("Escape");

    await page.goto("/sales?view=pipeline");
    await expect(page.locator('[data-stage="WON"]:visible')).toContainText("Falcon Group");
    await page.goto("/sales?view=activity");
    await expect(page.getByTestId("opportunity-log")).toContainText("Stage changed");
    await expect(page.getByTestId("opportunity-log")).toContainText("Won");
    await page.goto("/sales?view=forecast");
    await expect(page.getByTestId("forecast")).toContainText("45,000");
  });

  test("B2B opportunity flow (5 steps) and the B2B list", async ({ page }) => {
    await freshWorkspace(page, "B2B Co");
    await page.goto("/sales");
    await page.getByTestId("add-b2b").click();
    await page.getByLabel("Company").fill("Nile Logistics");
    await page.getByLabel("Industry").fill("Logistics");
    await page.getByTestId("b2b-next").click();
    await page.getByLabel("Contact person").fill("Hany Adel");
    await page.getByLabel("Decision maker").fill("COO");
    await page.getByTestId("b2b-next").click();
    await page.getByLabel("Opportunity title").fill("Fleet tracking rollout");
    await page.getByLabel("What do they need?").fill("Track 40 trucks in real time");
    await page.getByTestId("b2b-next").click();
    await page.getByTestId("b2b-next").click(); // value unknown → stays unknown
    await expect(page.getByTestId("b2b-step-stage")).toContainText("Let NOVA help me");
    await page.getByTestId("b2b-save").click();
    await page.waitForURL(/view=b2b/);
    const list = page.getByTestId("b2b-list");
    await expect(list).toContainText("Nile Logistics");
    await expect(list).toContainText("Fleet tracking rollout");
    await expect(list).toContainText("COO");
    await expect(list).toContainText("Value not set");
  });

  test("mobile: stage selector instead of 8 columns; Arabic is RTL", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await freshWorkspace(page, "Mobile Co");
    await page.goto("/sales");
    await page.getByTestId("start-add-customer").click();
    await addCustomer(page, "Mobile Lead", "m@lead.test");
    await page.keyboard.press("Escape");
    await page.goto("/sales?view=pipeline");
    await expect(page.getByRole("tablist", { name: "Stages" })).toBeVisible();
    // Opens on the first stage that has customers (the offline agent may already have moved it past New).
    await expect(page.locator('[data-stage]:visible')).toHaveCount(1);
    await expect(page.locator('[data-stage]:visible')).toContainText("Mobile Lead");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await ctx.addCookies([{ name: "nova_locale", value: "ar", url: "http://localhost:3000" }]);
    await page.goto("/sales");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("علاقات أقوى. فرص أقرب.");
    await ctx.close();
  });
});
