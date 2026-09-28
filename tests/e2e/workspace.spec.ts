import { expect, test } from "@playwright/test";
import "dotenv/config";
import { completeOnboarding, emailLink, resetAuthRateLimits, signIn, signUp, uniqueEmail } from "./helpers";

test.describe("content, calendar, sales and approvals (fresh workspace)", () => {
  test.beforeEach(async ({ page }) => {
    await resetAuthRateLimits();
    await signUp(page, "Ops Owner", uniqueEmail("ops"));
    await completeOnboarding(page, "Ops Studio");
  });

  test("create first week → approve → schedule → calendar", async ({ page }) => {
    await page.goto("/content");
    await page.getByRole("button", { name: "Create My First Week" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("posts ready for review")).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole("link", { name: "Review posts" }).click();
    await page.waitForURL(/view=approval/);

    const firstCard = page.locator("li").filter({ has: page.getByRole("button", { name: "Approve", exact: true }) }).first();
    await firstCard.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(/\/content\/c/);
    await page.getByLabel("Caption").fill("Fresh roast every Monday. Come taste it.");
    await page.getByRole("button", { name: "Save as new version" }).click();
    await expect(page.getByText("New version saved")).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Scheduled").first()).toBeVisible();

    const when = new Date(Date.now() + 3 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    await page.getByLabel("Schedule").fill(`${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T10:30`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Schedule updated")).toBeVisible();

    await page.goto("/calendar");
    await page.getByRole("radio", { name: "Agenda" }).click();
    await expect(page.getByText("Scheduled").first()).toBeVisible();
  });

  test("add lead → Sales Agent qualifies → move stage → timeline", async ({ page }) => {
    await page.goto("/sales");
    await page.getByTestId("add-customer").click();
    const form = page.getByTestId("add-customer-form");
    await form.getByLabel("Name").fill("Karim Test");
    await form.getByLabel("Email").fill("karim@example.com");
    await form.getByRole("button", { name: /More options/ }).click();
    await form.getByLabel(/Notes \/ what they asked/).fill("Can you send a quote for barista training for 5 people? Urgent.");
    await form.getByRole("button", { name: "Save customer" }).click();
    await page.getByTestId("open-profile").click();
    await page.waitForURL(/\/leads\/c/);
    await expect(page.getByRole("heading", { name: "Karim Test" })).toBeVisible();

    await page.getByRole("button", { name: "Ask Sales Agent" }).click();
    await expect(page.getByRole("dialog").getByText("Karim Test —")).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByText("Sales Agent summary")).toBeVisible();

    await page.getByLabel("Stage").selectOption("PROPOSAL");
    await expect(page.getByText("Stage updated")).toBeVisible();
    await expect(page.getByText("Stage changed").first()).toBeVisible();
  });

  test("command bar: one sentence creates a campaign that can be approved in the Approval Center", async ({ page }) => {
    // ⌘K opens the command dialog on every page except Home (Home focuses its own command input).
    await page.goto("/campaigns");
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").getByRole("textbox").fill("Create a launch campaign for our barista course");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").locator("[data-command-intent='create_campaign']")).toContainText("is ready for your review", { timeout: 60_000 });
    await page.keyboard.press("Escape");

    await page.goto("/approvals?tab=CAMPAIGNS");
    await page.getByRole("button", { name: "Approve", exact: true }).first().click();
    await expect(page.getByRole("status").filter({ hasText: "Approved" })).toBeVisible();
    await page.goto("/campaigns");
    await expect(page.getByText("Active").first()).toBeVisible();
  });

  test("settings: rename organization and invite a teammate who accepts", async ({ page, browser }) => {
    await page.goto("/settings");
    await page.getByLabel("Company name").fill("Ops Studio Renamed");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Organization updated")).toBeVisible();

    const invitee = uniqueEmail("invitee");
    await page.goto("/settings/team");
    await page.getByPlaceholder("colleague@company.com").fill(invitee);
    await page.getByRole("button", { name: "Invite" }).click();
    await expect(page.getByText("Invitation sent")).toBeVisible();
    await expect(page.getByText(invitee)).toBeVisible();

    const link = await emailLink(invitee, "/invite/");
    const other = await browser.newContext();
    const p2 = await other.newPage();
    const invitePath = link.replace(/^https?:\/\/[^/]+/, "");
    await signUp(p2, "New Teammate", invitee, invitePath);
    await p2.waitForURL(/\/invite\//);
    await p2.getByRole("button", { name: "Accept invitation" }).click();
    await p2.waitForURL(/\/home/);
    await expect(p2.getByText("Ops Studio Renamed").first()).toBeVisible();
    await other.close();
  });
});

test.describe("demo workspace", () => {
  test("Luma demo: pipeline, analytics and admin render with data", async ({ page }) => {
    await signIn(page);
    await page.goto("/sales");
    await expect(page.getByText("Mariam Al Hashimi").first()).toBeVisible();
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "Is our content improving?" })).toBeVisible();
    await page.goto("/admin");
    await expect(page.getByText("Platform admin")).toBeVisible();
  });

  test("home command center: real counts, rail links and the hero input drive the AI team", async ({ page }) => {
    await signIn(page);
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Approvals & alerts" })).toBeVisible();
    await page.getByRole("link", { name: "Leads", exact: true }).first().click();
    await page.waitForURL(/\/(leads|sales)/);
    await page.goto("/home");
    await page.getByLabel("Ask NOVA").fill("Summarize our pipeline");
    await page.getByRole("button", { name: "Send to your AI team" }).click();
    // The Home command center answers in place (no dialog) from the real pipeline.
    await expect(page.locator("[data-command-intent='sales_summary']")).toContainText(/open opportunities/, { timeout: 60_000 });
  });
});

test.describe("content studio AI (no OpenAI key in this environment)", () => {
  test("studio tools say 'not set up' honestly; settings and admin show status without keys", async ({ page }) => {
    await signIn(page);
    await page.goto("/content?view=approval");
    await page.locator("li").filter({ has: page.getByRole("button", { name: "Approve", exact: true }) }).first().getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(/\/content\/c/);
    await expect(page.getByText("OpenAI generation isn't set up yet.").first()).toBeVisible();
    await expect(page.getByText("Image generation isn't set up yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Improve content" })).toHaveCount(0);

    await page.goto("/settings/ai");
    await expect(page.getByRole("heading", { name: "Content AI" })).toBeVisible();
    await expect(page.getByText("Design usage this month")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/tokens|USD|\$\d/); // cost details are admin-only
    await expect(page.locator("main")).not.toContainText("OPENAI_API_KEY");
    await expect(page.locator("main")).not.toContainText("gpt-image");

    await page.goto("/admin/providers");
    await expect(page.getByRole("button", { name: "Test image", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Test image edit" })).toBeDisabled();
    await expect(page.locator("[data-openai-tests]")).toContainText("gpt-image"); // model names: admins only
  });
});
