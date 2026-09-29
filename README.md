# NOVA — AI Growth Team

NOVA is a multi-tenant SaaS in which a company "hires" an AI marketing and sales team through one interface. The team plans and writes content, sends it for approval, publishes it, learns from real results, captures and qualifies leads, and moves them toward a sale.

Arabic (RTL) and English (LTR) are both first-class throughout the product.

> **Branding:** the product name, cookies and brand settings live in [`src/config/brand.ts`](src/config/brand.ts). Rename the product there.

---

## Contents

1. [What the product does](#what-the-product-does)
2. [Tech stack](#tech-stack)
3. [Requirements](#requirements)
4. [Quick start (local)](#quick-start-local)
5. [Configuration (`.env`)](#configuration-env)
6. [Connecting accounts (OAuth)](#connecting-accounts-oauth)
7. [Project structure](#project-structure)
8. [Core concepts](#core-concepts)
9. [Scripts](#scripts)
10. [Testing](#testing)
11. [Troubleshooting](#troubleshooting)
12. [Documentation](#documentation)
13. [Status and production readiness](#status-and-production-readiness)

---

## What the product does

| Area | What it does | Where |
| --- | --- | --- |
| **Home — Command Center** | One input that runs real actions: navigation, reads, creates, and high-risk actions that go through approvals. Known commands run locally with no AI. Company questions are answered from the Company Brain first; AI is the last resort. | `src/app/(app)/home`, `src/server/command` |
| **AI team (agents)** | Content strategist, designer, social manager, performance analyst, sales agent and sales assistant. They run as background workflows with visible progress. | `src/server/agents` |
| **Content & Content Studio** | Weekly plans, posts, carousels, video plans and designs. Improve / quality-check / adapt for each platform, with version history. | `src/app/(app)/content`, `src/server/studio` |
| **Calendar & publishing** | Scheduling, then publishing to connected accounts after approval. | `src/app/(app)/calendar`, `src/server/social` |
| **Sales Desk (CRM)** | Customers, opportunities, B2B, quotes, follow-ups, pipeline, forecast, CSV import and conversations. | `src/app/(app)/sales`, `src/server/sales` |
| **Company Brain** | Everything NOVA knows about the company: profile, products, customers and segments, strategy, competitors, sales and content knowledge, FAQs, sources, imports (website / store / CSV / Excel / PDF / Word), health, and structured facts with source, trust and approval. | `src/app/(app)/knowledge`, `src/server/brain` |
| **Approvals** | Content, publishing, campaigns, sales messages, prices and discounts. Policies decide what needs a human. | `src/app/(app)/approvals`, `src/server/approvals` |
| **Analytics & reports** | Real metrics, a daily brief, a weekly report and performance insights. | `src/app/(app)/analytics`, `src/server/reports` |
| **Integrations** | Meta (Facebook/Instagram), LinkedIn, TikTok, Google (Gmail + Calendar), Microsoft (Outlook + Calendar), WhatsApp Cloud API, and email (SMTP / Resend / Postmark). | `src/server/integrations`, `src/server/whatsapp` |
| **Billing** | Plans (Starter / Growth / Scale) with limits enforced, and Stripe (Checkout, Portal, webhook). | `src/server/billing`, `src/config/plans.ts` |
| **Platform admin** | Organizations, users, AI usage and Command Center routing, provider readiness and live tests, jobs, incidents. | `src/app/admin` |
| **Public lead capture** | Embeddable form plus a public API per workspace. | `src/app/embed/lead/[key]`, `src/app/api/public/leads/[key]` |

---

## Tech stack

- **Web:** Next.js 16 (App Router, Server Actions, Turbopack) + React 19 + Tailwind CSS.
- **Database:** PostgreSQL 17 + **pgvector** (knowledge embeddings) through Prisma 7.
- **Jobs:** a database-backed queue and scheduler. Run it as a separate worker, or inline in development.
- **AI:** Anthropic and/or OpenAI through one router, with per-organization budgets, cost logging, and an **offline provider for development only**.
- **i18n:** next-intl (Arabic / English).
- **Tests:** Vitest (unit + integration) and Playwright (E2E).

---

## Requirements

- **Node.js 22+** (see `engines` in `package.json`).
- **Docker Desktop** for PostgreSQL + pgvector and Mailpit.
- No provider keys are required to run locally: use the offline AI mode and Mailpit (see below).

---

## Quick start (local)

### 1. Start the infrastructure

```bash
docker compose up -d
```

- **PostgreSQL + pgvector** on port **5434**. On first run, the init script also creates the test database `nova_test`.
- **Mailpit** (a local mailbox that catches every email) at <http://localhost:8025>. SMTP is on port 1025.

### 2. Create `.env`

```bash
cp .env.example .env
```

Two values are required. Generate them like this:

```bash
# AUTH_SECRET — signs file URLs and other HMACs (32+ chars)
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# ENCRYPTION_KEY — 32-byte base64 key; encrypts OAuth tokens and credentials at rest (AES-256-GCM)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

For development with no AI keys, also set:

```env
AI_OFFLINE_MODE="true"      # development-only AI provider (refused in production)
NOVA_INLINE_WORKER="true"   # run background jobs inside the dev server (no separate worker)
```

### 3. Install, migrate, seed

```bash
npm install          # also runs `prisma generate`
npm run db:migrate   # apply all migrations
npm run db:seed      # optional: a demo workspace (development only)
```

### 4. Run

```bash
npm run dev          # http://localhost:3000
npm run worker       # only if NOVA_INLINE_WORKER is not "true"
```

**Demo login (after seeding):** `demo@nova.local` / `NovaDemo2026!`. This account is also a platform admin. Every demo row is flagged, and the UI shows a "demo data" banner.

> Open the app at **`http://localhost:3000`**, the same host as `APP_URL`. OAuth callbacks are built from `APP_URL`. If you open it at `127.0.0.1`, see [Troubleshooting](#troubleshooting).

---

## Configuration (`.env`)

Every variable is documented in [`.env.example`](.env.example). The main groups:

| Group | Key variables | Notes |
| --- | --- | --- |
| **Core** | `DATABASE_URL`, `TEST_DATABASE_URL`, `APP_URL`, `APP_ENV`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `TRUST_PROXY` | `APP_ENV=staging` or `production` enforces public HTTPS callbacks. |
| **Email** | `RESEND_API_KEY` / `POSTMARK_SERVER_TOKEN` / `SMTP_*`, `EMAIL_FROM` | Mailpit is for development only; production refuses it. |
| **AI** | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_PRIMARY_PROVIDER`, `OPENAI_*` models and prices, `AI_OFFLINE_MODE`, `AI_DEMO_MODE` | With no real key, AI features say "not set up". `AI_DEMO_MODE="true"` turns on the template-based demo AI (also in production), clearly labelled "Demo AI", until a key is added. |
| **Social** | `META_*`, `INSTAGRAM_*`, `LINKEDIN_*`, `TIKTOK_*` | Official OAuth only; tokens are encrypted at rest. |
| **Google / Microsoft** | `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET/TENANT_ID` | Gmail/Outlook sending plus calendar. Scopes are requested progressively. |
| **WhatsApp** | `WHATSAPP_*` | Official Cloud API only (no WhatsApp Web, no personal numbers). Customers connect with Meta Embedded Signup (`WHATSAPP_APP_ID`, `WHATSAPP_EMBEDDED_CONFIG_ID`, `WHATSAPP_APP_SECRET`); webhook: `{APP_URL}/api/webhooks/whatsapp`. See [docs/WHATSAPP.md](docs/WHATSAPP.md). |
| **Billing** | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | Payments stay off until key, webhook secret and prices are all set. Plans change only from the webhook. |
| **Jobs** | `NOVA_INLINE_WORKER` | `true` in development only. In production run `npm run worker`. |
| **Storage** | `STORAGE_DRIVER` (`local` / `s3`), `S3_*` | S3-compatible (AWS S3, Cloudflare R2, MinIO). The bucket must be private. |
| **Observability** | `SENTRY_DSN`, `LOG_LEVEL` | Optional. |

> `.env` is read only when the server starts. **Restart the dev server after every change.** Never commit `.env`; it is git-ignored.

---

## Connecting accounts (OAuth)

End users connect their own accounts from **Settings → Connected accounts**. They click **Connect**, sign in on the provider's own page and allow access. NOVA never sees passwords.

Before that button works, the platform owner registers NOVA **once** as an app with each provider and puts the app keys in `.env`. Until then, the card shows "Not available yet". The callbacks to register:

| Provider | Callback URL (local) | Notes |
| --- | --- | --- |
| Google | `http://localhost:3000/api/integrations/google/callback` (+ `/api/auth/google/callback` for sign-in) | Enable Gmail API + Calendar API. In Testing mode, add yourself as a test user. |
| Microsoft | `http://localhost:3000/api/integrations/microsoft/callback` | Graph delegated: `offline_access`, `User.Read`, `Mail.Send`, `Calendars.ReadWrite`. |
| Facebook Pages | `http://localhost:3000/api/integrations/meta/callback` | Page management needs Meta App Review. |
| Instagram | `http://localhost:3000/api/integrations/instagram/callback` | Instagram API with Instagram Login; a Business/Creator account. |
| LinkedIn | `http://localhost:3000/api/integrations/linkedin/callback` | Company pages need the Community Management API. |
| TikTok | `https://<your-https-url>/api/integrations/tiktok/callback` | Needs **HTTPS**: use a tunnel (e.g. `ngrok http 3000`) and set `APP_URL` to it. |

- **Validate keys** before connecting, from **`/admin/providers`** (the **Validate** button).
- The live callback matrix, computed from your configuration, is also on that page.
- For staging (HTTPS, real providers), see [docs/STAGING.md](docs/STAGING.md) and [docs/LIVE-READINESS.md](docs/LIVE-READINESS.md).

---

## Project structure

```text
src/
├─ app/                     Next.js routes
│  ├─ (marketing)/          landing page
│  ├─ (auth)/               sign-in, sign-up, magic link, password reset
│  ├─ onboarding/           conversational onboarding
│  ├─ (app)/                the product: home, team, content, calendar, social, leads,
│  │                        sales, analytics, approvals, campaigns, inbox, knowledge
│  │                        (Company Brain), brand, reports, activity, settings, help
│  ├─ admin/                platform admin (providers, AI usage, jobs, incidents…)
│  ├─ embed/                embeddable lead form
│  └─ api/                  uploads, files, OAuth callbacks, webhooks (Stripe, WhatsApp),
│                           public lead API, cron
├─ server/                  domain logic (server-only)
│  ├─ command/              Command Center: intent registry, parser, handlers, routing
│  ├─ brain/                Company Brain: facts, entities, imports, customers, strategy…
│  ├─ knowledge/            knowledge sources, chunks, selective retrieval, per-use-case contexts
│  ├─ agents/               agent runtime and workflows (content, sales, analyst, onboarding)
│  ├─ ai/                   AI router, providers, budgets, cost logging, attribution
│  ├─ sales/ approvals/ content/ studio/ social/ campaigns/ calendar/ analytics/ reports/
│  ├─ integrations/ whatsapp/ email/ billing/ storage/ jobs/ tenancy/ auth/ security/
│  └─ db/                   Prisma client and the tenant-scoped client (tenantDb)
├─ features/                UI features (client + server components per area)
├─ components/              UI primitives (buttons, dialogs, inputs, shell)
├─ config/                  brand, plans, agents
├─ i18n/                    next-intl config + messages (ar / en)
├─ lib/                     shared pure helpers (e.g. Company Brain field definitions)
└─ worker/                  background worker entry (`npm run worker`)
prisma/                     schema, migrations, seed
tests/                      unit, integration, e2e (+ fixtures)
docs/                       architecture, security, deployment, integrations…
```

---

## Core concepts

- **Multi-tenancy:** every row belongs to an organization and a workspace. Server code uses `tenantDb(scope)`, which injects the scope into every query, so data can't leak between tenants. See [docs/RLS.md](docs/RLS.md).
- **RBAC:** roles are Viewer, Member, Manager, Admin and Owner. Every server action checks its permission (`src/server/rbac.ts`).
- **Approvals:** risky actions never go out directly: publishing, messages, prices, discounts, contracts. The approval policies decide.
- **Jobs:** long work (agent runs, imports, publishing, syncs) runs in the job queue with retries, dead-letters and a scheduler.
- **AI routing:**
  - One router picks the model, enforces the budget and logs tokens and cost per call.
  - Without a real provider, AI features say they aren't set up.
  - `AI_OFFLINE_MODE` exists only for development and tests.
- **Company-Brain-first:**
  - Commands and agents read the Company Brain selectively: structured facts → approved entities → summaries → text chunks, each with a token budget per use case.
  - The full company profile is never sent to a model.
  - Every AI call records its context size and sources in `ai_runs`.
- **i18n:** all UI text lives in `src/i18n/messages/{ar,en}`. Arabic is RTL and first-class.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (http://localhost:3000). |
| `npm run build` / `npm run start` | Production build (webpack) and server. |
| `npm run build:turbo` | Production build with Turbopack (faster locally; see Troubleshooting for hosting). |
| `npm run worker` | Job worker + database-backed scheduler. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | TypeScript (`tsc --noEmit`). |
| `npm test` / `npm run test:watch` | Unit + integration tests (Vitest) on `TEST_DATABASE_URL`. |
| `npm run test:e2e` | End-to-end tests (Playwright). |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`). |
| `npm run db:migrate:dev` | Create a new migration in development. |
| `npm run db:seed` | Seed the demo workspace (development only). |
| `npm run db:reset` | **Wipe** the database and re-apply migrations. |

---

## Testing

**Unit + integration**

```bash
npm test
```

- Runs against **`TEST_DATABASE_URL`** (`nova_test`, created by Docker on first start) and applies migrations automatically.
- Always uses the offline AI provider, and no real OAuth keys: provider HTTP is mocked.

**End-to-end**

```bash
npm run test:e2e
```

- Runs against a dev server on `http://localhost:3000` (or `E2E_BASE_URL`). If none is running, it starts one.
- The dev server needs `AI_OFFLINE_MODE="true"` and `NOVA_INLINE_WORKER="true"`, plus Mailpit running (emails are read from it).
- The Company Brain website-import test reads fixture pages from `tests/e2e/fixtures/web`. Start the dev server with `BRAIN_FETCH_FIXTURES=true` for E2E runs only. It is ignored in production, and it only serves `*.fixture.test` hosts.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| The page renders but nothing responds (no buttons, no menu) | The app is open at `127.0.0.1` instead of `localhost`. `allowedDevOrigins` in `next.config.ts` allows `127.0.0.1`, but use `http://localhost:3000` (it matches `APP_URL`). Hard-refresh with `Ctrl + Shift + R`. |
| A provider shows "Not available yet" | Its app keys aren't in `.env`. Add them (see [Connecting accounts](#connecting-accounts-oauth)) and restart the server. |
| "Unknown argument" / Prisma errors after pulling | Run `npm run db:migrate` and `npx prisma generate`, then restart the dev server. |
| Background tasks never finish in development | `NOVA_INLINE_WORKER` isn't `true` and no `npm run worker` is running, or the database was down when the server started. Restart it. |
| Database connection refused | Docker isn't running: start Docker Desktop, then `docker compose up -d`. |
| AI features say "not set up" | Expected without `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`. In development set `AI_OFFLINE_MODE="true"`; on a deployed demo set `AI_DEMO_MODE="true"` until the key is added. |
| Build fails on a host with `TurbopackInternalError … globals.css … node process exited before we could connect to it` | The host restricts child processes, which Turbopack uses to run PostCSS/Tailwind. `npm run build` uses webpack for this reason (PostCSS runs in-process). Make sure the host runs `npm run build`, not `next build` directly. |
| "You're going a little fast" during E2E | The auth rate limits are real. The suite resets them at start; re-run the suite rather than single tests in a loop. |

---

## Documentation

| Document | Covers |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | System design and main flows. |
| [AI system](docs/AI-SYSTEM.md) | Router, providers, budgets, agents, prompts. |
| [Database](docs/DATABASE.md) | Schema overview and conventions. |
| [Tenant isolation](docs/RLS.md) | How tenant scoping is enforced. |
| [Integrations](docs/INTEGRATIONS.md) | Each provider: setup, scopes, what is tested. |
| [Security](docs/SECURITY.md) | Auth, secrets, SSRF, CSP, rate limits. |
| [Local development](docs/LOCAL-DEVELOPMENT.md) | Local setup in more depth. |
| [Deployment](docs/DEPLOYMENT.md) | Production setup, proxy, CSP, storage. |
| [Staging](docs/STAGING.md) | HTTPS staging, callback matrix, validation checklist. |
| [Live readiness](docs/LIVE-READINESS.md) | Provider status, manual live tests, next actions. |
| [Backups](docs/BACKUPS.md) | Backup and restore drills. |

---

## Status and production readiness

**NOVA is not production-ready yet.**

- **Integrations:** the Meta, Instagram, LinkedIn, TikTok, Google, Microsoft, WhatsApp, Stripe, OpenAI and Anthropic adapters are implemented against the official APIs, with automated tests using mocked provider HTTP. Validation against real provider accounts is still in progress. The current status per provider is in [docs/LIVE-READINESS.md](docs/LIVE-READINESS.md) and on `/admin/providers`.
- **Billing:** Stripe Checkout, Customer Portal and the webhook (`/api/webhooks/stripe`) are implemented. Plans change only when the webhook confirms. They have not yet been validated on a live Stripe account.
- **Storage:** local disk or any S3-compatible store. The S3 driver is validated against MinIO and AWS SigV4 test vectors, not yet against a real AWS or R2 bucket.
- **Before production:**
  - public HTTPS callbacks (`APP_ENV=production`);
  - a real email provider;
  - an S3/R2 bucket;
  - provider app reviews (Meta, Google, TikTok);
  - live validation of every provider;
  - a backup restore drill.
