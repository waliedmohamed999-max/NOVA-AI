// Small, dependency-free load smoke test. Hits read-only / rejecting endpoints only — it never signs up,
// publishes, sends or charges. Run it against LOCAL or a dedicated staging instance, never production.
//
//   BASE_URL=http://localhost:3100 DURATION_S=20 CONCURRENCY=20 node scripts/load/smoke-load.mjs
//
// Prints per-endpoint throughput, p50/p95/p99 latency and status distribution. Exit 1 when any endpoint
// has 5xx responses or p95 above P95_BUDGET_MS (default 1500).
const BASE = (process.env.BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const DURATION_MS = Number(process.env.DURATION_S ?? 20) * 1000;
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const P95_BUDGET_MS = Number(process.env.P95_BUDGET_MS ?? 1500);

if (/nova|hostinger|vercel\.app/i.test(BASE) && process.env.I_KNOW_THIS_IS_STAGING !== "true") {
  console.error(`Refusing to load-test ${BASE}: set I_KNOW_THIS_IS_STAGING=true for a dedicated staging instance.`);
  process.exit(1);
}

const TARGETS = [
  { name: "GET /api/health (liveness)", path: "/api/health" },
  { name: "GET /api/ready (db + checks)", path: "/api/ready" },
  { name: "GET / (marketing SSR)", path: "/" },
  { name: "GET /sign-in (SSR)", path: "/sign-in" },
  { name: "GET /home (unauth → redirect)", path: "/home", redirect: "manual" },
  { name: "POST unknown lead form (404 path)", path: "/api/public/leads/does-not-exist", method: "POST", body: JSON.stringify({ name: "x" }) },
  { name: "POST stripe webhook, bad signature", path: "/api/webhooks/stripe", method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=00" } },
];

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

async function run(t) {
  const lat = [];
  const statuses = {};
  let errors = 0;
  const end = Date.now() + DURATION_MS;
  async function worker() {
    while (Date.now() < end) {
      const s = performance.now();
      try {
        const res = await fetch(BASE + t.path, { method: t.method ?? "GET", body: t.body, redirect: t.redirect ?? "follow", headers: { "content-type": "application/json", ...(t.headers ?? {}) } });
        await res.arrayBuffer();
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
      } catch {
        errors++;
      }
      lat.push(performance.now() - s);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  lat.sort((a, b) => a - b);
  return { name: t.name, requests: lat.length, rps: +(lat.length / (DURATION_MS / 1000)).toFixed(1), p50: +pct(lat, 50).toFixed(0), p95: +pct(lat, 95).toFixed(0), p99: +pct(lat, 99).toFixed(0), statuses, errors };
}

console.log(`Load smoke: ${BASE} · ${CONCURRENCY} concurrent · ${DURATION_MS / 1000}s per endpoint\n`);
let failed = false;
for (const t of TARGETS) {
  const r = await run(t);
  const fiveXX = Object.entries(r.statuses).filter(([s]) => Number(s) >= 500).reduce((a, [, n]) => a + n, 0);
  const bad = fiveXX > 0 || r.errors > 0 || r.p95 > P95_BUDGET_MS;
  failed ||= bad;
  console.log(`${bad ? "✗" : "✓"} ${r.name.padEnd(38)} ${String(r.requests).padStart(6)} req  ${String(r.rps).padStart(7)} rps  p50 ${String(r.p50).padStart(5)}ms  p95 ${String(r.p95).padStart(5)}ms  p99 ${String(r.p99).padStart(5)}ms  ${JSON.stringify(r.statuses)}${r.errors ? `  errors ${r.errors}` : ""}`);
}
process.exit(failed ? 1 : 0);
