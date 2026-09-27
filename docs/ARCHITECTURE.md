# Architecture

## Overview

```
Browser ── Next.js 16 (App Router, React 19)
             ├─ Server Components  → read models via tenant-scoped Prisma
             ├─ Server Actions     → mutations (auth, RBAC, validation, rate limits)
             ├─ Route handlers     → OAuth callbacks, uploads, signed files, public lead API, cron tick
             └─ proxy.ts           → optimistic auth redirect + /ar,/en language links
PostgreSQL 17 + pgvector ── data, job queue, scheduler, rate limits, embeddings
Worker process (npm run worker) ── jobs, scheduled work, publishing, sync, reports
External: OpenAI · Anthropic · Meta Graph · LinkedIn · TikTok · SMTP
```

One codebase, two processes: the web app and the worker share `src/server`. In development the worker can run inside the web process (`NOVA_INLINE_WORKER=true`, via `src/instrumentation.ts`).

## Layers

| Layer | Location | Rules |
| --- | --- | --- |
| Config | `src/config` | Branding, plans, agent roster. No secrets. |
| Server domain | `src/server/*` | Pure TypeScript services. The only place that touches the DB and external APIs. |
| Server actions | `src/features/*/actions.ts` | Thin wrappers built with `tenantAction()` (`src/server/action.ts`). |
| UI features | `src/features/*` | Client components grouped by feature. |
| Primitives | `src/components/ui` | Buttons, inputs, dialogs, menus, badges… built on Radix where accessibility matters. |
| Pages | `src/app` | Server Components that load data and compose features. |

## Multi-tenancy

User → OrganizationMember (role) → Organization → Workspace (default) → everything else.

- Every tenant-owned table carries `organizationId`, and workspace data also carries `workspaceId`.
- `tenantDb(scope)` (`src/server/db/tenant.ts`) is a Prisma extension that injects the scope into every read/update/delete `where`, forces it on creates, and strips it from update payloads, so rows cannot be read, changed or moved across tenants. Raw SQL is never scoped automatically; the few raw queries (retrieval, rate limit, queue) filter explicitly.
- `requireTenant()` / `resolveTenant()` (`src/server/context.ts`) resolve session → membership → workspace and expose `ctx.db` (scoped) and `ctx.can(permission)`.

## Request flow for a mutation

`tenantAction({ permission, rateLimit }, zodSchema, handler)`:
1. session → tenant resolution
2. RBAC check (`src/server/rbac.ts`)
3. per-user rate limit (Postgres fixed window)
4. zod validation
5. handler (uses services + `ctx.db`)
6. errors mapped to customer-safe codes (`UserFacingError`), details logged

Server Actions include Next.js's Origin check, which protects them against CSRF.

## Agents and the Company Brain

- `src/server/agents/runtime.ts` — `startRun()` records an `AgentRun` with high-level steps and queues it. `executeRun()` runs a workflow and updates the steps (never the model's reasoning). It also updates agent status and writes `AgentTask`s.
- Workflows: `onboarding_analysis`, `content_plan`, `campaign`, `content_rewrite`, `lead_qualify`, `leads_followup`, `performance_review`, `command` (natural-language routing).
- `loadBrain()` (`agents/brain.ts`) is the shared Company Brain snapshot every agent reads (profile, brand kit, offerings, active learnings, locale). Retrieval (RAG) comes from `knowledge/service.ts`.
- A run produces an actionable `RunResult` (title, summary, stats, items, buttons). The UI renders it as a card, not chat text.

## Background jobs

- Queue: `src/server/jobs/queue.ts`. PostgreSQL `FOR UPDATE SKIP LOCKED`, priorities, dedupe keys, exponential backoff with jitter, `DEAD` after `maxAttempts` (the dead letter), stale-lock recovery, `job_runs` history. Handlers must be idempotent.
- Scheduler: `scheduled_jobs` rows (`runner.ts`). Each tick claims due rows atomically and enqueues with a dedupe key per occurrence, so multiple workers never double-run.
- Registered job types (`jobs/handlers.ts`): `agent.run`, `knowledge.ingest`, `social.publish_due`, `social.sync_all`, `social.sync_integration`, `analytics.analyze_post`, `integrations.refresh_tokens`, `reports.daily_briefs` / `daily_brief`, `reports.weekly_reports` / `weekly_report`, `sales.followups_due`, `agent.weekly_plan`, `privacy.export`, `privacy.delete_org`, `system.cleanup`.
- Idempotency: publishing claims a `PENDING` publication before calling the provider; follow-up reminders claim `remindedAt`; reports upsert per period; sync upserts posts and appends snapshots.
- Alternative trigger: `POST /api/cron/tick` (Bearer `CRON_SECRET`) drains the queue for serverless hosts.

## Internationalisation

next-intl without URL locales: the locale comes from a cookie (`nova_locale`), falling back to Accept-Language. `/ar/...` and `/en/...` links set the cookie and redirect. Catalogs are split by namespace (`src/i18n/messages/{en,ar}/*.json`). A unit test enforces identical keys across languages. Layouts use logical CSS properties (`ms-`, `ps-`, `start-`) so RTL flips correctly. Dates render in the organization's time zone.

## Design system

Tokens are defined in `src/app/globals.css`: warm-white canvas, charcoal ink, one ember accent, and subtle agent accents. They are exposed to Tailwind v4 via `@theme inline`. A dark theme is driven by `data-theme` from a cookie. Motion honours `prefers-reduced-motion`. Fonts are Geist (Latin), IBM Plex Sans Arabic, and Instrument Serif for accents.
