# Live readiness

**Status (2026-09-30): NOT production-ready.** No Tier 1 provider has a recorded live validation yet.
- The live, always-current version of this table is `/admin/providers` → *Provider readiness*.
- `npx tsx scripts/provider-status.mts` prints the same statuses from the command line (names only, never values).

## Status definitions

Each provider gets one status. It is computed only from configuration and recorded validations (`readinessStatus()` in `src/server/admin/readiness.ts`); it is never set by hand.

| Status | Meaning |
| --- | --- |
| **READY** | A real call succeeded (recorded live validation) and no production blocker is left. |
| **READY FOR CLOSED BETA** | Live-validated; the only thing left is a deliberate test-mode setting (Stripe test keys) that stays until a separate go-live decision. |
| **READY FOR STAGING** | Configured and valid, but not live-validated yet, or still on test/dev settings (Stripe test keys, local disk, development mailbox, non-HTTPS callbacks). |
| **WAITING EXTERNAL APPROVAL** | Works as far as we can test, but depends on the provider's review or approval (Meta App Review, LinkedIn CMA, TikTok audit, Google verification, WhatsApp business verification and templates). |
| **BLOCKED** | Missing or malformed credentials, a failed credential check, or the latest recorded result is an error. A failure that only means a permission the provider hasn't granted yet (e.g. `pages_permission_pending`) counts as WAITING EXTERNAL APPROVAL instead. |

## Provider table (computed 2026-09-30, local environment)

| Tier | Provider | Status | What's missing |
| --- | --- | --- | --- |
| 1 | OpenAI | BLOCKED | `OPENAI_API_KEY`. Then: Validate, then the text, image and edit tests on `/admin/providers` |
| 1 | Anthropic (Claude) | BLOCKED | `ANTHROPIC_API_KEY`. Then: Validate (models.retrieve, no tokens), then the text test |
| 1 | Email | BLOCKED | Real provider (Resend / Postmark / SMTP) + a verified `EMAIL_FROM` domain (SPF/DKIM). Then: Send test email |
| 1 | Storage (S3/R2) | READY FOR STAGING (local disk, dev only) | Private bucket + `S3_*`. Then: Storage test (upload → signed URL → delete) |
| 1 | Stripe | BLOCKED | Test-mode keys, webhook secret, 3 price ids, HTTPS webhook endpoint. Then: checkout in test mode + a received webhook |
| 1 | WhatsApp Cloud API | BLOCKED | Meta app + WABA + number, `WHATSAPP_*`, HTTPS webhook. Business verification + approved templates (external) |
| 2 | LinkedIn | WAITING EXTERNAL APPROVAL | Re-checked 2026-09-30: client authenticated, connection valid, `w_member_social` granted. Needs an HTTPS callback, a publish test, and Community Management API for Company Pages |
| 2 | Facebook Pages | WAITING EXTERNAL APPROVAL | App credentials valid (re-checked 2026-09-30). The connected token has only `public_profile`, no Pages. Needs the Meta Page-management use case + App Review and an HTTPS callback |
| 2 | Instagram | BLOCKED | `INSTAGRAM_APP_ID/SECRET`; App Review (Advanced Access) |
| 2 | Google | BLOCKED | OAuth client; verification for gmail.send / calendar scopes |
| 2 | Microsoft | BLOCKED | App registration; publisher verification (recommended) |
| 2 | TikTok | BLOCKED | Client key/secret; Content Posting API audit (posts stay private until then) |

**What is validated without live credentials (automated, mocked HTTP only):**
- signatures, replay window and duplicate handling for Stripe and WhatsApp webhooks, at route level;
- OAuth state, PKCE, token exchange and refresh, and expired-token classification for each adapter;
- the credential checks for every provider, including their error paths;
- that secrets never appear in validation records.

None of that counts as live readiness. Automated tests never call a real provider, publish, send or charge.

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
   - `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` (at least one real AI provider);
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
