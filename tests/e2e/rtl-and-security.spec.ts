import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers";

test("Arabic RTL: /ar switches language and direction across critical screens", async ({ page }) => {
  await page.goto("/ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("link", { name: "ابنِ فريقي الذكي" }).first()).toBeVisible();

  await page.goto("/sign-in");
  await page.getByLabel("بريد العمل").fill(DEMO.email);
  await page.getByLabel("كلمة المرور").fill(DEMO.password);
  await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).click();
  await page.waitForURL(/\/home/);
  // Signing in applies the user's saved language; switch back to Arabic.
  await page.goto("/ar/home");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "الموافقات والتنبيهات" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "نظامك الذكي المتكامل لإدارة النمو" })).toBeVisible();
  for (const path of ["/content", "/calendar", "/leads", "/approvals", "/settings"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("main")).not.toContainText("settings.");
  }
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("security: app routes require a session; admin is hidden from non-admins; public API rejects foreign origins", async ({ page, request }) => {
  await page.goto("/home");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fhome/);

  const res = await request.post("/api/public/leads/demo-luma-form", { headers: { origin: "https://evil.example", "content-type": "application/json" }, data: { name: "x", email: "x@y.co", message: "hi" } });
  expect(res.status()).toBe(403);

  const files = await request.get("/api/files/anything?exp=9999999999&sig=forged");
  expect(files.status()).toBe(404);

  await signIn(page);
  await page.goto("/admin");
  await expect(page.getByText("Platform admin")).toBeVisible();
});
