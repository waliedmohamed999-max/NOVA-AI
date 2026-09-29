import { expect, test, type Page } from "@playwright/test";
import { completeOnboarding, fillBusiness, resetAuthRateLimits, signUp, uniqueEmail } from "./helpers";

/**
 * Guided company setup. Website pages come from tests/e2e/fixtures/web (*.fixture.test; the dev server runs
 * with BRAIN_FETCH_FIXTURES=true). Every answer is saved live; the brain is checked after the setup.
 * The "no AI provider" flow runs only against a server started without AI (E2E_NO_AI=1).
 */

async function start(page: Page, name: string) {
  await resetAuthRateLimits();
  await signUp(page, name, uniqueEmail("setup"));
  await page.waitForURL(/\/onboarding/);
}

const saved = (page: Page) => expect(page.getByTestId("save-state")).toContainText("Saved");

test.describe("guided company setup", () => {
  test.skip(process.env.E2E_NO_AI === "1", "AI-less server run: only the no-AI flow");

  test("flow 1: company → audience → brand → goals (strategy draft) → review → enter NOVA", async ({ page }) => {
    await start(page, "Hala Owner");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hala");
    await expect(page.getByText("Step 1 of 5")).toBeVisible();

    await fillBusiness(page, "Hala Bakes");
    await page.getByLabel("Country").selectOption("SA");
    await page.getByRole("button", { name: "I don't have a website" }).click();
    await page.getByPlaceholder("Add a product or service").fill("Celebration cakes");
    await page.getByPlaceholder("Add a product or service").press("Enter");
    await saved(page);
    await expect(page.getByTestId("setup-chips")).toContainText("Company Brain updated");

    // Required answers gate the step.
    await page.getByTestId("setup-continue").click();
    await expect(page.getByText("Step 2 of 5")).toBeVisible();
    await page.getByTestId("setup-continue").click();
    await expect(page.getByText("Fill in the required fields to continue.")).toBeVisible();

    // Audience: customer type already known (not asked again); progressive details.
    await expect(page.getByText("Customer type: Individuals")).toBeVisible();
    await page.getByRole("textbox", { name: "Who are your customers?" }).fill("Families ordering cakes for birthdays");
    await page.getByLabel("Where are they?").fill("Riyadh");
    await page.getByRole("button", { name: "Add more detail" }).click();
    await page.getByLabel("From", { exact: true }).fill("25");
    await page.getByLabel("To", { exact: true }).fill("18");
    await expect(page.getByText(/can't be above/)).toBeVisible();
    await page.getByLabel("To", { exact: true }).fill("45");
    await expect(page.getByText(/can't be above/)).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Mid-range" }).click();
    await saved(page);
    await page.getByTestId("setup-continue").click();

    // Brand.
    await page.getByRole("checkbox", { name: "Warm", exact: true }).click();
    await page.getByRole("checkbox", { name: "Friendly", exact: true }).click();
    await page.getByRole("checkbox", { name: "Elegant & premium" }).click();
    await saved(page);
    await page.getByTestId("setup-continue").click();

    // Goals + NOVA's first proposal (a draft, never approved automatically).
    await page.getByRole("checkbox", { name: "More leads" }).click();
    await page.getByLabel("Your 90-day goal").fill("50 qualified leads in 90 days");
    await page.getByRole("checkbox", { name: "Instagram" }).click();
    await page.getByTestId("build-strategy").click();
    const preview = page.getByTestId("strategy-preview");
    await expect(preview.getByText("Draft — never approved automatically")).toBeVisible();
    await expect(preview).toContainText("50 qualified leads in 90 days");
    await expect(preview).toContainText("Families ordering cakes for birthdays");
    await expect(page.getByTestId("setup-chips")).toContainText("Strategy draft ready");
    await page.getByTestId("setup-continue").click();

    // Review shows what's saved; edit jumps back; enter NOVA runs the real setup and lands on Home.
    await expect(page.getByRole("heading", { name: "Review & launch" })).toBeVisible();
    await expect(page.getByText("Hala Bakes").first()).toBeVisible();
    await expect(page.getByText("50 qualified leads in 90 days")).toBeVisible();
    await page.getByRole("button", { name: "Edit — Brand" }).click();
    await expect(page.getByText("Step 3 of 5")).toBeVisible();
    await page.getByTestId("setup-continue").click();
    await page.getByTestId("setup-continue").click();
    await page.getByTestId("enter-nova").click();
    await page.waitForURL(/\/home/, { timeout: 60_000 });

    // The Company Brain holds the answers (profile, strategy draft).
    await page.goto("/knowledge");
    await expect(page.getByText("Hala Bakes").first()).toBeVisible();
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/home/);
  });

  test("flow 2: website analysis → findings reviewed → brain updated → industry suggestion", async ({ page }) => {
    await start(page, "Site Owner");
    await page.getByLabel("What's your company called?").fill("Acme Agency");
    await page.getByLabel("Do you have a website?").fill("acme.fixture.test");
    await page.getByTestId("analyze-website").click();
    const review = page.getByTestId("site-review");
    await expect(review).toBeVisible({ timeout: 45_000 });
    await expect(review).toContainText("Business identified");
    await expect(review).toContainText("Found 3 services");
    await expect(review.getByText("Website development")).toBeVisible();
    await expect(review).toContainText("pending your approval"); // pricing + refund policy aren't pre-selected
    await review.getByLabel("SEO audits").uncheck();
    await page.getByTestId("apply-website").click();
    await expect(page.getByTestId("site-applied")).toContainText("Company Brain updated");
    await expect(page.getByTestId("setup-chips")).toContainText("Website analyzed");
    await expect(page.getByText("Website development").first()).toBeVisible(); // now in the offerings list
    await expect(page.getByRole("button", { name: "Remove SEO audits" })).toHaveCount(0);

    const suggestion = page.getByTestId("industry-suggestion");
    await expect(suggestion).toContainText("NOVA suggests: Information technology");
    await suggestion.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByLabel("Industry")).toHaveValue("Information technology");
    await expect(page.getByTestId("task-website")).toHaveAttribute("data-state", "done");
  });

  test("flow 3: website analysis fails → honest message → continue manually", async ({ page }) => {
    await start(page, "Fail Owner");
    await page.getByLabel("What's your company called?").fill("Offline Co");
    await page.getByLabel("Do you have a website?").fill("missing.fixture.test");
    await page.getByTestId("analyze-website").click();
    await expect(page.getByTestId("site-failed")).toContainText("We couldn't analyze the website. You can continue manually.", { timeout: 45_000 });
    await page.getByLabel("Industry").fill("Consulting");
    await page.getByRole("radio", { name: /^Services/ }).click();
    await page.getByRole("radio", { name: /^Businesses/ }).click();
    await saved(page);
    await page.getByTestId("setup-continue").click();
    await expect(page.getByText("Step 2 of 5")).toBeVisible();
  });

  test("flow 4: leaving and coming back resumes at the same step with the answers", async ({ page }) => {
    await start(page, "Resume Owner");
    await fillBusiness(page, "Resume Roastery");
    await saved(page);
    await page.getByTestId("setup-continue").click();
    await page.getByRole("textbox", { name: "Who are your customers?" }).fill("Office managers buying coffee");
    await saved(page);

    await page.goto("/home"); // not finished → back to the setup
    await page.waitForURL(/\/onboarding/);
    await expect(page.getByText("Step 2 of 5")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Who are your customers?" })).toHaveValue("Office managers buying coffee");
    await page.getByRole("button", { name: /^1\s*Business/ }).first().click();
    await expect(page.getByLabel("What's your company called?")).toHaveValue("Resume Roastery");
    await expect(page.getByLabel("Industry")).toHaveValue("Food & restaurants");
  });
});

test.describe("guided company setup — no AI provider", () => {
  test.skip(process.env.E2E_NO_AI !== "1", "needs a server started without any AI provider");

  test("flow 5: completes without AI and says so", async ({ page }) => {
    await start(page, "NoAI Owner");
    await expect(page.getByText("You can finish the setup without AI.")).toHaveCount(0); // shown where AI would help
    await fillBusiness(page, "Plain Co");
    await page.getByRole("button", { name: "I don't have a website" }).click();
    await page.getByTestId("setup-continue").click();
    await page.getByRole("textbox", { name: "Who are your customers?" }).fill("Local families");
    await page.getByLabel("Where are they?").fill("Cairo");
    await page.getByRole("button", { name: "Add more detail" }).click();
    await page.getByRole("button", { name: "Add more detail" }).click();
    await expect(page.getByText("You can finish the setup without AI.")).toBeVisible();
    await page.getByTestId("setup-continue").click();
    await page.getByRole("checkbox", { name: "Warm", exact: true }).click();
    await page.getByTestId("setup-continue").click();
    await page.getByRole("checkbox", { name: "Increase sales" }).click();
    await page.getByTestId("build-strategy").click();
    await expect(page.getByTestId("strategy-preview")).toContainText("Built from your answers only");
    await page.getByTestId("setup-continue").click();
    await page.getByTestId("enter-nova").click();
    await expect(page.getByText("AI isn't set up, so the profile was built from your answers only.")).toBeVisible();
    await page.waitForURL(/\/home/, { timeout: 60_000 });
  });
});

test("setup helper still works for the other journeys", async ({ page }) => {
  test.skip(process.env.E2E_NO_AI === "1");
  await start(page, "Helper Owner");
  await completeOnboarding(page, "Helper Co");
});
