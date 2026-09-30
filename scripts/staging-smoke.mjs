// Staging smoke check (Blocker 1 gate). Read-only: no sign-up, no send, no charge, no secret needed.
//
//   BASE_URL=https://staging.example.com node scripts/staging-smoke.mjs
//   READY_TOKEN=… adds the detailed /api/ready checks (never printed).
//
// Checks: public HTTPS + HSTS, the app's own CSP (nonce) reaches the browser (a CDN must not replace it),
// clickjacking protection, request ids, liveness, readiness (db/config/storage/worker), fail-closed
// machine endpoints (webhooks without signatures, cron without secret). Exit 1 on any failure.
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
if (!/^https:\/\//.test(BASE)) {
  console.error("BASE_URL must be the public https:// staging origin");
  process.exit(1);
}
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });
const get = (path, init = {}) => fetch(BASE + path, { redirect: "manual", ...init, signal: AbortSignal.timeout(20_000) });

const page = await get("/sign-in");
const csp = page.headers.get("content-security-policy") ?? "";
check("HTTPS page answers", page.status === 200, `HTTP ${page.status}`);
check("HSTS header", /max-age=\d{7,}/.test(page.headers.get("strict-transport-security") ?? ""));
check("App CSP reaches the browser (nonce-based script-src)", /script-src[^;]*'nonce-/.test(csp), csp ? `got: ${csp.slice(0, 80)}` : "no CSP header");
check("Clickjacking protection on app pages", /SAMEORIGIN|DENY/i.test(page.headers.get("x-frame-options") ?? "") || /frame-ancestors 'self'|frame-ancestors 'none'/.test(csp));
check("x-request-id on responses", Boolean(page.headers.get("x-request-id")));

const health = await get("/api/health");
check("/api/health 200", health.status === 200, `HTTP ${health.status}`);

const headers = process.env.READY_TOKEN ? { authorization: `Bearer ${process.env.READY_TOKEN}` } : {};
const readyRes = await get("/api/ready", { headers });
let ready = null;
try {
  ready = await readyRes.json();
} catch {}
check("/api/ready status ok", readyRes.status === 200 && ready?.status === "ok", `HTTP ${readyRes.status} ${ready ? JSON.stringify(Object.fromEntries(Object.entries(ready.checks ?? {}).map(([k, v]) => [k, v.status]))) : ""}`);
for (const k of ["database", "config", "storage", "worker"]) check(`  ready.${k}`, ready?.checks?.[k]?.status === "ok", ready?.checks?.[k]?.detail ?? ready?.checks?.[k]?.status ?? "missing");

const stripe = await get("/api/webhooks/stripe", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
check("Stripe webhook rejects unsigned", stripe.status === 400, `HTTP ${stripe.status}`);
const wa = await get("/api/webhooks/whatsapp", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
check("WhatsApp webhook rejects unsigned", wa.status === 401, `HTTP ${wa.status}`);
const waVerify = await get("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1");
check("WhatsApp verify rejects a wrong token", waVerify.status === 403, `HTTP ${waVerify.status}`);
const cron = await get("/api/cron/tick", { method: "POST" });
check("Cron tick refuses without secret", cron.status === 401, `HTTP ${cron.status}`);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
}
console.log(`\n${failed ? `${failed} check(s) failed` : "all checks passed"} — ${BASE}`);
process.exit(failed ? 1 : 0);
