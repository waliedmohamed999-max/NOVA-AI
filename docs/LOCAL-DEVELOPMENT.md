# Local development

## Prerequisites

Node 22+ (tested with 24), npm, Docker.

## Setup

```bash
docker compose up -d      # nova-postgres on :5434 (pgvector, creates nova + nova_test) and Mailpit on :1025/:8025
cp .env.example .env
# generate AUTH_SECRET and ENCRYPTION_KEY (commands are in .env.example)
# for development without AI keys:
#   AI_OFFLINE_MODE="true"
#   NOVA_INLINE_WORKER="true"
npm install
npm run db:migrate
npm run db:seed           # demo workspace: demo@nova.local / NovaDemo2026!
npm run dev
```

Open:
- http://localhost:3000 — landing page (use `/ar` for Arabic)
- http://localhost:8025 — Mailpit (verification, magic-link and invitation emails)

## Worker

With `NOVA_INLINE_WORKER=true` the worker runs inside `next dev`. To mirror production instead, set it to `false` and run `npm run worker` in a second terminal.

## Tests

```bash
npm test               # unit + integration (TEST_DATABASE_URL, wiped each run, offline AI)
npm run test:e2e       # Playwright; starts the app on :3100 against the dev database
```

The E2E suite needs the dev database migrated. It creates its own users and organizations with unique emails.

## Useful paths

| Need | Where |
| --- | --- |
| Add a translation | `src/i18n/messages/{en,ar}/<namespace>.json` (the parity test fails if a key is missing in one language) |
| Add a job type | register in `src/server/jobs/handlers.ts` |
| Add an agent workflow | `defineWorkflow()` in `src/server/agents/workflows/*`, import it in `agents/jobs.ts` |
| Add a tenant table | add `organizationId`/`workspaceId` and list the model in `src/server/db/tenant.ts` |
| Mutations | `tenantAction()` in `src/features/<feature>/actions.ts` |

## Gotchas

- `prisma migrate dev` needs an interactive terminal. In scripts, use `prisma migrate diff … --script` plus `migrate deploy` (see DATABASE.md).
- After changing the Prisma schema, restart `next dev` so the regenerated client is loaded.
- Ports 5432/5433/6379 may already be used by other projects; this repository uses 5434.
