import { expect, test } from "@playwright/test";
import { completeOnboarding, emailLink, PASSWORD, signIn, signUp, uniqueEmail, setEnglish } from "./helpers";

test.describe("first-user journey", () => {
  test("sign up → verify email → onboarding creates the organization and company analysis → home", async ({ page }) => {
    const email = uniqueEmail("owner");
    await signUp(page, "Nadia Owner", email);
    await completeOnboarding(page, "Roast & Co");
    await expect(page.getByText("Brand profile")).toBeVisible();

    const verify = await emailLink(email, "/verify-email");
    await page.goto(verify.replace(/^https?:\/\/[^/]+/, ""));
    await expect(page.getByText("Your email is confirmed.")).toBeVisible();

    await page.goto("/home");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Nadia");
    await expect(page.getByText("AI DAILY BRIEF")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Approvals & alerts" })).toBeVisible();
  });

  test("sign out and sign in again", async ({ page }) => {
    const email = uniqueEmail("login");
    await signUp(page, "Login Tester", email);
    await completeOnboarding(page, "Login Co");
    await page.goto("/home");
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL(/\/sign-in/);
    await signIn(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/home/);
  });

  test("wrong password is rejected with a friendly message", async ({ page }) => {
    await setEnglish(page);
    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill("demo@nova.local");
    await page.getByLabel("Password").fill("definitely-wrong-1");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("That email and password don't match.")).toBeVisible();
  });
});
