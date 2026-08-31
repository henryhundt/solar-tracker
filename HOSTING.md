# Hosting and Operations

This app needs a container host, PostgreSQL, Chromium, and a scheduler that can run a terminating command. Static and conventional serverless hosting are poor fits for the Playwright scrapers.

## Recommended production shape: Railway + managed PostgreSQL

Use two Railway services from this repository:

1. **Web service** — uses the Dockerfile and its default `npm start` command.
2. **Cron service** — uses the same repository and Dockerfile, overrides the start command to `npm run sync:all`, and sets the cron schedule to `15 6 * * *` (06:15 UTC daily).

Railway schedules cron in UTC. The recommended schedule runs at 1:15 AM during Central daylight time and 12:15 AM during Central standard time. If an exact local clock time matters more than isolating the job from the web process, omit the cron service and set `ENABLE_INTERNAL_SCHEDULER=true` on exactly one web replica instead.

Do not enable both scheduling methods. Database leases prevent concurrent full-sync runs, but two schedules could still run one after the other.

### Required web-service settings

Set the health check path to `/healthz` and configure:

```text
DATABASE_URL=your-managed-postgres-connection-string
NODE_ENV=production
ADMIN_USERNAME=your-admin-login
ADMIN_PASSWORD=choose-a-strong-unique-password
SESSION_SECRET=generate-a-long-random-secret
CREDENTIAL_ENCRYPTION_KEY=generate-32-random-bytes-as-base64
SESSION_MAX_AGE_HOURS=168
SEED_ON_BOOT=false
ENABLE_INTERNAL_SCHEDULER=false
PROVIDER_HTTP_TIMEOUT_MS=30000
SHUTDOWN_GRACE_MS=30000
```

Generate the encryption key once with `openssl rand -base64 32`, store it as a Railway secret, and back it up in a password manager. Changing or losing it makes directly stored provider credentials unreadable. Prefer `{KEY}_USERNAME`, `{KEY}_PASSWORD`, `{KEY}_URL`, and `{KEY}_API_KEY` environment variables when practical.

Set Railway’s pre-deploy command for the web service to `npm run migrate`. The start command also runs the idempotent migration check, so a missing pre-deploy setting is safe; the explicit setting prevents a bad migration from reaching the deployment phase.

The cron service needs the same `DATABASE_URL`, `CREDENTIAL_ENCRYPTION_KEY`, and provider credential variables. It does not need the admin login or session secret because it never starts the web server.

Official references: [Railway cron jobs](https://docs.railway.com/cron-jobs), [Railway pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command), and [Railway Dockerfiles](https://docs.railway.com/reference/dockerfiles).

## Rollout order

1. Back up PostgreSQL and confirm the restore procedure.
2. Add `CREDENTIAL_ENCRYPTION_KEY` and the other required production variables before deploying this version.
3. Open a pull request from `codex/production-hardening`; require the `CI / validate` check and review the migration.
4. Deploy to a staging Railway environment against a disposable database. Confirm migrations, login, site editing, one individual sync, CSV export, and `/healthz`.
5. Merge the reviewed commit and deploy the web service. Startup converts existing direct credentials to AES-256-GCM ciphertext in one transaction.
6. Add the Railway cron service with `npm run sync:all`, then verify one manual cron execution exits successfully and reports per-site totals.
7. Confirm `ENABLE_INTERNAL_SCHEDULER=false` on the web service and leave the GitHub workflow as manual fallback only.
8. Protect `main`: require pull requests, one approval, `CI / validate`, resolved conversations, and disallow force pushes/deletions. Keep Railway production deploys tied to `main` only.

## Operations

- A full sync uses a PostgreSQL lease, so only one process can own it at a time.
- The standalone sync exits nonzero when any site fails or is skipped. Configure Railway failure notifications for the cron service.
- `/api/internal/sync-all` waits for completion and returns a failing HTTP status for partial failure. It remains available for the manual GitHub fallback and requires `CRON_SECRET`.
- `/healthz` checks PostgreSQL as well as the web process.
- `SIGTERM` stops new connections and gives tracked sync work up to `SHUTDOWN_GRACE_MS` to finish.
- Inspect `last_error`, `last_synced_at`, and cron logs after every failed run. Do not repeatedly retry a provider that is rejecting credentials or rate-limiting requests.

## GitHub Actions fallback

`.github/workflows/daily-sync.yml` is intentionally manual-only. Public-repository scheduled workflows can be delayed and are automatically disabled after 60 days without repository activity. For a manual run, configure `SOLAR_TRACKER_SYNC_URL` (or legacy `APP_URL`) and `CRON_SECRET` as repository secrets.

Reference: [GitHub scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Render fallback

Render can run the Docker web service, but its Free tier is only appropriate for previews or low-stakes hobby use: free web services spin down after 15 idle minutes, may restart, and do not support free cron jobs. A paid Render web service plus a paid cron job is viable; use `npm run sync:all` for the cron command and keep the internal scheduler disabled.

Reference: [Render Free limitations](https://render.com/docs/free) and [Render service types](https://render.com/docs/your-first-deploy).

## Why not Vercel or Netlify?

The app depends on long-running Playwright/Chromium work and coordinated scheduled jobs. A container service with a terminating cron process maps cleanly to those requirements.
