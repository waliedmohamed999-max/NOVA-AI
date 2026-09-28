# Live readiness

**Status (2026-09-28): NOT production-ready.** Every production blocker below must be closed first. The live, always-current version of this table is on `/admin/providers` → *Provider readiness*. In that view, "Live tested = YES" only appears after a recorded, successful call to the real provider.

## Provider table

| Provider | Configured | Live validated | HTTPS validated | External review | Production blocker |
| --- | --- | --- | --- | --- | --- |
| OpenAI | NO | NO | N/A | NO | **YES**: no `OPENAI_API_KEY` |
| Email | Dev only (Mailpit) | NO (dev mailbox isn't counted) | N/A | NO | **YES**: no real provider (Resend / Postmark / SMTP) |
| Google (Gmail + Calendar) | NO | NO | NO | YES: OAuth verification for sensitive scopes | **YES** |
| Microsoft (Outlook + Calendar) | NO | NO | NO | Recommended: publisher verification | **YES** |
| Calendar (via Google/Microsoft) | NO | NO | NO | via Google/Microsoft | **YES** |
| WhatsApp Cloud API | NO | NO | NO | YES: business verification, templates | **YES** |
| Stripe | NO | NO | NO | NO | **YES**: no test keys; live mode later |
| Storage (S3/R2) | Local disk only | NO | N/A | NO | **YES**: no bucket configured |
| LinkedIn (member posting) | YES | Credentials + connection: YES. Publish test: pending your approval | NO (localhost) | Company Pages: Community Management API | **YES**: HTTPS callback, publish test |
| Instagram Direct | NO | NO | NO | YES: App Review (Advanced Access) | **YES** |
| Facebook Pages | YES (app) | App credentials + identity: YES. Pages: NO | NO (localhost) | YES: Page-management use case + App Review | **YES**: PENDING META PERMISSION |
| TikTok | NO | NO | NO | YES: Content Posting audit | **YES** |

## Manual live tests performed (this environment)

All of these were read-only. Nothing was published, sent, charged or created.

| When (UTC) | Test | Result |
| --- | --- | --- |
| 2026-09-28 | LinkedIn app credentials (client authentication) | PASS: client authenticated (2-legged flow not enabled for this app, which is expected) |
| 2026-09-28 | Meta app credentials (app access token) | PASS: token issued for "NOVA — AI Growth Platform" |
| 2026-09-28 | LinkedIn connection (introspection + profile) | PASS: valid; `w_member_social` granted, so member publishing is available |
| 2026-09-28 | Facebook connection | Identity only (`public_profile`). `pages_show_list` not granted, so no Pages. PENDING META PERMISSION |
| 2026-09-28 | Email connection | Reachable, but it's Mailpit (development mailbox). Recorded as **not live** |
| 2026-09-28 | OpenAI, Google, Microsoft, WhatsApp, Stripe, Instagram, TikTok | Not configured. Recorded as pending |

**Not run:** the LinkedIn publish test. It posts publicly, so it needs your explicit approval (type `PUBLISH` in `/admin/providers` → Connection tests).

## How each live test works (admin only, never in automated tests)

| Area | Button | What it does | Confirmation |
| --- | --- | --- | --- |
| Any provider | Validate | Proves credentials against the real API: token issued / client accepted / key valid. Publishes nothing and costs nothing | none |
| OpenAI | Test text / Test image / Test image edit | Text: structured answer with usage and cost. Image and edit: stored, read back, **deleted**, preview shown inline | none (costs a few cents) |
| Email | Send test email | One email to the address you type. Uses the connected Gmail/Outlook first, then the platform provider. Records provider, message id, "accepted" | you type the address |
| WhatsApp | Test connection | Token, phone status, templates, webhook subscription. Sends nothing | none |
| WhatsApp | Send test WhatsApp | One message to `WHATSAPP_TEST_RECIPIENT` only. Uses an approved template outside the 24h window | `SEND TEST WHATSAPP` |
| Calendar | Test availability | Reads free/busy for the next 24h and forces a token refresh | none |
| Calendar | Create test meeting | 15-minute "NOVA Integration Test" with no attendees, then **cancelled immediately** | `CREATE TEST MEETING` |
| Storage | Upload / sign / delete | Upload, signed GET, compare, delete, confirm it's gone | none |
| LinkedIn / Facebook | Publish test post | "NOVA integration test — this post can be deleted." Saved as a SocialPost (visible in /social) | `PUBLISH` |
| Stripe | Validate | Key and mode, prices (active, recurring, same mode), webhook endpoint registered for `APP_URL/api/webhooks/stripe` | none |
| Stripe | Settings → Billing | Checkout (test card), portal, upgrade/downgrade, cancel. **Plans change only from the webhook** | Stripe test card |

## Exact next actions

1. **Staging host.** Deploy to a staging URL with HTTPS (not production), with `APP_ENV=staging` and `APP_URL=https://<staging-domain>`. Fill `.env.staging.example`. At startup the callback audit logs anything that isn't public HTTPS.
2. **Register every URL** from `/admin/providers` → *Callback & URL matrix* (also in `docs/STAGING.md`).
3. **Add keys** (staging, test mode):
   - `OPENAI_API_KEY` and models;
   - `RESEND_API_KEY` (or Postmark/SMTP) with a verified sending domain;
   - `GOOGLE_CLIENT_ID/SECRET` and `MICROSOFT_CLIENT_ID/SECRET`;
   - WhatsApp: token, app secret, verify token, phone number id, WABA id, test recipient;
   - Stripe: `sk_test_…`, `pk_test_…`, `whsec_…`, price ids;
   - S3 or R2 bucket and keys;
   - Instagram and TikTok app credentials.
4. **Run the manual tests** above in `/admin/providers`, then the Stripe test-mode flow from Settings → Billing.
5. **Meta:** add the Page-management use case (`pages_show_list`, `pages_manage_posts`, `pages_read_engagement`) and submit App Review.
6. **LinkedIn:** approve the publish test (type `PUBLISH`). For Company Pages, apply for the Community Management API.
7. **Google:** submit OAuth verification for `gmail.send` and the calendar scopes.
8. **Backup restore drill** on staging (`docs/BACKUPS.md`).
