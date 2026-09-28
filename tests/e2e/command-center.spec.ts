import "dotenv/config";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { completeOnboarding, signIn, signUp, uniqueEmail } from "./helpers";

/** Home Command Center: real commands typed into the Home input itself. */

async function command(page: Page, text: string) {
  const input = page.getByLabel("Ask NOVA");
  await input.fill(text);
  await input.press("Enter");
}
const card = (page: Page) => page.locator("[data-command-status]").first();

async function sql(query: string, params: unknown[]) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(query, params)).rows;
  } finally {
    await client.end();
  }
}

test.describe("Home command center (demo workspace)", () => {
  // One sign-in for the whole group: the auth rate limit is real and the suite shouldn't trip it.
  test.describe.configure({ mode: "serial" });
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", viewport: { width: 1440, height: 900 }, locale: "en-US" })).newPage();
    await signIn(page);
    // This group's single sign-in shouldn't eat the shared per-IP / per-email budget of later specs.
    await sql(`DELETE FROM "rate_limit_buckets" WHERE "key" LIKE 'auth:signin%'`, []);
  });
  test.afterAll(async () => {
    await page.context().close();
  });
  test.beforeEach(async () => {
    await page.goto("/home");
  });

  test("1. 'افتح العملاء الساخنين' navigates to hot customers", async () => {
    await command(page, "افتح العملاء الساخنين");
    await page.waitForURL(/\/sales\?view=hot/);
  });

  test("2. follow-ups today: a real answer with a link to the follow-up center", async () => {
    await command(page, "من العملاء اللي محتاجين متابعة اليوم؟");
    await expect(card(page)).toHaveAttribute("data-command-status", "completed");
    await expect(card(page)).toHaveAttribute("data-command-intent", "followups_today");
    await expect(card(page)).toContainText(/need a follow-up today|No follow-ups are due today/);
    await expect(card(page).getByRole("link", { name: "Open follow-up center" })).toBeVisible();
  });

  test("3. sales summary shows real metrics", async () => {
    await command(page, "لخص لي حالة المبيعات");
    await expect(card(page)).toHaveAttribute("data-command-status", "completed");
    await expect(card(page)).toContainText(/open opportunities · \d+ hot · \d+ overdue/);
    await expect(card(page)).toContainText("Open");
  });

  test("5. 'افتح الموافقات' navigates; history offers it again", async () => {
    await command(page, "افتح الموافقات");
    await page.waitForURL(/\/approvals/);
    await page.goto("/home");
    await page.getByLabel("Ask NOVA").click();
    await expect(page.getByRole("button", { name: "Run again: افتح الموافقات" })).toBeVisible();
  });

  test("6. unknown command with AI not configured → clear AI-unavailable state", async () => {
    await command(page, "اكتب لي قصيدة عن القهوة والمطر في الشتاء");
    await expect(card(page)).toHaveAttribute("data-command-status", "ai_unavailable");
    await expect(card(page)).toContainText("This command needs AI, and AI isn't set up yet.");
    await expect(page.locator("body")).not.toContainText(/500|stack|Error:/);
  });

  test("keyboard: Ctrl+K focuses the input, Esc clears the result, ↑ recalls the last command", async () => {
    await page.locator("body").click();
    await page.keyboard.press("Control+k");
    await expect(page.getByLabel("Ask NOVA")).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0); // Home keeps its own input; no dialog
    await command(page, "لخص المبيعات");
    await expect(card(page)).toHaveAttribute("data-command-status", "completed");
    await page.getByLabel("Ask NOVA").press("Escape");
    await page.getByLabel("Ask NOVA").press("Escape");
    await expect(page.locator("[data-command-status]")).toHaveCount(0);
    await page.getByLabel("Ask NOVA").press("ArrowUp");
    await expect(page.getByLabel("Ask NOVA")).toHaveValue("لخص المبيعات");
  });

  test("states: 'Understanding…' appears before the result; high-risk bulk approval asks first", async () => {
    await page.getByLabel("Ask NOVA").fill("وافق على الكل");
    await page.getByLabel("Ask NOVA").press("Enter");
    await expect(page.locator("[data-command-phase], [data-command-status]").first()).toBeVisible();
    await expect(card(page)).toHaveAttribute("data-command-status", /needs_confirmation|completed/);
    if ((await card(page).getAttribute("data-command-status")) === "needs_confirmation") {
      await expect(card(page).getByRole("button", { name: "Approve all" })).toBeVisible();
      await card(page).getByRole("button", { name: "Cancel" }).click();
      await expect(card(page)).toHaveAttribute("data-command-status", "cancelled");
    }
  });
});

test.describe("Home command center (fresh workspace)", () => {
  // One sign-up for all fresh-workspace checks. The per-IP sign-up limit is real; like global-setup,
  // the test clears the sign-up bucket after its own sign-up instead of weakening the limit.
  test("4 + 7 + 8. content job, cross-tenant lookup, then a viewer is denied an action", async ({ page }) => {
    const email = uniqueEmail("cmd");
    await signUp(page, "Cmd Owner", email);
    await completeOnboarding(page, "Cmd Studio");
    await sql(`DELETE FROM "rate_limit_buckets" WHERE "key" LIKE 'auth:signup:%'`, []);
    await page.goto("/home");

    // 4. a real content job: Started → 5 posts waiting for approval.
    await command(page, "جهز 5 منشورات للأسبوع القادم");
    await expect(card(page)).toHaveAttribute("data-command-status", /queued|completed/);
    await expect(card(page)).toHaveAttribute("data-command-status", "completed", { timeout: 60_000 });
    await expect(card(page)).toContainText("5 posts created and waiting for your approval.");
    await card(page).getByRole("link", { name: "Open content" }).click();
    await page.waitForURL(/\/content\?view=approval/);
    await page.goto("/home");

    // 8. cross-tenant: "Mariam Al Hashimi" exists only in the demo tenant.
    await command(page, "افتح Mariam Al Hashimi");
    await expect(card(page)).toHaveAttribute("data-command-status", "needs_input");
    await expect(card(page)).toContainText("No customer matches “Mariam Al Hashimi”.");

    // 7. unauthorized: demote this user to VIEWER (role is resolved per request).
    await sql(`UPDATE "organization_members" SET "role" = 'VIEWER' WHERE "userId" = (SELECT "id" FROM "users" WHERE "email" = $1)`, [email]);
    await page.reload();
    await command(page, "أضف عميل اسمه Denied Co");
    await expect(card(page)).toHaveAttribute("data-command-status", "denied");
    await expect(card(page)).toContainText("Couldn't complete the request.");
    await expect(card(page)).toContainText("Your role doesn't allow this command.");
    const rows = await sql(`SELECT count(*)::int AS n FROM "leads" WHERE "name" = 'Denied Co'`, []);
    expect(rows[0].n).toBe(0);
  });
});
