// Visual QA sweep: every major screen × 3 viewports × 2 languages.
// Usage: node scripts/visual-audit.mjs <sessionToken> <outDir> [filter]
// Reports horizontal overflow, elements escaping the viewport, raw translation
// keys, console errors and HTTP errors, and saves a screenshot per case.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import "dotenv/config";

const [token, outDir = ".visual-audit", filter] = process.argv.slice(2);
if (!token) throw new Error("session token required");
mkdirSync(outDir, { recursive: true });

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const one = async (sql) => (await db.query(sql)).rows[0]?.id ?? "missing";
const demo = `(select id from organizations where "isDemo" limit 1)`;
const ids = {
  content: await one(`select id from content_items where "organizationId" = ${demo} and status='PENDING_APPROVAL' limit 1`),
  lead: await one(`select id from leads where "organizationId" = ${demo} and email='omar@nasser.example' limit 1`),
  campaign: await one(`select id from campaigns where "organizationId" = ${demo} limit 1`),
  post: await one(`select id from social_posts where "organizationId" = ${demo} order by "publishedAt" desc limit 1`),
  report: await one(`select id from reports where "organizationId" = ${demo} and kind='WEEKLY_REPORT' limit 1`),
  carousel: await one(`select id from content_items where "organizationId" = ${demo} and format='CAROUSEL' limit 1`),
};
await db.end();

const PUBLIC = [
  ["landing", "/"],
  ["sign-in", "/sign-in"],
  ["sign-up", "/sign-up"],
  ["forgot", "/forgot-password"],
];
const APP = [
  ["home", "/home"],
  ["team", "/team"],
  ["agent", "/team/sales_agent"],
  ["content", "/content"],
  ["content-preview", `/content/${ids.content}`],
  ["calendar", "/calendar"],
  ["leads", "/leads"],
  ["leads-board", "/leads?view=board"],
  ["lead-detail", `/leads/${ids.lead}`],
  ["sales", "/sales"],
  ["approvals", "/approvals"],
  ["campaigns", "/campaigns"],
  ["campaign", `/campaigns/${ids.campaign}`],
  ["analytics", "/analytics"],
  ["post-analytics", `/analytics/posts/${ids.post}`],
  ["social", "/social"],
  ["inbox", "/inbox"],
  ["reports", "/reports"],
  ["report", `/reports/${ids.report}`],
  ["notifications", "/notifications"],
  ["activity", "/activity"],
  ["knowledge", "/knowledge"],
  ["brand", "/brand"],
  ["connected-accounts", "/settings/connected-accounts"],
  ["integrations-redirect", "/integrations"],
  ["onboarding-connect", "/onboarding/connect"],
  ["admin-providers", "/admin/providers"],
  ["settings", "/settings"],
  ["settings-team", "/settings/team"],
  ["settings-ai", "/settings/ai"],
  ["settings-billing", "/settings/billing"],
  ["settings-lead", "/settings/lead-capture"],
  ["settings-data", "/settings/data"],
  ["settings-approvals", "/settings/approvals"],
  ["carousel", `/content/${ids.carousel}`],
  ["admin-incidents", "/admin/incidents"],
  ["admin", "/admin"],
  ["admin-orgs", "/admin/organizations"],
  ["admin-jobs", "/admin/jobs"],
  ["help", "/help"],
  ["onboarding-ready", "/onboarding/ready"],
];
const VIEWPORTS = [
  [1440, 900],
  [1024, 800],
  [390, 844],
];
const RAW_KEY = /\b(app|settings|common|content|leads|analytics|errors|onboarding|landing|auth)\.[a-z][A-Za-z_]*\.[A-Za-z_.]+\b/;

const browser = await chromium.launch();
const findings = [];
for (const locale of ["ar", "en"]) {
  for (const [w, h] of VIEWPORTS) {
    for (const [name, path, isPublic] of [...PUBLIC.map((r) => [...r, true]), ...APP.map((r) => [...r, false])]) {
      if (filter && !name.includes(filter)) continue;
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const cookies = [{ name: "nova_locale", value: locale, url: "http://localhost:3000" }];
      if (!isPublic) cookies.push({ name: "nova_session", value: token, url: "http://localhost:3000" });
      await ctx.addCookies(cookies);
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && !/Download the React DevTools/.test(m.text()) && errors.push(m.text().slice(0, 160)));
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
      const res = await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" }).catch((e) => ({ status: () => `ERR ${e.message}` }));
      await page.waitForTimeout(400);
      const status = res?.status?.() ?? "?";
      const probeFn = () => {
        const vw = window.innerWidth;
        const escaping = [...document.querySelectorAll("main *, header *, aside *, nav *")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return false;
            const style = getComputedStyle(el);
            if (style.position === "fixed" || el.closest("[data-radix-popper-content-wrapper]")) return false;
            // scroll containers and their descendants are allowed to extend
            for (let p = el.parentElement; p; p = p.parentElement) {
              const s = getComputedStyle(p);
              if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return false;
            }
            return r.right > vw + 1 || r.left < -1;
          })
          .slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`);
        return {
          overflowX: document.documentElement.scrollWidth > vw + 1,
          escaping,
          dir: document.documentElement.dir,
          text: document.body.innerText.slice(0, 20000),
        };
      };
      // Pages that redirect or refresh right after load: wait and re-probe instead of aborting the sweep.
      let probe;
      for (let i = 0; ; i++) {
        try {
          probe = await page.evaluate(probeFn);
          break;
        } catch (e) {
          if (i >= 3) throw e;
          await page.waitForLoadState("networkidle").catch(() => {});
          await page.waitForTimeout(800);
        }
      }
      const raw = probe.text.match(RAW_KEY)?.[0];
      const expectedDir = locale === "ar" ? "rtl" : "ltr";
      const problems = [];
      if (status !== 200) problems.push(`status ${status}`);
      if (probe.overflowX) problems.push("page overflowX");
      if (probe.escaping.length) problems.push(`escaping: ${probe.escaping.join(", ")}`);
      if (raw) problems.push(`raw key: ${raw}`);
      if (probe.dir !== expectedDir) problems.push(`dir=${probe.dir}`);
      if (errors.length) problems.push(`console: ${errors.slice(0, 2).join(" | ")}`);
      await page.screenshot({ path: `${outDir}/${name}-${locale}-${w}.png`, fullPage: false });
      if (problems.length) findings.push(`${locale} ${w} ${name} (${path}): ${problems.join("; ")}`);
      await ctx.close();
    }
  }
}
await browser.close();
writeFileSync(`${outDir}/findings.txt`, findings.join("\n") + "\n");
console.log(findings.length ? findings.join("\n") : "no findings");
