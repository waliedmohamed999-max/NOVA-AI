# Deployment

> This guide describes how the pieces are meant to run. It does not certify a production launch: live provider validation on HTTPS staging, live Stripe, real storage/email and a production backup-restore drill are still pending (see "Blockers" below and docs/STAGING.md).

## Components

| Component | Notes |
| --- | --- |
| Web | `npm run build && npm run start` (Node ≥ 22). Stateless apart from the per-process AI circuit breaker; scale horizontally. |
| Worker | `npm run worker`. Run at least one instance. More is safe: jobs use `SKIP LOCKED` and schedules are claimed atomically. |
| PostgreSQL | 15+ with `vector`. Run `npm run db:migrate` on release. Rate limits, budgets, jobs and sessions all live here and are shared by every instance. |
| SMTP | Any provider (SES, Postmark, Resend SMTP…). |
| File storage | `STORAGE_DRIVER=local` (single server with a persistent volume) or `STORAGE_DRIVER=s3` (AWS S3, Cloudflare R2, MinIO…). Use S3/R2 when you run more than one web instance. |

Set `NOVA_INLINE_WORKER=false` in production and run the worker separately. On platforms without long-running processes, call `POST /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`. Each call drains jobs for up to about 50 seconds.

## Deployment assumptions

- **HTTPS at a public `APP_URL`.** OAuth redirect URIs, email links and `upgrade-insecure-requests` in the CSP are all derived from it.
- **A reverse proxy or load balancer you control.** It sits in front of the app and appends `X-Forwarded-For`, so set `TRUST_PROXY` to match it (see below).
- **One PostgreSQL database** reachable by both web and worker.
- **A private object-storage bucket** when you run more than one instance.
- **Secrets are supplied only through environment variables.** Nothing in the admin UI writes secrets to the database. `/admin/providers` only displays masked status.

## File storage (S3 / R2)

```
STORAGE_DRIVER="s3"
S3_BUCKET="nova-files"
S3_ACCESS_KEY_ID="…"
S3_SECRET_ACCESS_KEY="…"
# Cloudflare R2:
S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"   # region defaults to "auto"
# AWS S3: leave S3_ENDPOINT empty and set S3_REGION (e.g. "eu-central-1")
# MinIO: S3_ENDPOINT="http://minio:9000"  (path-style is used automatically with an endpoint)
S3_SIGNED_REDIRECT="false"
```

