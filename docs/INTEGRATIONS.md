# Integrations

All social integrations use official APIs through the `SocialProvider` interface (`src/server/integrations/types.ts`): `connect`, `exchangeCode`, `listAccounts`, `refreshToken`, `disconnect`, `publishPost`, `schedulePost`, `getPost`, `getPosts`, `getMetrics`, `getAccountMetrics`. There is no scraping and no password automation.

## OAuth flow (`src/server/integrations/service.ts`)

1. `GET /api/integrations/{meta|linkedin|tiktok}/connect` (session plus `integrations:manage`, and the plan's channel limit is checked). It stores a hashed one-time `state` with a 10-minute expiry and an encrypted PKCE verifier, then redirects to the provider.
2. The provider redirects to `GET /api/integrations/{id}/callback`. The state is verified and consumed once, then the code is exchanged on the server.
3. Tokens are encrypted (AES-256-GCM, `ENCRYPTION_KEY`) into `integration_credentials`. Accounts are upserted and the event is written to the audit log, then a first sync is queued.
4. Tokens are never sent to the browser. Only `tokenForAccount()` decrypts them, inside server jobs.

Token refresh runs hourly (`integrations.refresh_tokens`) for credentials expiring within 7 days. Provider failures are normalized into `ProviderError` kinds (expired / permission / rate_limited / invalid_media / unavailable / unknown). The integration is then marked `EXPIRED` / `ACTION_REQUIRED` / `ERROR`, admins are notified, and the UI offers **Reconnect**.

## Status matrix

| Integration | Implemented | Locally tested | Integration-tested (mocked) | Real-provider tested |
| --- | --- | --- | --- | --- |
| Meta: Facebook Pages | OAuth, long-lived tokens, pages, publish (feed/photo), native schedule (text), posts, insights | ✓ UI/flow | ✓ adapter tests with mocked HTTP | ✗ pending (needs Meta app + review) |
| Meta: Instagram professional | via Page; publish image/carousel/reels/stories, insights, followers | ✓ | ✓ | ✗ pending |
| LinkedIn | OIDC, member posting, image upload, org pages + share stats when `LINKEDIN_ORGANIZATION_ACCESS=true` | ✓ | ✓ | ✗ pending |
| TikTok | Login Kit v2 + PKCE, refresh, Content Posting (PULL_FROM_URL), video list/query | ✓ | ✓ | ✗ pending |
| X / YouTube / Pinterest | listed as "coming soon" | — | — | — |
| OpenAI | text, structured, stream, embeddings, images | offline provider used locally | provider logic unit-tested | ✗ pending (no key in this environment) |
| Anthropic | text, structured, stream, refusal fallbacks | offline provider used locally | router tested | ✗ pending (no key in this environment) |
| Email (SMTP) | verification, magic link, reset, invitations, notifications, sales replies | ✓ via Mailpit | — | n/a |
| Website lead capture | embed + public API | ✓ manual + automated | ✓ | n/a |
| WhatsApp / social DMs | `MessageChannel` adapters report "not configured" | — | — | ✗ |
| Payments | provider boundary only (`src/server/billing/provider.ts`) | — | — | ✗ adapter not bundled |

### Provider setup

**Meta**
- Create an app (Business type).
- Add Facebook Login for Business and the Instagram Graph API.
- Redirect URI: `{APP_URL}/api/integrations/meta/callback`.
- Permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `business_management`. These need App Review for production.
- Instagram media must be reachable at a public URL, so `APP_URL` must be public.

**LinkedIn**
- Add the products "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn".
- Redirect URI: `{APP_URL}/api/integrations/linkedin/callback`.
- Company pages and statistics require Community Management API approval; then set `LINKEDIN_ORGANIZATION_ACCESS=true`.

**TikTok**
- Enable Login Kit and the Content Posting API.
- Redirect URI: `{APP_URL}/api/integrations/tiktok/callback`.
- Verify your media domain for `PULL_FROM_URL`.
- Unaudited apps can only post privately.

## Publishing

- Approved posts with a future time get a `social_publications` row.
- `social.publish_due` runs every minute. It claims each row, picks an active account for the channel, calls `publishPost`, and records the `social_post`.
- Transient errors are retried up to 3 times. Anything else ends in `FAILED`, with a human-readable notification and a retry button.
- With no connected account, the result is `FAILED (cannot_publish)`. It is never reported as a success.

## Analytics sync

- `social.sync_all` runs every 6 hours and fans out to `social.sync_integration`.
- Each sync imports the last 60 days of posts, normalized metrics plus snapshots, and account followers.
- Posts that receive their first metrics within 7 days of publishing queue `analytics.analyze_post` for the Performance Analyst.

## Website lead capture

- **Embed:** `<iframe src="{APP_URL}/embed/lead/{publicKey}">`. The form's fields come from the database, and it follows the company's language.
- **API:** `POST {APP_URL}/api/public/leads/{publicKey}` with a JSON or form body. Protections:
  - unknown or inactive form → 404;
  - Origin allow-list (the embed is always allowed), with CORS headers only for allowed origins;
  - rate limits of 5 per 10 minutes per IP and 300 per hour per form;
  - honeypot field `company_website` plus a minimum fill time;
  - zod validation built from the configured fields;
  - 32 KB body cap.
- **Result:**
  - a real lead is created (channel WEBSITE, source/UTM attribution, campaign match on `utm_campaign`);
  - timeline events are written (CREATED, FORM_SUBMITTED, MESSAGE_RECEIVED);
  - a rules score is computed;
  - when AI is configured, a `lead_qualify` run produces the summary, intent, score and next action, a drafted reply (disposition via autonomy/policies) and a follow-up.

## Billing

Implemented:
- plans and entitlements (`src/config/plans.ts`, `src/server/billing/entitlements.ts`);
- subscription state per organization, the AI allowance and live usage;
- server-side enforcement of seats (invitations), social channels (connect) and agents (enable);
- downgrade validation (`canMoveTo`);
- `billing_events` for idempotent webhooks and `invoices` for invoice records.

Not bundled: a payment-processor adapter. `PaymentProvider` (`src/server/billing/provider.ts`) is the boundary. Until an adapter is plugged in with `setPaymentProvider()`, plan changes return `billing_not_configured` and nothing is charged or simulated. A future adapter should:
- create checkout sessions;
- verify webhook signatures;
- store each event once in `billing_events` (unique `provider + externalId`);
- call `confirmPlanChange()` and upsert `invoices`.
