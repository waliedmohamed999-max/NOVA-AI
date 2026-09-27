# PostgreSQL Row-Level Security: feasibility report & migration plan

**Decision for this phase: not enabled.** RLS adds real protection, but turning it on safely with Prisma 7 requires changes to how every tenant request uses database connections. Doing that at the end of a release phase would risk outages and cross-tenant false negatives, and those would be hard to see in tests. This document explains why, and gives the plan to do it properly.

## How isolation works today

- **`tenantDb(scope)`** (`src/server/db/tenant.ts`) is a Prisma extension.
  - It injects `organizationId` / `workspaceId` into every read, update and delete on the ~45 tenant models.
  - It writes the scope into every create.
  - It strips scope keys from updates, so a row can't be moved to another tenant.
- **The base `db` client** is imported by about 68 server modules: auth, platform admin, the job worker, webhooks, public lead capture and cross-tenant schedulers. These code paths are either cross-tenant by design or scope themselves explicitly.
- **Six raw SQL call sites** are not covered by the extension: the job queue claim, knowledge vector/keyword search (4) and rate limiting. The knowledge queries filter by organization/workspace by hand.
- **Tests:**
  - tenant isolation tests (`tests/integration/tenancy-auth.test.ts`);
  - IDOR tests on the new features: meetings, carousel slides, attribution ids;
  - security retest in the final report.

The remaining risk RLS would cover: a future code path that uses the base `db` client (or raw SQL) with a missing tenant filter. Today that is caught only by review and tests, not by the database.

## Why not just switch it on

1. **Table owner bypass.** The app connects as the role that owns the tables, and owners bypass RLS unless it is `FORCE`d. Forcing it without a separate runtime role would also block migrations and the worker.
2. **Session variables and pooling.** Policies need the tenant id, e.g. `current_setting('app.organization_id')`.
   - With `@prisma/adapter-pg`, each query can land on a different pooled connection.
   - The value must therefore be set with `SET LOCAL` / `set_config(…, true)` inside the same transaction as the query.
   - Prisma has no per-query hook for this, so every tenant operation has to run inside `$transaction([set_config, query])`. That adds one round trip per operation and changes behaviour for nested/interactive transactions.
3. **Legitimate cross-tenant paths.** The worker, schedulers, webhooks (Stripe, WhatsApp), public lead capture, magic-link sign-in and platform admin all read across tenants or before a tenant is known. Each needs either a `BYPASSRLS` role or explicit policy exceptions, and each exception is a new place to get wrong.
4. **Failure mode.** A missed `set_config` makes queries silently return zero rows instead of failing. That looks like "no data" rather than an error.

None of this is blocked by Prisma. It is work that has to be staged.

## Migration plan

**Phase 0 — roles.**
- Create `nova_migrator` (owner: runs `prisma migrate`), `nova_app` (web, **no** BYPASSRLS) and `nova_system` (worker, webhooks and admin, BYPASSRLS).
- Grant `nova_app` DML only.
- Split `DATABASE_URL` into `DATABASE_URL` (app) and `DATABASE_URL_SYSTEM` (system).
- Exit: the app runs normally on `nova_app` while no policies exist yet.

**Phase 1 — plumbing, policies in shadow mode.**
- Add `withTenant(scope, fn)`. It opens a transaction, runs `select set_config('app.organization_id', $1, true), set_config('app.workspace_id', $2, true)`, then runs the scoped queries.
- Change `tenantDb(scope)` to route through it.
- Add policies as `PERMISSIVE` with a logging-only trigger, or test them against a replica, to find paths that don't set the context.
- Exit: zero "missing context" hits for a week of staging traffic.

**Phase 2 — enforce on the highest-value tables first.** Enable and force RLS on:
- `integration_credentials`, `integrations`, `leads`, `messages`, `conversations`, `file_objects`, `invoices`, `subscriptions`.

The policy for each is:

```sql
alter table leads enable row level security;
alter table leads force row level security;
create policy tenant_isolation on leads
  using ("organizationId" = current_setting('app.organization_id', true)
     and "workspaceId"    = current_setting('app.workspace_id', true))
  with check ("organizationId" = current_setting('app.organization_id', true)
     and "workspaceId"    = current_setting('app.workspace_id', true));
```

Organization-level tables compare only `organizationId`. Exit: the full test suite and E2E pass on `nova_app`, and cross-tenant tests now fail at the database too.

**Phase 3 — remaining tenant tables.** Enforce on the rest of the tenant tables. Move the 6 raw SQL sites to `withTenant` or to `nova_system` with a documented reason.

**Phase 4 — guardrails.**
- A CI check that every table in `WORKSPACE_MODELS` / `ORGANIZATION_MODELS` has RLS forced.
- An integration test that runs a tenant query without context and expects zero rows.

**Estimated effort:** 3–5 engineering days plus a week of staging soak. Performance cost: one extra round trip per tenant operation, which in practice becomes one `set_config` per request batch, measured in Phase 1.

## What was hardened now instead

- New tenant models (`Meeting`, `CarouselSlide`, `WhatsAppNumber`) are registered in `WORKSPACE_MODELS`, so `tenantDb` scopes them.
- Every new service that takes an id resolves it through `tenantDb(scope)` or an explicit `{ id, ...scope }` filter, with cross-tenant tests:
  - meetings;
  - slides;
  - attribution post/content ids, which are only accepted when they belong to the workspace.
