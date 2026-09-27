# Integrations

All social integrations use official APIs through the `SocialProvider` interface (`src/server/integrations/types.ts`): `connect`, `exchangeCode`, `listAccounts`, `refreshToken`, `disconnect`, `publishPost`, `schedulePost`, `getPost`, `getPosts`, `getMetrics`, `getAccountMetrics`. There is no scraping and no password automation.

## Customer experience

Customers never see app IDs, secrets, environment variable names or "admin setup" messages. They see channels, states and human-readable errors.

- **Onboarding** (`/onboarding`): company → products/services → brand → **connect accounts** (`/onboarding/connect`) → goals → NOVA analysis → ready. The connect step can be skipped ("You can connect more accounts later").
- **After onboarding:** Settings → **Connected accounts** (`/settings/connected-accounts`). The old `/integrations` URL redirects there, and there is no Integrations item in the sidebar.
- **Cards:**
  - Instagram, Facebook, LinkedIn and TikTok;
  - Email: coming soon, via Google/Microsoft sign-in only, never an email password;
  - Website: URL plus "Analyze my website", with live status steps from the existing knowledge-ingestion job;
  - later: WhatsApp, YouTube, X.
- **Card states:**
  - *Not connected* → **Connect**
  - *Connecting…* while the browser goes to the platform
  - *✓ Connected* with the account handle → **Change account** / **Disconnect**
  - *Needs reconnecting* (with the health reason) → **Reconnect** / **Disconnect**
  - *Choose an account*
  - *Not available yet*, when the platform app isn't configured on the server
- **Meta:** one sign-in connects Instagram and Facebook.
  - When a platform returns several accounts, **none is selected automatically**. The page opens "Which account should NOVA manage?" with checkboxes.
  - On reconnect, the previous choice is kept.
  - A single account is used directly.
- **Success:** "✓ Instagram connected — NOVA is ready to manage @handle", as a short animated confirmation.
- **Plan limits:** channels over the plan's `socialChannels` limit are not added. The page says which platform was skipped and why.
- **Demo workspace:** a "Demo account" notice explains that the data is sample data and no real account is connected. No fake OAuth success is ever shown.

## OAuth flow (`src/server/integrations/service.ts`)

1. `GET /api/integrations/{meta|linkedin|tiktok}/connect?from=onboarding|settings`
   - Requires a session plus `integrations:manage`, and the plan's channel limit is checked.
   - Stores a hashed one-time `state` with a 10-minute expiry, an encrypted PKCE verifier and the return page, then redirects to the provider.
   - `from` maps to one of two fixed pages (`/onboarding/connect`, `/settings/connected-accounts`). Any other value falls back to settings, so there is no open redirect.
2. The provider redirects to `GET /api/integrations/{id}/callback`.
   - The state is verified (exists, unexpired, same provider) and consumed once.
   - The stored return page is re-checked against the allow-list.
   - The code is exchanged on the server. Denied consent returns `oauth_denied`; a failed exchange returns `integration_error` (details go to the server log only); no business accounts returns `no_accounts`.
3. Storage:
   - Tokens are encrypted (AES-256-GCM, `ENCRYPTION_KEY`) into `integration_credentials`.
   - Accounts are upserted: active if there is exactly one, or if it was previously chosen; otherwise the account waits for the customer's choice.
   - The event is written to the audit log.
   - A first sync is queued only for platforms whose account is chosen.
   - The browser is sent back with `?connected=…&choose=…&limited=…` or `?error=<code>`, never a code, state or token.
4. `selectAccounts()` activates only the chosen accounts. It is scoped to the caller's workspace, and IDs from another integration or tenant are rejected.
5. Tokens are never sent to the browser. Only `tokenForAccount()` decrypts them, inside server jobs.

**Other lifecycle behaviour:**
- **Token refresh:** runs hourly (`integrations.refresh_tokens`) for credentials expiring within 7 days.
- **Provider failures:** normalized into `ProviderError` kinds (expired / permission / rate_limited / invalid_media / unavailable / unknown). The integration is marked `EXPIRED` / `ACTION_REQUIRED` / `ERROR`, admins are notified with a link to Connected accounts, and the card shows **Reconnect**.
- **Disconnect:** revokes at the provider (best effort), deletes the credentials, deactivates the accounts and frees the channel.

## Provider configuration (platform admins only)

`/admin/providers` reads the environment and shows **Configured / Missing / Error** (Error = half-configured) for Meta, LinkedIn, TikTok, OpenAI, Anthropic, Email, Storage and Payments.
- IDs are masked (`1234••••89`) and secrets are shown only as `••••`.
- Nothing is editable, and secrets are never copied into the database. Change them in the deployment environment.

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
| File storage (S3/R2) | SigV4 driver: put/get/delete/presign, org-scoped keys | ✓ MinIO | ✓ AWS SigV4 reference vectors + mocked fetch | ✗ pending (AWS S3 / R2 account) |
| Payments (Stripe) | `PaymentProvider` interface, `setPaymentProvider()`, `confirmPlanChange()`, idempotency-ready `billing_events`, `invoices` table | — | — | ✗ **Stripe adapter + webhook are NOT implemented** |

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
