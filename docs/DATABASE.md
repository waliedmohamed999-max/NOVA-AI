# Database

PostgreSQL 17 with the `vector` extension. Prisma 7 (`prisma-client` generator → `src/generated/prisma`, pg driver adapter). The schema is in `prisma/schema.prisma` and migrations in `prisma/migrations`.

## Conventions

- Tables are snake_case (`@@map`) and IDs are `cuid()`. Tables have `createdAt`/`updatedAt` where it makes sense.
- **Tenant columns:** `organizationId` on every tenant table and `workspaceId` on workspace data. Tenant-leading composite indexes exist (e.g. `[organizationId, workspaceId, status]`).
- **Sensitive columns are omitted by default** in the Prisma client (`user.passwordHash`, `integrationCredential.*TokenEnc`, `oAuthState.codeVerifierEnc`). Code must opt in explicitly.
- **Append-only tables:** `audit_logs`, `lead_events` and `social_metric_snapshots` have a `BEFORE UPDATE` trigger that raises. History is inserted, never rewritten.
- **Search indexes:** a GIN full-text index and an HNSW vector index on `knowledge_chunks` are written by hand into the init migration. When generating new migrations with `prisma migrate diff`, delete any `DROP INDEX knowledge_chunks_*` lines Prisma proposes.

## Entity groups

| Group | Tables |
| --- | --- |
| Identity | users, sessions, verification_tokens, oauth_accounts, rate_limit_buckets |
| Tenancy | organizations, organization_members, invitations, workspaces, workspace_settings |
| Billing | subscriptions, ai_budgets, usage_records, billing_events, invoices |
| Company Brain | company_profiles, offerings, brand_kits, brand_assets, design_templates, knowledge_sources, knowledge_documents, knowledge_chunks (vector(1536)), file_objects |
| Agents | agents, agent_runs, agent_tasks |
| Integrations | integrations, integration_accounts, integration_credentials (encrypted), oauth_states |
| Content | campaigns, content_items, content_versions, content_assets, content_approvals |
| Social | social_posts, social_publications, social_metrics, social_metric_snapshots, account_metric_snapshots |
| Sales | leads, lead_events, lead_scores, lead_notes, lead_capture_forms, conversations, conversation_participants, messages, pipeline_stages, sales_opportunities, sales_activities |
| Governance | approvals, approval_policies, notifications, notification_preferences, audit_logs, data_exports |
| AI | ai_runs, ai_usage, ai_insights, reports |
| Jobs | jobs, job_runs, scheduled_jobs |

## Key state machines

- **ContentItem.status:** IDEA → DRAFT → PENDING_APPROVAL → APPROVED/SCHEDULED → PUBLISHING → PUBLISHED | FAILED, and REJECTED → DRAFT. The allowed transitions live in `CONTENT_TRANSITIONS` (`src/server/content/service.ts`).
- **Lead.stage:** NEW, CONTACTED, QUALIFIED, PROPOSAL, NEGOTIATION, WON, LOST. Every change writes a `STATUS_CHANGE` lead event.
- **Job.status:** QUEUED → RUNNING → COMPLETED, or RETRYING → … → DEAD.
- **Approval.status:** PENDING → APPROVED | REJECTED | EXPIRED.

## Metrics

`social_metrics` holds the latest normalized metrics per post. A column is null when the platform doesn't expose that metric. `raw` keeps the provider payload. Every sync also appends an immutable row to `social_metric_snapshots`, and `account_metric_snapshots` stores follower counts per day.

## Migrations workflow

```bash
# create
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<ts>_<name>/migration.sql
# review (remove DROP INDEX lines for knowledge_chunks), then
npm run db:migrate
npx prisma generate
```

`prisma migrate dev` also works in an interactive terminal, against a local database only: `npm run db:migrate:dev`, `db:reset` and `db:seed` refuse to run unless `DATABASE_URL` points at localhost and `APP_ENV` is not production or staging (`scripts/guard-dev-db.mjs`).

## Automatic migrations & destructive changes

`npm run build` and `npm run db:migrate` run `scripts/migrate-on-build.mjs`:
1. read `_prisma_migrations` and list the pending migration folders;
2. scan them for destructive SQL: `DROP TABLE/COLUMN/SCHEMA/TYPE/INDEX/VIEW`, `TRUNCATE`, `DELETE FROM`, `ALTER COLUMN … TYPE` (patterns in `scripts/migration-guard.mjs`, unit-tested);
3. if any is found, **stop the build** and list them;
4. otherwise `prisma migrate deploy` (Prisma holds an advisory lock, so two builds can't migrate at once). A failed migration fails the build.

Migrations must be **additive and backward compatible**, because the previous release keeps serving while the new one builds. Use expand → migrate data → contract:
- release N adds the new column/table and writes both;
- release N+1 reads the new one;
- release N+2 drops the old one. That is the destructive step.

**Running a destructive migration**
1. Take a backup and verify it: `scripts/backup/pg-backup.sh`, then `pg-restore-verify.sh` (docs/BACKUPS.md).
2. Review the SQL. Make sure no running release still reads what is dropped.
3. Set `ALLOW_DESTRUCTIVE_MIGRATIONS=true` for that one deploy, then remove it again.

Never edit or delete a migration that has been applied anywhere. Fix forward with a new migration. `SKIP_DB_MIGRATE=true` builds without touching the database (CI, or a separate migration step).
