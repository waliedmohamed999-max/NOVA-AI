# Security

| Control | Implementation |
| --- | --- |
| Passwords | Argon2id (19 MiB, t=2), min 10 chars with letter + digit; constant-time dummy verify for unknown users |
| Sessions | Random 256-bit token in an httpOnly, SameSite=Lax, Secure (prod) cookie; only the SHA-256 hash is stored; 30-day rolling expiry; revoked on password reset/change; per-device revoke in Settings → Security |
| Email tokens | Hashed, single-use (atomic consume), purpose-bound, short TTL (verify 24h, reset 30m, magic link 15m); reset/magic responses never reveal whether an account exists |
| Google sign-in | OIDC code flow + PKCE; state + verifier in an encrypted, path-scoped, 10-minute cookie |
| Tenant isolation | `tenantDb()` scope injection on every tenant model (reads, updates, deletes, creates); raw SQL filters explicitly; integration tests prove cross-tenant reads/writes/moves fail |
| IDOR | All entity access goes through the tenant-scoped client, so IDs from another tenant resolve to "not found"; file downloads require HMAC-signed, expiring URLs |
| RBAC | `src/server/rbac.ts` roles → permissions; checked server-side in every action (`tenantAction`) and page (`requireTenant({ permission })` → `/forbidden`); role assignment limited to roles below your own; last owner protected |
| CSRF | Server Actions (Next.js Origin check); route handlers that mutate are either OAuth callbacks (state-verified), the upload route (session + origin check) or the public lead API (origin allow-list, no cookies used) |
| Rate limiting | PostgreSQL fixed-window buckets (shared by all instances): sign-in (IP + email), sign-up, magic link, reset, uploads, AI actions, invitations, public lead capture |
| Client IP | `clientIp()` (`src/server/net/client-ip.ts`) ignores `X-Forwarded-For` unless `TRUST_PROXY` is set, then takes the entry appended by the trusted hop (rightmost − n), never the spoofable leftmost one; optional `TRUST_PROXY_HEADER` (e.g. `cf-connecting-ip`). See DEPLOYMENT.md |
| OAuth (social) | Hashed one-time state bound to org/workspace/user/provider, 10-min expiry, consumed before use; PKCE; code exchange and tokens server-side only; the return page is an allow-list (`onboarding` → `/onboarding/connect`, `settings` → `/settings/connected-accounts`) re-checked at callback; callback redirects carry only platform names and an error code — never codes, state or tokens; social passwords are never requested or stored |
| Credentials at rest | AES-256-GCM with versioned keys (`ENCRYPTION_KEY`), never selected by default, never returned to clients, excluded from data exports and admin views |
| Unsafe redirects | `safeInternalPath()` (`src/lib/safe-path.ts`) allows only same-origin paths — rejects `//x`, `/\x`, control characters and absolute URLs; used for every `next` parameter |
| File uploads | 10 MB cap; type detected from magic bytes (PNG/JPEG/GIF/WebP/PDF) or strict text types; keys are `<organizationId>/<yyyy-mm>/<uuid>.<ext>` and reads/deletes re-check the organization prefix; path-traversal guard (local) and key validation (S3); buckets stay private; served through HMAC-signed expiring URLs with `nosniff`, sandboxed CSP and attachment disposition for non-images (or, opt-in, 5-minute S3 presigned redirects) |
| SSRF | Website ingestion (`src/server/net/safe-fetch.ts`): http(s) only, no credentials, default ports only; DNS is resolved **inside the socket's lookup** and every returned address is checked there, so the validated IP is the connected IP (no DNS-rebinding window); blocks all IPv4/IPv6 private, loopback, link-local (incl. `169.254.169.254`), CGNAT, multicast, reserved, NAT64/6to4/Teredo and IPv4-mapped ranges plus `localhost`/`.local`/`.internal`/metadata host names; no connection pooling, so every redirect hop re-resolves and re-validates; ≤4 redirects, 2 MB, 12 s; only HTML/XHTML/plain-text bodies are read |
| XSS | React escaping; no `dangerouslySetInnerHTML`; email templates escape all variables |
| Secrets in logs | pino redaction for password/token/secret/cookie/authorization/code keys; provider errors redact token fields; AI errors store messages only |
| Headers | HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options SAMEORIGIN (except `/embed/*`) |
| CSP | Per-request nonce set in `src/proxy.ts` (`src/server/security/csp.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-inline`; `unsafe-eval` only in development), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `connect-src 'self'`, `frame-src 'self'`, `frame-ancestors 'self'` (`*` only on `/embed/*`), `upgrade-insecure-requests` when `APP_URL` is https. `style-src` keeps `'unsafe-inline'` (React/motion inline style attributes cannot carry a nonce). `img-src` allows `https:` for platform avatars/thumbnails. OAuth sign-in/connect are top-level navigations and are unaffected. Verified in production mode with zero violations |
| Admin | `/admin` requires `isPlatformAdmin` in every page (404 otherwise); read models never select secrets; job retry audited; `/admin/providers` shows env-based configuration status with masked IDs (`1234••••89`) and secrets as `••••` — secrets are never copied into the database |
| Audit | Append-only `audit_logs` (DB trigger blocks updates), SECURITY category for auth/team/integration/data events |
| Privacy | Data export (JSON, no credentials), organization deletion (files + all tenant rows), account deletion, integration disconnect with token revoke |
| AI safety | Offline provider refused in production; budgets with hard stop; sensitive sales topics always require approval by default |

## Known gaps / hardening backlog

- **Payments:** the Stripe adapter and webhook are not implemented (see INTEGRATIONS.md → Billing). Plan changes return `billing_not_configured`.
- Postgres row-level security as defence in depth (application-level scoping is in place and tested today).
- Magic links are consumed on `GET`; aggressive email link scanners could consume a link before the user clicks it (the user can request a new one). A confirm-page step would remove this.
- `npm audit` reports 4 high advisories in the **Prisma CLI's** transitive dependencies (`mysql2`, `deepmerge-ts`). They are build/migration tooling, not loaded by the running app (which uses `@prisma/adapter-pg`); the only offered fix is a Prisma downgrade. Re-check on the next Prisma release.
- The AI circuit breaker is process-local by design (see AI-SYSTEM.md). Budgets and rate limits are shared (PostgreSQL).
- Real-provider validation (Meta, LinkedIn, TikTok, OpenAI, Anthropic, S3 on AWS/R2) has not been done in this environment; S3 compatibility was validated against MinIO and AWS's published SigV4 test vectors.
