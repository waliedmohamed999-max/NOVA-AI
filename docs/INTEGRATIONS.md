# Integrations

All social integrations use official APIs through the `SocialProvider` interface (`src/server/integrations/types.ts`): `connect`, `exchangeCode`, `listAccounts`, `refreshToken`, `disconnect`, `publishPost`, `schedulePost`, `getPost`, `getPosts`, `getMetrics`, `getAccountMetrics`. There is no scraping and no password automation.

## Customer experience

Customers never see app IDs, secrets, environment variable names or "admin setup" messages. They see channels, states and human-readable errors.

### Providers per channel

| Card | Provider | Sign-in |
| --- | --- | --- |
| Facebook | `meta` (Facebook Pages only) | Facebook Login |
| Instagram | `instagram` (Instagram Direct) | Instagram Login — no Facebook Page, no `pages_show_list` |
| LinkedIn | `linkedin` | LinkedIn OpenID Connect |

### Facebook Pages (Meta), as the platform actually works

| Asset | What NOVA does |
| --- | --- |
| Facebook **personal profile** | Sign-in and authorization **only**. Meta doesn't allow automatic publishing to profiles, so a profile is never offered as a destination. |
| Facebook **Pages** the user manages | Discovered with `pages_show_list`, chosen in the picker ("NOVA can manage and publish content on these"). Publishing and analytics attach to Pages only. |

The flow runs in steps, and each permission is requested only when the customer asks for that step:
1. **Login** (`public_profile`). The card shows **Meta identity connected ✓** with "No manageable channel found yet", plus **[Grant access to Pages]**. This is a success state, not an error, and it doesn't count as a plan channel.
2. **Grant access to Pages.** This re-runs OAuth with `auth_type=rerequest` for `pages_show_list` only.
   - NOVA lists the managed Pages. Nothing is pre-selected, not even a single Page.
   - If the account manages no Page, the card says so.
3. **Publishing, analytics and other capabilities** light up only from **granted** permissions, e.g. `pages_manage_posts` for Page publishing. Page roles (tasks) are also respected.

### Instagram Direct (Instagram API with Instagram Login)

`src/server/integrations/providers/instagram.ts` — its own provider. It is not a child of a Facebook Page.

- **Credentials:** `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`. These are *different* from the Facebook App ID/secret; find them in the Meta dashboard under Instagram → API setup with Instagram login.
- **Redirect URI:** `INSTAGRAM_REDIRECT_URI`, or `{APP_URL}/api/integrations/instagram/callback`. Register it under Business login settings.
- **Flow:**
  1. `https://www.instagram.com/oauth/authorize` (`enable_fb_login=0`).
  2. `POST https://api.instagram.com/oauth/access_token`, server-side, which returns a short-lived token and the granted `permissions`.
  3. `graph.instagram.com/access_token?grant_type=ig_exchange_token` for a long-lived (~60 day) token, which is then encrypted.
  4. `/me` returns `user_id`, `username`, `account_type`.
- **Account types:** only **Business** or **Creator** (`MEDIA_CREATOR`) accounts are accepted. A personal account gets "Automatic publishing requires an Instagram professional account (Business or Creator)" and nothing is stored. The single account that signed in is used directly.
- **Permissions:** current names only.
  - `INSTAGRAM_OAUTH_SCOPES`: requested at login. `instagram_business_basic` is always included.
  - `INSTAGRAM_OPTIONAL_SCOPES`: requested on demand.
  - Retired names are ignored.

  | Capability | Permission |
  | --- | --- |
  | Identity | `instagram_business_basic` |
  | Publishing | `instagram_business_content_publish` |
  | Analytics | `instagram_business_manage_insights` |
  | Comments | `instagram_business_manage_comments` |
  | Messages | `instagram_business_manage_messages` |

- **Publishing:** `graph.instagram.com/{ig-user-id}/media` → `media_publish` (image, carousel, reels, stories). Instagram needs media: no text-only posts.
- **Refresh:** `ig_refresh_token`.
- **Health:** a `/me` read, because Instagram Login has no `debug_token`.
- **Disconnect:** deletes the stored token. Instagram Login has no revoke endpoint. The Facebook connection is not affected.

