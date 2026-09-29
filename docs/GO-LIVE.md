# Go-live: Closed Beta gate

This file is the checklist to go from **NOT READY** to **READY FOR CLOSED BETA**. Nothing here is "done" because it is written down. Each item is done when its live check is recorded on `/admin/providers` (or in the table below with a date).

- `npx tsx scripts/validate-providers.mts` runs the read-only credential and connection checks and prints the statuses.
- `npx tsx scripts/provider-status.mts` prints the statuses only.

## 1. Deployment mode for the beta

**Use `APP_ENV=staging` for the closed beta on Hostinger** until storage, email and an AI key are live-validated. Then switch to `APP_ENV=production`, which refuses to start without them.

Staging is **not** a way around security. It enforces the same **security floor** as production (`SECURITY_FLOOR` in `src/server/config/validate.ts`) and refuses to start when any of these hold:
- `DATABASE_URL` is missing or on localhost;
- `APP_URL` is not public HTTPS;
- `AUTH_SECRET` is weak or a placeholder;
- `ENCRYPTION_KEY` is invalid;
- `WHATSAPP_FAKE_TRANSPORT` or `BRAIN_FETCH_FIXTURES` is on;
- a live Stripe key (`sk_live_`) is set;
- Stripe is set without a webhook secret.

Staging only *reports* functional gaps (local storage, no real email, demo AI). Demo AI output is labelled "Demo AI" in the UI.

## 2. Environment audit

"Current" = what is known about the Hostinger deployment from its build and runtime logs and settings screenshots (2026-09). Verify each row in hPanel. Values are never written here.

| Variable | Required: staging (beta) | Required: production | Current (Hostinger) | Risk |
| --- | --- | --- | --- | --- |
| `APP_ENV` | `staging` | `production` | `production` (reported) | **High**: with the current gaps, production mode refuses to start after this branch merges |
| `APP_URL` | public HTTPS | public HTTPS | Hostinger HTTPS domain | Low |
| `DATABASE_URL` | hosted, separate from prod | hosted (Supabase session pooler) | Supabase pooler | **High**: password was exposed in chat → rotate |
| `AUTH_SECRET` | 32+ random | 32+ random | set; exposed in screenshots | **High**: rotate (signs everyone out) |
| `ENCRYPTION_KEY` | 32 bytes base64 | 32 bytes base64 | set; exposed in screenshots | **High**: rotate (connected integrations must reconnect) |
| `CRON_SECRET` / `READY_TOKEN` | 24+ random | 24+ random | unknown | Medium |
| `NOVA_INLINE_WORKER` | `true` on single-process Hostinger | `false` + separate `npm run worker`, or `true` on one instance | `true` | Medium: one process. The heartbeat on `/api/ready` shows whether the worker is alive |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | at least one real key | at least one real key | none | **Blocker** for the beta |
| `AI_PRIMARY_PROVIDER` | `anthropic` or `openai` | same | default (`anthropic`) | Low |
| `AI_OFFLINE_MODE` | unset/false | unset/false | unknown | Low (ignored outside development) |
| `AI_DEMO_MODE` | allowed (labelled) until a key is added | **refused** | `true` | High in production mode, allowed in staging |
| `EMAIL_PROVIDER` + `RESEND_API_KEY` (or Postmark / SMTP) | real provider | real provider | none | **Blocker**: no verification, reset or invite emails |
| `EMAIL_FROM` | verified domain (SPF + DKIM) | verified domain | unknown | **Blocker** with the above |
| `STORAGE_DRIVER=s3` + `S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_ENDPOINT/S3_REGION` | R2 bucket (private) | R2 or S3 bucket (private) | local disk | **Blocker**: files are lost on redeploy |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | `sk_test_` / `pk_test_` only | live only after a separate decision | none | Billing stays off (honest) |
| `STRIPE_WEBHOOK_SECRET` + `STRIPE_PRICE_*` | test-mode values | live values | none | as above |
| `WHATSAPP_ACCESS_TOKEN/APP_ID/APP_SECRET/VERIFY_TOKEN/PHONE_NUMBER_ID/BUSINESS_ACCOUNT_ID/EMBEDDED_CONFIG_ID` | test/business number | verified business | none | WhatsApp stays "not set up" |
| `META_APP_ID/SECRET` | set, HTTPS callback | set | set | Pages need Meta approval |
| `LINKEDIN_CLIENT_ID/SECRET` | set, HTTPS callback | set | set | Company pages need CMA |
| `GOOGLE_*`, `MICROSOFT_*`, `TIKTOK_*`, `INSTAGRAM_*` | optional for the beta | optional | none | Features show "not set up" |
| `SENTRY_DSN` | recommended | recommended | none | Errors only in logs |
| `BRAIN_FETCH_FIXTURES`, `WHATSAPP_FAKE_TRANSPORT` | **must be unset** | **must be unset** | unset (expected) | Enforced at startup |

