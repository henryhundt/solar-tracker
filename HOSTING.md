# Hosting Guide

This app is not a good fit for static hosting or most serverless platforms because it needs:

- a long-running Node server
- PostgreSQL
- Chromium for the Playwright-based scrapers
- a reliable daily sync job

## Recommended: Railway + Neon

This is the best low-cost production setup for this codebase.

Estimated cost as of 2026-03-26:

- Railway Hobby: about $5/month, with usage billed against that included amount first
- Neon Free Postgres: $0/month for hobby use

### Why this is the best fit

- The app stays awake, so the built-in scheduler can run normally.
- The included `Dockerfile` already packages Chromium for Playwright.
- You only pay for one app container if usage stays small.

### Steps

1. Create a free PostgreSQL database in Neon and copy its connection string.
2. Run the schema push once from your machine:

   ```bash
   DATABASE_URL="your-neon-connection-string" npm run db:push
   ```

3. Push this repo to GitHub.
4. In Railway, create a new service from the repo. Railway will detect the root `Dockerfile`.
5. Add these environment variables in Railway:

   ```bash
   DATABASE_URL=your-neon-connection-string
   NODE_ENV=production
   ADMIN_USERNAME=your-admin-login
   ADMIN_PASSWORD=choose-a-strong-password
   SESSION_SECRET=generate-a-long-random-secret
   SEED_ON_BOOT=false
   ENABLE_INTERNAL_SCHEDULER=true
   SYNC_TIMEZONE=America/Chicago
   ```

6. Set the health check path to `/healthz`.
7. Deploy.

### Notes

- If you store scraper credentials in environment variables, add them in Railway using the `{KEY}_USERNAME`, `{KEY}_PASSWORD`, `{KEY}_URL`, and `{KEY}_API_KEY` pattern.
- The hosted app now requires an admin sign-in. `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET` must be present in production or the server will refuse to start.
- Railway Docker docs: https://docs.railway.com/reference/dockerfiles
- Railway billing docs: https://docs.railway.com/pricing/understanding-your-bill
- Neon pricing: https://neon.com/pricing

## Free Hobby Setup: Render + Neon + GitHub Actions

This is the closest thing to fully free for personal use, but it has tradeoffs.

### What is included in this repo

- `render.yaml` for a free Render web service
- `.github/workflows/free-daily-sync.yml` for the daily sync trigger
- `/api/internal/sync-all` protected by `CRON_SECRET`

### Steps

1. Create a free PostgreSQL database in Neon.
2. Run the schema push once from your machine:

   ```bash
   DATABASE_URL="your-neon-connection-string" npm run db:push
   ```

3. Push the repo to GitHub.
4. In Render, create a Blueprint from this repo so it uses `render.yaml`.
5. When Render asks for `DATABASE_URL`, paste your Neon connection string.
6. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` for the app login, and keep the generated `SESSION_SECRET`.
7. After deploy, copy your app URL, then add these GitHub repository secrets:

   ```bash
   APP_URL=https://your-app.onrender.com
   CRON_SECRET=the-same-generated-secret-from-render
   ```

8. Keep `ENABLE_INTERNAL_SCHEDULER=false` on Render so only GitHub Actions triggers the daily sync.

### Tradeoffs

- Render free web services sleep when idle, so the first request can be slow.
- The GitHub Actions schedule runs in UTC, so the local Central Time trigger shifts during daylight saving time.
- This is fine for a hobby dashboard, but not what I would use for business-critical monitoring.

### Docs

- Render Docker docs: https://render.com/docs/docker
- Render Blueprint reference: https://render.com/docs/blueprint-spec
- Render pricing: https://render.com/pricing/
- GitHub Actions scheduled workflows: https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#schedule

## Why I did not target Vercel or Netlify

Those platforms are great for static sites and serverless APIs, but this app depends on a persistent Node process, Playwright, and scheduled scraping. A single container host is much simpler and cheaper for this project.
