# Vercel environment setup

`.env.production.example` lists every variable from the development and staging
templates, plus any additional locally configured variable names. It contains
no real credentials. Uploading this file to GitHub does not configure Vercel.

1. Create a hosted PostgreSQL database with the `vector` extension available.
2. In the Vercel project's **Settings > Environment Variables**, set
   `DATABASE_URL` to the provider's PostgreSQL connection string. Never use
   `localhost` or `127.0.0.1`: those refer to the Vercel instance, not your PC.
3. Set `APP_URL` to the actual public HTTPS origin, without a trailing slash.
   Generate unique `AUTH_SECRET` and `ENCRYPTION_KEY` values as described in the
   template. Keep existing secrets when updating an already configured deployment.
4. Configure a real email provider for account verification and password reset.
   Add AI, OAuth, payment and storage credentials only for services you use.
   Do not import blank optional variables over existing configured values.
5. Apply the committed migrations against the hosted database using
   `npm run db:migrate` in an environment with its `DATABASE_URL` configured.
   Do not run `db:reset` against the hosted database.
6. Redeploy the latest commit. Environment changes require a new deployment.

Scope each value to the intended Vercel environment. Preview deployments should
use a separate database and secrets. `TEST_DATABASE_URL` belongs to local tests,
not the deployed application. Background jobs need a separately running worker;
uploaded files need persistent object storage.

Keep actual values in Vercel's environment settings or ignored local environment
files. Commit only the example template. A reachable, migrated database is required
for sign-up and sign-in; the template alone cannot enable them.
