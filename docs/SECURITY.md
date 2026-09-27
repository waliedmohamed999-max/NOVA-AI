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
| Rate limiting | PostgreSQL fixed-window buckets: sign-in (IP + email), sign-up, magic link, reset, uploads, AI actions, invitations, public lead capture |
| OAuth (social) | Hashed one-time state bound to org/workspace/user/provider, 10-min expiry, consumed before use; PKCE; redirect targets restricted to relative paths |
| Credentials at rest | AES-256-GCM with versioned keys (`ENCRYPTION_KEY`), never selected by default, never returned to clients, excluded from data exports and admin views |
| Unsafe redirects | `safeRedirect()` only allows same-site relative paths (`/x`, not `//x`) |
| File uploads | 10 MB cap; type detected from magic bytes (PNG/JPEG/GIF/WebP/PDF) or strict text types; random storage keys; path-traversal guard; served with `nosniff`, sandboxed CSP and attachment disposition for non-images |
| SSRF | Website ingestion: http(s) only, no credentials/ports, DNS resolved and private/loopback/link-local ranges rejected on every redirect hop, size and time caps |
| XSS | React escaping; no `dangerouslySetInnerHTML`; email templates escape all variables |
| Secrets in logs | pino redaction for password/token/secret/cookie/authorization/code keys; provider errors redact token fields; AI errors store messages only |
| Headers | HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options SAMEORIGIN (except `/embed/*`, which sets `frame-ancestors *`) |
| Admin | `/admin` requires `isPlatformAdmin` in every page (404 otherwise); read models never select secrets; job retry audited |
| Audit | Append-only `audit_logs` (DB trigger blocks updates), SECURITY category for auth/team/integration/data events |
| Privacy | Data export (JSON, no credentials), organization deletion (files + all tenant rows), account deletion, integration disconnect with token revoke |
| AI safety | Offline provider refused in production; budgets with hard stop; sensitive sales topics always require approval by default |

## Known gaps / hardening backlog

- DNS-rebinding TOCTOU in `safe-fetch` (lookup and fetch are separate calls); mitigate with a pinned-IP agent or an egress proxy.
- Postgres row-level security as defence in depth (application-level scoping is in place today).
- A Content-Security-Policy with nonces for the app pages.
- The in-process circuit breaker and caches are per instance.
