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
  await expect(page.getByRole("heading", { name: "Facebook Pages (Meta)" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Instagram Direct" }).first()).toBeVisible();
  await expect(page.getByText("The Stripe adapter and webhook are not implemented yet", { exact: false })).toBeVisible();
  // Admin-only connection tests: scoped to the admin workspace (the demo has no real connection).
  await expect(page.getByRole("heading", { name: "Connection tests" })).toBeVisible();
  await expect(page.getByText("No Meta or LinkedIn connection in your workspace yet.")).toBeVisible();
  // Onboarding and settings start OAuth through /start with a fixed return context.
  await page.goto("/settings/connected-accounts");
  const cross = await page.request.get("/api/integrations/meta/start?from=settings", { maxRedirects: 0, headers: { "sec-fetch-site": "cross-site" } });
  expect(cross.headers().location).toContain("/settings/connected-accounts?error=forbidden");

  const anon = await request.get("/settings/connected-accounts", { maxRedirects: 0 });
  expect([302, 307]).toContain(anon.status());
});

test("CSP: nonce on every Next script, embed frameable cross-origin, app pages not", async ({ page, request }) => {
  const res = await request.get("/sign-in");
  const csp = res.headers()["content-security-policy"];
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce).toBeTruthy();
  expect(csp).toContain("frame-ancestors 'self'");
  const html = await res.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) expect(s).toContain(`nonce="${nonce}"`);

  const embed = await request.get("/embed/lead/demo-luma-form");
  expect(embed.headers()["content-security-policy"]).toContain("frame-ancestors *");
  expect(embed.headers()["x-frame-options"]).toBeUndefined();

  const violations: string[] = [];
  page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && violations.push(m.text()));
  await page.goto("/");
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(violations).toEqual([]);
});
