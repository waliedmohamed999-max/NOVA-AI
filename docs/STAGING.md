# Staging

Staging is where the live provider validations happen: OAuth on HTTPS, real email, real storage and Stripe test mode. It uses its own database, bucket, secrets and provider apps (or dedicated redirect URIs). It must never share them with production.

## Assumptions

- **Public HTTPS origin.** For example `https://staging.example.com`, with a valid certificate. `APP_URL` is exactly that origin. Every OAuth redirect, email link and webhook is derived from it.
- **No localhost.** Meta, LinkedIn, TikTok, Google and Microsoft reject or mis-handle `http://` and `localhost` callbacks outside their development modes. `/admin/providers` → *Callback & URL matrix* flags any URL that is not public HTTPS.
- **Reverse proxy in front.** Set `TRUST_PROXY` to match it (see DEPLOYMENT.md).
- **Separate processes.** Run web (`npm run start`) and worker (`npm run worker`), with `NOVA_INLINE_WORKER=false`.
- **Postgres 15+ with `vector`.** Run `npm run db:migrate` on every deploy.
- **Staging-only integrations.** Stripe runs in test mode (`sk_test_…`). Use a staging email sender domain and a staging bucket.

Start from `.env.staging.example`.

## Callback & URL matrix

Register each URL exactly as shown: same scheme, host and path, no trailing slash and no query string. The live version, computed from the running config, is on `/admin/providers`.

| Type | Name | URL (staging) | Where to register |
| --- | --- | --- | --- |
| OAuth | Meta (Facebook Pages) | `https://staging.example.com/api/integrations/meta/callback` | Meta App → Facebook Login for Business → Valid OAuth Redirect URIs |
| OAuth | Instagram Direct | `https://staging.example.com/api/integrations/instagram/callback` | Meta App → Instagram API with Instagram Login → Business login settings |
| OAuth | LinkedIn | `https://staging.example.com/api/integrations/linkedin/callback` | LinkedIn app → Auth → Authorized redirect URLs |
| OAuth | TikTok | `https://staging.example.com/api/integrations/tiktok/callback` | TikTok for Developers → Login Kit → Redirect URI |
| OAuth | Google (Gmail + Calendar) | `https://staging.example.com/api/integrations/google/callback` | Google Cloud → OAuth client → Authorized redirect URIs |
| OAuth | Microsoft (Outlook + Calendar) | `https://staging.example.com/api/integrations/microsoft/callback` | Entra ID → App registration → Authentication → Web |
| Auth | Sign in with Google | `https://staging.example.com/api/auth/google/callback` | Same Google OAuth client |
| Auth | Magic link | `https://staging.example.com/magic` | Nothing to register (emails use `APP_URL`) |
| Webhook | WhatsApp Cloud API | `https://staging.example.com/api/webhooks/whatsapp` | Meta App → WhatsApp → Configuration (+ `WHATSAPP_VERIFY_TOKEN`), subscribe to `messages` |
| Webhook | Stripe | `https://staging.example.com/api/webhooks/stripe` | Stripe (test mode) → Webhooks. Events: see `.env.example` |
| Legal | Privacy / Terms / Data deletion | `/privacy`, `/terms`, `/data-deletion` | Meta / LinkedIn / TikTok / Google app settings (required for app review) |

Also add the staging domain to:
- Meta **App Domains**;
- Google **Authorized JavaScript origins**;
- your email provider's **verified sending domain** (SPF, DKIM, DMARC).

## Staging validation checklist

Run these in order and record each result. `/admin/providers` records every validation it runs.

1. [ ] `/admin/providers`: the callback matrix shows no warnings.
2. [ ] **Validate** each configured provider. Credentials show `Valid`.
3. [ ] Storage: **Upload / sign / delete** succeeds against the staging bucket.
4. [ ] Email: `/admin/providers` → email **Validate**. Then trigger a magic link and a password reset to a real inbox, and check they are not landing in spam.
5. [ ] OAuth on HTTPS, one live connection each:
   - LinkedIn: **Test connection**, then **Publish test post**. The post appears in `/social` with its external id.
   - Meta: identity, then **Grant access to Pages** once Meta has enabled Page management.
   - Instagram Direct: Business/Creator account, then insights/comments/messages tests (whichever permissions are granted).
   - TikTok, Google and Microsoft: connect, then **Test connection**. For Google/Microsoft, grant *Send email* and *Calendar* and propose/book one meeting on a test calendar.
6. [ ] OpenAI: **Test text**, **Test image** and **Test image edit**, with cost recorded.
7. [ ] Stripe test mode:
   - checkout with card `4242 4242 4242 4242`: the webhook arrives and the plan changes;
   - upgrade, downgrade, portal and cancel;
   - a failed payment with card `4000 0000 0000 0341`: status becomes `PAST_DUE`;
   - replaying an event from the Stripe dashboard is acknowledged as a duplicate.
8. [ ] WhatsApp: the webhook verify handshake passes. Link the number in `/admin/providers`, send an inbound test message (a lead is created), and reply inside 24 h (delivery status is updated).
9. [ ] Backups: run `pg-backup.sh` and `pg-restore-verify.sh` against staging. Record the timings in BACKUPS.md.
10. [ ] `/admin/incidents` has no unexpected failures after the run. Sentry receives a test error if `SENTRY_DSN` is set.

Only when every row is checked and the blockers in the final report are closed should anyone discuss a production launch.
