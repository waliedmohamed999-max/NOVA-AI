# Deployment

## Components

| Component | Notes |
| --- | --- |
| Web | `npm run build && npm run start` (Node ≥ 22). Stateless; scale horizontally. |
| Worker | `npm run worker` — at least one instance (more is safe: jobs use `SKIP LOCKED`, schedules are claimed atomically). |
| PostgreSQL | 15+ with `vector`. Run `npm run db:migrate` on release. |
| SMTP | Any provider (SES, Postmark, Resend SMTP…). |
| File storage | `STORAGE_DRIVER=local` writes to `STORAGE_LOCAL_DIR`; mount a persistent volume or implement the `StorageDriver` interface (`src/server/storage`) for S3-compatible storage. |

Set `NOVA_INLINE_WORKER=false` in production and run the worker separately. On platforms without long-running processes, call `POST /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`; each call drains jobs for up to ~50 seconds.

## Required environment

See `.env.example`. At minimum: `DATABASE_URL`, `APP_URL` (public HTTPS URL), `AUTH_SECRET`, `ENCRYPTION_KEY`, SMTP settings, and one AI key. `AI_OFFLINE_MODE` must be `false` — the app refuses to start AI calls with it in production.

## Release checklist

1. `npm ci` (runs `prisma generate`)
2. `npm run typecheck && npm run lint && npm test`
3. `npm run build`
4. `npm run db:migrate`
5. Deploy web + worker
6. Register OAuth redirect URIs for each provider against the public `APP_URL`
7. Verify: sign-up email arrives, `/integrations` shows correct configured states, a job completes in `/admin/jobs`

## Operations

- **Health:** `/admin` overview (dead jobs, AI errors, integration issues), `/admin/incidents`.
- **Logs:** structured JSON (pino) with the `service` field set to `web` or `worker`.
- **Key rotation:** add `ENCRYPTION_KEY_V2`, bump `CURRENT_KEY_VERSION` in `src/server/crypto.ts`, and re-save credentials (reconnect) or run a re-encryption script.
- **Backups:** standard PostgreSQL backups. Stored files live outside the DB, so back up the storage volume or bucket too.
