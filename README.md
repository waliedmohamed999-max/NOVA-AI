# NOVA — AI Growth Team

A multi-tenant SaaS where a company "hires" an AI social media team and an AI sales team from one simple interface: plan and create content, get approval, publish, learn from real results, capture and qualify leads, and move them toward a sale. Arabic (RTL) and English (LTR) are both first-class.

> Branding lives in `src/config/brand.ts`. Rename the product there.

## What's inside

| Area | Where |
| --- | --- |
| Landing page, auth, onboarding | `src/app/(marketing)`, `src/app/(auth)`, `src/app/onboarding` |
| App (home, AI team, content, calendar, social, leads, sales, analytics, approvals, campaigns, inbox, company brain, brand kit, reports, activity, settings) | `src/app/(app)` |
| Platform admin | `src/app/admin` |
| Public lead capture (embed + API) | `src/app/embed/lead/[key]`, `src/app/api/public/leads/[key]` |
| Domain services (tenancy, auth, AI, agents, content, sales, social, billing, jobs…) | `src/server` |
| UI features and primitives | `src/features`, `src/components` |
| Schema and migrations | `prisma/` |
| Background worker | `src/worker/index.ts` |
| Tests | `tests/unit`, `tests/integration`, `tests/e2e` |

## Quick start (local)

```bash
docker compose up -d           # PostgreSQL + pgvector (port 5434) and Mailpit (8025)
cp .env.example .env           # fill AUTH_SECRET and ENCRYPTION_KEY (see comments)
npm install                    # also runs prisma generate
npm run db:migrate             # apply migrations
npm run db:seed                # optional demo workspace (dev only)
npm run dev                    # http://localhost:3000
npm run worker                 # background jobs (or NOVA_INLINE_WORKER=true in dev)
```

Demo login after seeding: `demo@nova.local` / `NovaDemo2026!` (platform admin). Every demo row is flagged and the UI shows a "demo data" banner.

For AI without keys in development, set `AI_OFFLINE_MODE=true` (refused in production). With `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set, real models are used.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run worker` | Job worker + database-backed scheduler |
| `npm run typecheck` / `lint` | TypeScript and ESLint |
| `npm test` | Unit + integration tests (uses `TEST_DATABASE_URL`, wiped per run) |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run db:migrate` / `db:seed` / `db:reset` | Database |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [AI system](docs/AI-SYSTEM.md)
- [Database](docs/DATABASE.md)
- [Integrations](docs/INTEGRATIONS.md)
- [Security](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Local development](docs/LOCAL-DEVELOPMENT.md)

## Status of external integrations

Adapters for Meta (Facebook/Instagram), LinkedIn, TikTok, OpenAI and Anthropic are implemented against the official APIs. They have **not** been validated against real provider accounts in this repository; see `docs/INTEGRATIONS.md` for what is tested and how. A payment-processor adapter is not bundled: billing plans, limits and enforcement work, and paid plan changes report "not configured" until an adapter is added.

**Production readiness is blocked by the Stripe implementation and by remaining real-provider validation.**

- **Payments:**
  - Exists: the `PaymentProvider` interface, `setPaymentProvider()`, `confirmPlanChange()`, an idempotency-ready `billing_events` table and the `invoices` table.
  - Missing: the Stripe adapter and webhook are **not implemented**.
- **Storage:** local disk or any S3-compatible store (AWS S3, Cloudflare R2, MinIO). The S3 driver is validated against MinIO and AWS's SigV4 test vectors, not yet against a real AWS or R2 bucket.
- **Deployment behind a proxy:** set `TRUST_PROXY`. See [Deployment](docs/DEPLOYMENT.md) for proxy setup, CSP and storage.