- The driver (`src/server/storage/s3.ts`) signs requests with AWS Signature V4 over `fetch`, so it needs no SDK. It is checked against AWS's published SigV4 test vectors and against a live MinIO: put, get, presigned GET, tampered-signature rejection and delete.
- **Keep the bucket private.** Files are served through `/api/files/:id` with an HMAC-signed URL that expires. With `S3_SIGNED_REDIRECT=true` that route instead redirects to a 5-minute presigned S3 URL, and the bucket origin is added to the CSP `img-src`.
- Object keys are `<organizationId>/<yyyy-mm>/<uuid>.<ext>`. Reads and deletes re-check the organization prefix.
- Uploads are validated before storage: 10 MB maximum, and the type is detected from magic bytes.
- Required IAM or R2 token permissions: `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on `arn:aws:s3:::<bucket>/*`.
- Moving from local to S3 does not migrate existing files. Copy `.storage/<org>/…` to the bucket with the same keys.

## Client IPs behind a proxy (`TRUST_PROXY`)

`X-Forwarded-For` is written by clients as well as proxies, so the app ignores it by default.

| Setup | Setting |
| --- | --- |
| App directly on the internet, or unknown | `TRUST_PROXY=false` (default). The client IP is unknown, so rate limits fall back to a shared bucket. |
| One proxy or load balancer (nginx, ALB, Render, Fly…) | `TRUST_PROXY=true`. The app uses the right-most `X-Forwarded-For` entry, which is the one your proxy appended. |
| CDN → load balancer → app | `TRUST_PROXY=2` |
| Cloudflare | `TRUST_PROXY=true` and `TRUST_PROXY_HEADER=cf-connecting-ip` |
| nginx with `real_ip`, or Vercel | `TRUST_PROXY=true` and `TRUST_PROXY_HEADER=x-real-ip` |

Only set these when the proxy strips or overwrites any client-supplied value of the chosen header. The IP is used for:
- sign-in, sign-up and reset rate limits;
- per-IP lead-capture limits;
- session device lists;
- the audit log.

## Content-Security-Policy

`src/proxy.ts` sets a per-request nonce CSP on every HTML response. It needs no configuration.
- Pages must be dynamically rendered, and they are: the root layout reads cookies.
- If you add a third-party script, load it with `next/script` and pass the `x-nonce` request header as `nonce`. `strict-dynamic` then lets its children load.
- Adding a CDN for images or fonts may require editing `buildCsp()` (`src/server/security/csp.ts`). `img-src` already allows any `https:` source.
- Verified with `next build && next start`: no violations on the landing page, sign-in, app pages, the command bar or the lead-form embed.

## Required environment

See `.env.example`. At minimum:
- `DATABASE_URL`
- `APP_URL` (the public HTTPS URL)
- `AUTH_SECRET`
- `ENCRYPTION_KEY`
- SMTP settings
- one AI key
- `TRUST_PROXY` (when behind a proxy)
- `STORAGE_DRIVER=s3` plus the bucket settings (when running more than one instance)

`AI_OFFLINE_MODE` must be `false`: the app refuses to make AI calls with it switched on in production.

## Blockers

- **Payments (Stripe): implemented, not live-validated.**
  - Built: `StripePaymentProvider` (checkout, in-place upgrade/downgrade, cancel at period end, portal) and `/api/webhooks/stripe` (signature, exactly-once via `billing_events`, state re-read from Stripe, invoices).
  - Tested only with the Stripe API mocked.
  - Payments stay off (`billing_not_configured`) until `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the price ids are set.
  - Needs a Stripe test-mode run on HTTPS staging (docs/STAGING.md step 7), then live keys.
- **Real-provider validation:** see the readiness matrix on `/admin/providers` — every YES there comes from a recorded live call.
  - Live so far: LinkedIn connection (member posting permission granted), Meta app credentials + identity login.
  - Pending: OpenAI (no key), Instagram Direct (no app credentials), Facebook Pages (Meta must enable Page management), TikTok, Google, Microsoft, WhatsApp, real email provider, S3/R2.
  - Meta, TikTok and Google sensitive scopes also require app review / verification.
- **Backups:** scripts and a verified local restore exist (docs/BACKUPS.md); a production restore drill has not been run.

## Release checklist

1. `npm ci` (runs `prisma generate`)
2. `npm run typecheck && npm run lint && npm test && npm run test:e2e`
3. `npm run build`
4. `npm run db:migrate`
5. Deploy web and worker
6. Register every URL in the callback matrix (`/admin/providers` → Callback & URL matrix, or docs/STAGING.md)
7. Verify:
   - the sign-up email arrives;
   - `/admin/providers` shows the expected Configured / Missing states;
   - a job completes in `/admin/jobs`;
   - an upload round-trips (Settings → Brand logo);
   - the response headers include `content-security-policy` with a nonce.

## Operations

- **Health:** the `/admin` overview (dead jobs, AI errors, integration issues), plus `/admin/incidents` and `/admin/providers`.
- **Logs:** structured JSON (pino), with the `service` field set to `web` or `worker`. Password, token, secret, cookie, authorization and code fields are redacted.
- **Key rotation:**
  1. Add `ENCRYPTION_KEY_V2`.
  2. Bump `CURRENT_KEY_VERSION` in `src/server/crypto.ts`.
  3. Re-save credentials, either by reconnecting or with a re-encryption script.
- **Backups:** use standard PostgreSQL backups. Stored files live outside the database, so also back up the storage volume or bucket (enable bucket versioning).