**Credential check.** `META_APP_SECRET` must be the 32-hex App Secret (App settings → Basic) of the app in `META_APP_ID`. An access token (`EAA…`) there is detected and treated as "not configured":
- The login dialog would still open, because it needs only the App ID.
- But the code exchange would fail with "Error validating client secret".
- The problem shows in `/admin/providers` and in the dev startup log (the value itself is never printed).

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

## Universal connection contract

One contract for every connector. It is the existing `SocialProvider` interface, exported as `IntegrationProvider` (`src/server/integrations/types.ts`).

| Contract method | Implementation |
| --- | --- |
| getAuthorizationUrl | `connect()` |
| handleCallback | `exchangeCode()` + `listAccounts()`, orchestrated by `completeConnect()` |
| refreshConnection | `refreshToken()` |
| disconnect | `disconnect()` |
| listAccounts | `listAccounts()` |
| getProfile | `getProfile?()` (optional) |
| getCapabilities | `capabilities?()` from `grantedScopes?()` (optional) |
| publishContent | `publishPost()` / `schedulePost()` |
| getMetrics | `getMetrics()` / `getAccountMetrics()` |
| (health) | `checkConnection?()` (optional) |

Optional members are capabilities: no provider is forced to implement everything. `providerRegistry()` (`registry.ts`) is the central list:
- **Live:** `meta`, `linkedin`, `tiktok`.
- **Planned, not connectable yet:** `google`, `microsoft` (email via OAuth only, never passwords).

### Connection data model (existing tables)

| Requested field | Where it lives |
| --- | --- |
| organization_id | `integrations.organizationId` (+ `workspaceId`) |
| provider | `integrations.provider` |
| external_account_id / name / username | `integration_accounts.externalId` / `name` / `handle` (+ `avatarUrl`, `accountType`) |
| encrypted_access_token / refresh_token | `integration_credentials.accessTokenEnc` / `refreshTokenEnc` (AES-256-GCM, never selected by default) |
| expires_at | `integration_credentials.expiresAt` |
| scopes | `integrations.scopes`, the permissions **actually granted** |
| provider_metadata | `integration_accounts.metadata` (`capabilities`, Page `tasks`, `pageId`, `testPosts`) |
| created_at / updated_at | both tables |

Status mapping (`IntegrationStatus`):

| Status | Stored as |
| --- | --- |
| connected | `CONNECTED` with at least one selected account |
| pending | `CONNECTED` with no selected account yet; the customer must choose in the picker |
| needs_reauth | `ACTION_REQUIRED` (a permission was removed) |
| expired | `EXPIRED` |
| error | `ERROR` |
| revoked / disconnected | `DISCONNECTED` |

`lastCheckedAt` records the last health check.

### Capabilities

Capabilities are computed from **granted** scopes, never from requested ones. For Facebook Pages, the user's Page `tasks` are also taken into account. They are stored per account and shown in the picker as ✓ (available) or ○ (not available, with the reason).

**Meta**
- **Facebook Page:**
  - `identity` — needs `pages_show_list`
  - `publish` — needs `pages_manage_posts` and the CREATE_CONTENT task
  - `metrics` — needs `read_insights` or `pages_read_engagement`, and the ANALYZE task
  - `page_management`, `messages`, `leads` — need permissions that are **not requested** and need App Review, so they show "Not available yet"
- **Instagram:**
  - `identity`
  - `instagram_publishing` — needs `instagram_content_publish`
  - `metrics` — needs `instagram_manage_insights`
  - `messages` — not requested

**LinkedIn** (scopes: `openid profile email w_member_social`)
- `identity` ✓
- `member_publishing` ✓
- `organization_publishing` ○ — requires Community Management API approval and `LINKEDIN_ORGANIZATION_ACCESS=true`

## OAuth flow (`src/server/integrations/service.ts`)

1. `GET /api/integrations/{meta|linkedin|tiktok}/start?from=onboarding|settings`
   - `/connect` is kept as an alias for older links.
   - Requires a session plus `integrations:manage`, and the plan's channel limit is checked.
   - Requests with `Sec-Fetch-Site: cross-site` are refused, so no other site can start a connect flow for a signed-in user.
   - Stores a hashed one-time `state` with a 10-minute expiry, an encrypted PKCE verifier and the return page, then redirects to the provider.
   - `from` maps to one of two fixed pages (`/onboarding/connect`, `/settings/connected-accounts`). Any other value falls back to settings, so there is no open redirect.
