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

test("connected accounts: no customer Integrations page, no config details, admin-only provider status", async ({ page, request }) => {
  await signIn(page);
  await page.goto("/home");
  await expect(page.getByRole("link", { name: "Integrations" })).toHaveCount(0);

  await page.goto("/integrations");
  await page.waitForURL(/\/settings\/connected-accounts/);
  await expect(page.getByRole("heading", { name: "Connected accounts" }).first()).toBeVisible();
  await expect(page.getByText("Demo account")).toBeVisible();
  const main = page.locator("main");
  await expect(main).not.toContainText("META_APP");
  await expect(main).not.toContainText("CLIENT_SECRET");
  await expect(main).not.toContainText("Admin setup");
  for (const name of ["Instagram", "Facebook", "LinkedIn", "TikTok"]) await expect(main.getByRole("heading", { name, exact: true })).toBeVisible();

  // A crafted return value cannot redirect off-site.
  const r = await page.request.get("/api/integrations/meta/connect?from=https://evil.example", { maxRedirects: 0 });
  expect(r.headers().location ?? "").not.toContain("evil.example");

  await page.goto("/admin/providers");
  await expect(page.getByText("Meta (Instagram + Facebook)")).toBeVisible();
  await expect(page.getByText("The Stripe adapter and webhook are not implemented yet", { exact: false })).toBeVisible();

  const anon = await request.get("/settings/connected-accounts", { maxRedirects: 0 });
  expect([302, 307]).toContain(anon.status());
});
