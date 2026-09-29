import { expect, type Page } from "@playwright/test";

export const DEMO = { email: "demo@nova.local", password: "NovaDemo2026!" };
export const PASSWORD = "E2e-password-2026";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.nova.test`;
}

export async function setEnglish(page: Page) {
  await page.context().addCookies([{ name: "nova_locale", value: "en", url: "http://localhost:3000" }]);
}

export async function signIn(page: Page, email = DEMO.email, password = DEMO.password) {
  await setEnglish(page);
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/(home|onboarding)/);
  // Sign-in applies the account's saved language (the demo account may have been switched to Arabic by a
  // person using it); the suite asserts English copy, so pin the UI language again after signing in.
  await setEnglish(page);
}

export async function signUp(page: Page, name: string, email: string, next?: string) {
  await setEnglish(page);
  await page.goto(next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
}

/** Waits for an email to arrive in Mailpit and returns the first link containing `fragment`. */
export async function emailLink(to: string, fragment: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const json = (await res.json()) as { messages?: { ID: string }[] };
    for (const m of json.messages ?? []) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string };
      const link = msg.Text.match(new RegExp(`https?://\\S*${fragment}\\S*`))?.[0];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No email with ${fragment} for ${to}`);
}

/** Step 1 of the guided setup: company, industry, business + customer type (no website). */
export async function fillBusiness(page: Page, company: string) {
  await page.getByLabel("What's your company called?").fill(company);
  await page.getByLabel("Industry").fill("Food & restaurants");
  await page.getByRole("radio", { name: /^Products/ }).click();
  await page.getByRole("radio", { name: /^Individuals/ }).click();
}

/** Completes the guided setup (every answer saved live) and enters NOVA. */
export async function completeOnboarding(page: Page, company: string) {
  await page.waitForURL(/\/onboarding/);
  await fillBusiness(page, company);
  await page.getByRole("button", { name: "I don't have a website" }).click();
  await page.getByPlaceholder("Add a product or service").fill("Barista course");
  await page.getByPlaceholder("Add a product or service").press("Enter");
  await page.getByTestId("setup-continue").click();
  await page.getByRole("textbox", { name: "Who are your customers?" }).fill("Home coffee lovers in Cairo");
  await page.getByLabel("Where are they?").fill("Cairo");
  await page.getByTestId("setup-continue").click();
  await page.getByRole("checkbox", { name: "Warm", exact: true }).click();
  await page.getByTestId("setup-continue").click();
  await page.getByRole("checkbox", { name: "More leads" }).click();
  await page.getByTestId("setup-continue").click();
  // Channels are optional (WhatsApp, social, email) — skip on to review.
  await expect(page.getByRole("heading", { name: "Connect your channels" })).toBeVisible();
  await page.getByTestId("setup-continue").click();
  await expect(page.getByRole("heading", { name: "Your team is ready" })).toBeVisible();
  await page.getByTestId("enter-nova").click();
  await expect(page.getByText("Preparing your team…").or(page.getByText("Your team is ready.")).first()).toBeVisible();
  await page.waitForURL(/\/home/, { timeout: 60_000 });
}

/**
 * The suite signs up many accounts from one IP, which (correctly) trips the production auth rate limits.
 * Like global-setup, specs that sign up repeatedly reset the auth buckets instead of weakening the limits.
 */
export async function resetAuthRateLimits() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "rate_limit_buckets" WHERE "key" LIKE 'auth:%'`);
  } finally {
    await client.end();
  }
}