2. The provider redirects to `GET /api/integrations/{id}/callback`.
   - The state is verified (exists, unexpired, same provider) and consumed once.
   - The callback must be finished by **the same signed-in user** who started it, which blocks login-CSRF. A mismatched attempt also burns the state.
   - The redirect URI is `META_REDIRECT_URI` / `LINKEDIN_REDIRECT_URI` when set. It must point at `/api/integrations/{id}/callback`; otherwise it is derived from `APP_URL`.
   - The stored return page is re-checked against the allow-list.
   - The code is exchanged on the server. Denied consent returns `oauth_denied`; a failed exchange returns `integration_error` (details go to the server log only); no business accounts returns `no_accounts`.
3. Storage:
   - Tokens are encrypted (AES-256-GCM, `ENCRYPTION_KEY`) into `integration_credentials`.
   - Accounts are upserted: active if there is exactly one, or if it was previously chosen; otherwise the account waits for the customer's choice.
   - The event is written to the audit log.
   - A first sync is queued only for platforms whose account is chosen.
   - The browser is sent back with `?connected=…&choose=…&limited=…` or `?error=<code>`, never a code, state or token.
4. The **account picker** ("Choose the accounts you want NOVA to manage") shows everything one sign-in returned: Pages and Instagram accounts together, each with avatar, name, @username, platform and capabilities. Nothing is pre-selected.
   - `selectAccountsBatch()` activates exactly the chosen accounts.
   - A platform with nothing chosen is released.
   - It is scoped to the caller's workspace, and IDs from another integration or tenant are rejected.
5. Tokens are never sent to the browser. Only `tokenForAccount()` decrypts them, inside server jobs.

**Other lifecycle behaviour:**
- **Token refresh:** runs hourly (`integrations.refresh_tokens`) for credentials expiring within 7 days.
- **Provider failures:** normalized into `ProviderError` kinds (expired / permission / rate_limited / invalid_media / unavailable / unknown). The integration is marked `EXPIRED` / `ACTION_REQUIRED` / `ERROR`, admins are notified with a link to Connected accounts, and the card shows **Reconnect**.
- **Health check:** runs every 6 hours (`integrations.health_check`). It validates live tokens with Meta `debug_token` or LinkedIn token introspection. Invalid tokens become `EXPIRED` / `ACTION_REQUIRED` and the customer is notified: "The connection expired. Reconnect to continue." Transient outages do not change the status.
- **Disconnect:**
  - Verifies tenant ownership.
  - Revokes at the provider, but only when no sibling integration still uses the same grant (Instagram and Facebook share one Meta grant).
  - Deletes the credentials, deactivates the accounts and frees the channel.
  - Keeps posts, metrics and the audit history.
- **Errors shown to customers:** always human-readable, e.g. "We couldn't complete the connection. Please try again." Raw provider codes (`OAuthException`, `invalid_grant`, 401…) go to server logs only.

## Provider configuration (platform admins only)

`/admin/providers` reads the environment and shows **Configured / Missing / Error** (Error = half-configured) for Meta, LinkedIn, TikTok, OpenAI, Anthropic, Email, Storage and Payments.
- IDs are masked (`1234••••89`) and secrets are shown only as `••••`.
- Nothing is editable, and secrets are never copied into the database. Change them in the deployment environment.

**Connection tests.** These appear on the same page, run only against the admin's **own workspace** connections, and are read-only:
- **Meta:** `debug_token` validity and expiry, the Pages list, the linked Instagram accounts, granted scopes and per-account capabilities.
- **LinkedIn:** token introspection, the connected member, granted scopes and capabilities.

**Publish test post** is a separate button. It publishes the fixed text "NOVA integration test — this post can be deleted." only after the admin types `PUBLISH`.
- Rate limit: 5 per hour.
- Supported on Facebook Pages and LinkedIn. Instagram needs an image.
- The external post id is saved on the account (`metadata.testPosts`) and written to the audit log.
- Results never contain tokens.

## Status matrix

