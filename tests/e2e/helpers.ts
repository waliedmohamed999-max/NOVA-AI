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

/** Completes the conversational onboarding with offline AI and lands on the reveal page. */
export async function completeOnboarding(page: Page, company: string) {
  await page.waitForURL(/\/onboarding/);
  await page.getByRole("button", { name: "Let's go" }).click();
  await page.getByPlaceholder("e.g. Bloom Bakery").fill(company);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I don't have a website" }).click();
  await page.getByPlaceholder("e.g. Custom celebration cakes and fresh bread").fill("Specialty coffee beans and barista training");
  await page.getByPlaceholder("Add a product or service").fill("Barista course");
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Consumers" }).click();
  await page.getByPlaceholder("e.g. Families and offices ordering for events").fill("Home coffee lovers in Cairo");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Warm" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Get more customers" }).click();
  await page.getByRole("button", { name: "Build my AI team" }).click();
  await expect(page.getByText("Getting to know your business…").or(page.getByText("Your AI Growth Team is ready.")).first()).toBeVisible();
  await page.waitForURL(/\/onboarding\/ready/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Your AI Growth Team is ready." })).toBeVisible();
}
