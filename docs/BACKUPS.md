# Backups & recovery

What must never be lost: the PostgreSQL database (every tenant's data, encrypted provider tokens, audit log) and the private file bucket (logos, uploads, generated designs). Everything else can be rebuilt.

## PostgreSQL

### Backup command

```bash
DATABASE_URL="postgresql://…/nova" BACKUP_DIR=/var/backups/nova RETENTION_DAYS=14 ./scripts/backup/pg-backup.sh
```

- Logical dump in `pg_dump` custom format (`--no-owner --no-privileges`, compressed), plus a `.sha256` file.
- The script exits non-zero when the dump fails or is suspiciously small. Wire that exit code to an alert.
- Retention deletes only this script's own files that are older than `RETENTION_DAYS`.
- For local development against the docker database, set `PG_DOCKER=nova-postgres`.

### Schedule & retention (recommended)

| What | When | Keep |
| --- | --- | --- |
| Managed-Postgres point-in-time recovery (RDS / Cloud SQL / Neon / Supabase) | continuous | 7–14 days |
| Logical dump (`pg-backup.sh`) | daily, 03:00 UTC | 14 daily |
| Copy of the Sunday dump to a second region/account | weekly | 8 weekly + 12 monthly |

Store dumps outside the database's account/project: a separate bucket with object lock or versioning, and no delete permission for the app's credentials.

### Restore procedure

1. **Stop writes.** Scale the web and worker processes to 0, or turn on maintenance mode at the proxy.
2. **Pick the dump.** Verify it with `sha256sum -c <file>.dump.sha256`.
3. **Restore into a new database.** Never restore over the damaged one.
   ```bash
   createdb nova_restored && psql nova_restored -c "CREATE EXTENSION IF NOT EXISTS vector;"
   pg_restore --no-owner --no-privileges --exit-on-error --dbname=postgresql://…/nova_restored <file>.dump
   ```
4. **Verify the restore.** Run the checklist below.
5. **Switch over.** Point `DATABASE_URL` at `nova_restored`, or rename the databases, then run `npm run db:migrate`. It is a no-op when the dump is current.
6. **Start the worker first, then web.** Watch `/admin/incidents` for job and provider failures.
7. **Re-check the providers.** Encrypted tokens only work with the same `ENCRYPTION_KEY`. If the key was lost, every integration must reconnect, and `/admin/incidents` lists them.

> **`ENCRYPTION_KEY` and `AUTH_SECRET` are part of the backup.** Keep them in the secret manager with their own versioning. A database restored without its `ENCRYPTION_KEY` restores provider tokens that can't be decrypted.

### Verification (automated)

```bash
DATABASE_URL="postgresql://…/nova" ./scripts/backup/pg-restore-verify.sh /var/backups/nova/nova-nova-<stamp>.dump
```

This script:
- checks the checksum;
- restores into `<db>_restore_check`;
- compares row counts of the key tables with the source;
- confirms there are no unfinished migrations;
- then drops the scratch database.

Run it weekly. A backup that has never been restored is not a backup.

**Last run in this repository:** 2026-09-30, against the local development database only (not production).
- Dump size: 2.5 MB. Restore time: 12 s.
- All 13 checked tables matched (organizations 415, users 448, leads 339, content_items 580, audit_logs 2668, _prisma_migrations 18, …).
- **A production restore drill is still pending.** It needs a Supabase connection string that the operator runs from their own machine; see "Supabase" below.

### Supabase (current production database)

- **Point-in-time recovery.** Free projects have no PITR and only limited daily backups. Pro gives daily backups kept 7 days; PITR is a paid add-on. For a paying-customer launch, enable PITR or run `pg-backup.sh` daily from a machine or CI runner outside Hostinger.
- **Use the session pooler or the direct connection for dumps** (port 5432), never the transaction pooler (6543). `pg_dump` needs session-level features.
- **The `vector` extension** already exists on Supabase. `pg_restore` into a fresh Supabase project works after `CREATE EXTENSION IF NOT EXISTS vector;`.
- **Supabase-managed schemas** (`auth`, `storage`, `realtime`) are not used by NOVA. Dump only `public`: `pg_dump --schema=public`. `pg-backup.sh` dumps the database named in the URL, so on Supabase set `PG_DUMP_EXTRA="--schema=public"`.
- **Drill:** once a month, restore the latest dump into a *separate* Supabase project or a local docker Postgres with `pg-restore-verify.sh`. Never restore into the production project.

### Encryption & access

- Dumps contain every tenant's data. Encrypted provider tokens stay encrypted in the dump, but everything else is plaintext.
- Store dumps only in a bucket with server-side encryption (SSE-S3 / R2 default encryption) and versioning or object lock.
- Only the backup identity can read that bucket. The app's own storage key must not be able to list it or delete from it.
- `.backups/` and `*.dump` are git-ignored. Never commit a dump.

### Disaster-recovery targets (proposed)

| | Target | How |
| --- | --- | --- |
| RPO (data you can lose) | ≤ 24 h without PITR, ≤ 5 min with PITR | daily `pg-backup.sh` / Supabase PITR |
| RTO (time to recover) | ≤ 2 h | restore procedure above, rehearsed monthly |

### Verification checklist (manual, after a real restore)

- [ ] `SELECT count(*)` on organizations, users, leads, content_items is in line with expectations.
- [ ] `_prisma_migrations` has no rows with `finished_at IS NULL`, and `npx prisma migrate status` reports up to date.
- [ ] You can sign in, and an existing session or magic link behaves as expected (sessions may be invalidated).
- [ ] `/admin/providers` → **Validate** passes for each configured provider. **Test connection** works on one real integration, which proves `ENCRYPTION_KEY` matches.
- [ ] One file from the bucket opens through `/api/files/:id`, which proves DB file records match bucket objects.
- [ ] Jobs are running: `/admin/jobs` shows new completed jobs, and there are no DEAD jobs.
- [ ] The Stripe webhook is being received. Its events are idempotent, so Stripe's retries after the outage are safe.

## Asset bucket (S3 / R2)

- **Turn on versioning.** Deleted or overwritten objects can then be restored.
  - AWS: `aws s3api put-bucket-versioning --bucket <b> --versioning-configuration Status=Enabled`
  - Cloudflare R2 has no object versioning. Use a scheduled `rclone sync --backup-dir` copy to a second bucket instead.
- **Add a lifecycle rule** that expires non-current versions after 30 days and aborts incomplete multipart uploads after 7 days.
- **Restrict the app's key.** It gets `PutObject`, `GetObject` and `DeleteObject` only. Backups and lifecycle rules are managed with a different identity.
- **Object keys are `<organizationId>/<yyyy-mm>/<uuid>.<ext>`.** A tenant's files can therefore be restored or exported by prefix.
- Files deleted in the app are soft-deleted in `file_objects` (`deletedAt`), and the object is removed. With versioning on, it can be recovered until the non-current version expires.
- **The admin storage test writes to `_nova-admin-test/` and deletes what it wrote.** Automated tests never touch a real bucket; they use an in-memory driver.

## Recovery objectives (targets, not yet measured in production)

| | Target |
| --- | --- |
| RPO (data loss) | ≤ 5 min with managed PITR; ≤ 24 h with daily dumps only |
| RTO (time to restore) | ≤ 1 h for the database; files are served straight from the bucket |