**Minimum Hostinger change for the beta:**
1. Set `APP_ENV=staging`.
2. Rotate the exposed secrets (section 4).
3. Add R2, Resend and one AI key.
4. Redeploy.
5. Run section 3.

## 3. Live validation runbook (all from `/admin/providers` as platform admin, on the HTTPS deployment)

| # | Provider | Live check | Counts as done when |
| --- | --- | --- | --- |
| 1 | Storage (R2) | **Storage test**: upload, signed URL read, delete, then confirm deleted, on a test prefix | all steps ✓ → READY |
| 2 | Email (Resend) | **Send test email** to your inbox. Then sign up a test user (verification), request a password reset, invite a teammate | the messages arrive and the provider message id is recorded → READY |
| 3 | OpenAI and/or Anthropic | **Validate** (no tokens), then **Test text** (structured output; tokens and cost recorded in `/admin/ai`) | recorded `generate_text` success → READY |
| 4 | AI fallback (with two keys) | covered by the automated chaos tests. Live: temporarily set a wrong key for one provider on **staging only** and run Test text; the other provider answers | the fallback shows in AI runs |
| 5 | Stripe (test mode) | **Validate**, then checkout with `4242…` from Settings → Billing, portal, upgrade, downgrade, cancel; failed payment with `4000 0000 0000 0341`; resend an event from the Stripe dashboard (duplicate) | webhook received and the plan changed only by webhook → READY FOR CLOSED BETA |
| 6 | WhatsApp | **Validate** (token and number), webhook verification (Meta dashboard), inbound message from a test phone, reply inside 24 h, template outside 24 h, STOP opt-out | the flow works on the test number. Business verification or templates pending → WAITING EXTERNAL APPROVAL |
| 7 | LinkedIn | **Validate**, then Test connection | member posting valid → stays WAITING EXTERNAL APPROVAL (CMA for company pages) |
| 8 | Facebook | **Validate**, then Test connection | without `pages_show_list` → WAITING EXTERNAL APPROVAL (Meta App Review) |
| 9 | Google / Microsoft | only if credentials exist: connect on HTTPS, send a test email, check free/busy | verification pending → WAITING EXTERNAL APPROVAL |

## 4. Secret rotation (treat as compromised)

These values appeared in chat messages or screenshots during setup. Names only:

| Secret | Where to rotate | Side effect |
| --- | --- | --- |
| Supabase database password (`DATABASE_URL`) | Supabase → Project Settings → Database → Reset password | Update `DATABASE_URL` on every host |
| `AUTH_SECRET` | `openssl rand -base64 48` | All sessions end; users sign in again |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` | Stored provider tokens can't be decrypted; each connected integration must be reconnected |
| `CRON_SECRET` (if it was set) | `openssl rand -hex 32` | Update the cron caller |
| `META_APP_SECRET`, `LINKEDIN_CLIENT_SECRET` (if they were visible in the screenshots) | Meta app dashboard / LinkedIn developer portal → reset secret | Update the env vars |

The repository secret scan (full git history) found no real secrets. The only matches are test fixtures (`AKIAIOSFODNN7EXAMPLE`, `sk_live_abcdef…`, `sk-ant-api03-abcdef…`). `.env` has never been committed.

## 5. Restore drill (Supabase)

See docs/BACKUPS.md. Restore the production dump into a **separate** Supabase project or a local Postgres, never the production project. Then:
1. `pg-restore-verify.sh`;
2. start the app against the restored DB with `APP_ENV=staging`;
3. record the durations in BACKUPS.md.

## 6. Gate

READY FOR CLOSED BETA requires **all** of the following:
- app starts cleanly on HTTPS;
- `/api/ready` = ok (database, config, storage, worker);
- storage READY;
- email READY;
- at least one AI provider READY;
- Stripe READY FOR CLOSED BETA (or billing deliberately off for the beta);
- WhatsApp works or is documented as WAITING EXTERNAL APPROVAL;
- secrets rotated;
- restore drill done;
- CI green;
- the critical staging flow passes: sign-up, onboarding, brain, AI content, approval, lead, CRM, email/WhatsApp, analytics, billing in test mode, in Arabic and English.