| Integration | Implemented | Locally tested | Integration-tested (mocked) | Real-provider tested |
| --- | --- | --- | --- | --- |
| Meta: Facebook Pages | OAuth, long-lived tokens, granted-scope detection, Page tasks → capabilities, account picker, publish (feed/photo), native schedule (text), posts, insights, debug_token health check, admin test + confirmed test post | ✓ UI/flow (picker rendered with temporary rows) | ✓ OAuth start/callback/state/picker/capabilities/disconnect/expiry/missing credentials with mocked Graph API | ✗ **not tested with a real Meta app or account** (no credentials in this environment) |
| Instagram Direct (Instagram Login) | OAuth (instagram.com) + long-lived token, Business/Creator only, profile, capability-gated publishing/insights, refresh, health | ✓ | ✓ start/callback/personal-account refusal/upgrade/publish/health/disconnect with mocked API | ✗ **pending: INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET not configured** |
| LinkedIn | OIDC (`openid profile email w_member_social`), profile, member posting, image upload, introspection health check, admin test + confirmed test post; org pages only when `LINKEDIN_ORGANIZATION_ACCESS=true` | ✓ | ✓ OAuth start/callback/profile/scopes/capabilities/disconnect/expiry/missing credentials with mocked API | ✗ **not tested with a real LinkedIn app or account** |
| TikTok | Login Kit v2 + PKCE, refresh, Content Posting (PULL_FROM_URL), video list/query | ✓ | ✓ | ✗ pending |
| X / YouTube / Pinterest | listed as "coming soon" | — | — | — |
| OpenAI | text, structured, stream, embeddings, images | offline provider used locally | provider logic unit-tested | ✗ pending (no key in this environment) |
| Anthropic | text, structured, stream, refusal fallbacks | offline provider used locally | router tested | ✗ pending (no key in this environment) |
| Email (SMTP) | verification, magic link, reset, invitations, notifications, sales replies | ✓ via Mailpit | — | n/a |
| Website lead capture | embed + public API | ✓ manual + automated | ✓ | n/a |
| Google (Gmail + Calendar) | OAuth + PKCE, identity first, incremental gmail.send / calendar scopes, send email, free/busy, create/update/cancel events | ✓ UI | ✓ mocked Google APIs | ✗ pending (no Google OAuth credentials for account connections) |
| Microsoft (Outlook + Calendar) | OAuth + PKCE (tenant configurable), incremental Mail.Send / Calendars.ReadWrite, Graph sendMail, getSchedule, events | ✓ UI | ✓ mocked Graph | ✗ pending |
| WhatsApp Business Platform | Cloud API: signed webhook + verify challenge, inbound → lead/conversation, delivery statuses, 24h window, templates, admin number linking | — | ✓ signature/idempotency/window tests | ✗ pending (no WhatsApp credentials) |
| Instagram / Facebook DMs | `MessageChannel` reports "not configured" until messaging permissions pass App Review | — | — | ✗ |
| File storage (S3/R2) | SigV4 driver: put/get/delete/presign, org-scoped keys | ✓ MinIO | ✓ AWS SigV4 reference vectors + mocked fetch | ✗ pending (AWS S3 / R2 account) |
| Payments (Stripe) | Checkout, portal, upgrade/downgrade with proration, cancel at period end, verified idempotent webhook, invoice sync | — | ✓ mocked Stripe API + signature tests | ✗ **pending: no Stripe keys; needs a test-mode run on HTTPS staging** |

### Provider setup

**Meta**
- Create an app (Business type).
- Add Facebook Login for Business and the Instagram Graph API.
- Redirect URI: `{APP_URL}/api/integrations/meta/callback` (or set `META_REDIRECT_URI` to exactly what is registered).
- **Permissions are configuration, not code** (`src/server/integrations/providers/meta-scopes.ts`). Meta rejects the *whole* login with "Invalid Scopes" when a single requested permission isn't enabled for the app, so NOVA asks only for what you configure:

  | Variable | Meaning |
  | --- | --- |
  | `META_PERMISSION_MODE=minimal` (default) | `public_profile` + `META_OAUTH_SCOPES` |
  | `META_PERMISSION_MODE=configured` | exactly `META_OAUTH_SCOPES` |
  | `META_OAUTH_SCOPES` | Comma- or space-separated. Duplicates are removed; unknown or retired names (e.g. `manage_pages`) are ignored and listed in `/admin/providers`. |
  | `META_OPTIONAL_SCOPES` | Enabled in the app, but requested only when a feature needs them (see *Permission upgrades*). |
  | `META_LOGIN_CONFIG_ID` | Facebook Login for Business configuration id. It is sent instead of `scope`, because the permission set lives in that configuration. |

- **Rollout:**
  1. Leave `META_OAUTH_SCOPES` empty. OAuth reaches NOVA; with no Page access NOVA says so ("no_page_permission").
  2. Add `pages_show_list` for Page discovery.
  3. Then add `instagram_basic`, `pages_manage_posts`, `read_insights`, `instagram_content_publish` and `instagram_manage_insights` as each is enabled or approved in the Meta dashboard.
  4. Request `business_management` only if you truly need Business Manager assets.
- **Capability → permission map:**

  | Capability | Permissions |
  | --- | --- |
  | Facebook discovery | `pages_show_list` |
  | Facebook publishing | + `pages_manage_posts` |
  | Facebook analytics | + `read_insights` |
  | Instagram identity | `pages_show_list`, `instagram_basic` |
  | Instagram publishing | + `instagram_content_publish` |
  | Instagram analytics | + `instagram_manage_insights` |
  | Business assets | `business_management` |

  Capabilities are true only when the permission was **granted**.
- **Permission upgrades:** when a feature needs a permission the connection lacks (e.g. publishing without `pages_manage_posts`), NOVA does not call the platform.
  - The post fails with "NOVA needs an additional permission to do this." and a link to Connected accounts, which shows **Grant permission**.
  - That button re-runs OAuth with `auth_type=rerequest` and only the configured scopes plus what the capability needs (`/api/integrations/meta/start?upgrade=FACEBOOK:publish`).
  - Only permissions listed in `META_OAUTH_SCOPES` / `META_OPTIONAL_SCOPES` can be requested this way; anything else returns "not available yet".
- **Invalid scopes:**
  - **When Meta redirects back with `invalid_scope`:** NOVA logs `provider=meta error_type=invalid_scope requested_scopes=[…]` and shows "We couldn't finish connecting Meta because a permission isn't enabled in the app yet."
  - **When Meta shows the error on its own dialog page** (common for unconfigured permissions): the browser never returns to NOVA. The attempt stays "Started, not returned" in `/admin/providers`.
- Instagram media must be reachable at a public URL, so `APP_URL` must be public.
- Before App Review, only people with a role on the app (admin/developer/tester) can connect, and only Pages they manage.

**OAuth diagnostics** (`/admin/providers`, platform admins only):
- Redirect URI: not secret, and must match the console exactly.
- Permission mode.
- Requested / optional / ignored permissions.
- The **last sign-in attempt** from your workspace: outcome, granted permissions, and requested-but-not-granted permissions.
- Every capability as available / enabled-not-granted / advanced permission not enabled.

In development, the server also logs `LinkedIn redirect URI: configured` / `Meta redirect URI: configured` at startup. It never logs the URI itself, secrets or tokens.

**LinkedIn**
- Add the products "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn".
- Redirect URI: `{APP_URL}/api/integrations/linkedin/callback` (or set `LINKEDIN_REDIRECT_URI`).
  - Register **this backend callback** under *Auth → Authorized redirect URLs*, character for character (e.g. `http://localhost:3000/api/integrations/linkedin/callback`).
  - Do **not** register `/settings/connected-accounts`. That is where NOVA sends the user *after* it has processed the callback.
  - The same literal string is used in the authorization request and in the token exchange, with no added query parameters.
  - A value pointing anywhere else (a settings page, a query string, a trailing slash) is refused at startup and shown as invalid in `/admin/providers`.
- Scopes requested: `openid profile email w_member_social` only.
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

Stripe (`src/server/billing/stripe.ts`, webhook `/api/webhooks/stripe`):
- one Stripe customer per organization; Checkout for a new subscription; plan changes on an existing subscription happen in place with proration; cancel at period end; billing portal;
- idempotency keys on every write;
- the webhook verifies `Stripe-Signature` (5-minute tolerance), stores each event once in `billing_events`, re-reads the subscription from Stripe (so out-of-order events are safe), applies the plan only while the subscription is active/trialing, moves to STARTER when it ends, and upserts `invoices`;
- **plans change only from verified webhooks**, never from the redirect back from Checkout.

Payments are off (`billing_not_configured`, nothing charged or simulated) until `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and at least `STRIPE_PRICE_GROWTH` are set.
