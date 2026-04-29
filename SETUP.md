# Hoffman PDC Solar Track - Setup Guide

## Prerequisites

- **Node.js** 20 LTS recommended
- **PostgreSQL** 14+ (local or hosted)
- **npm** (comes with Node.js)

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Install Playwright browsers** (needed for SolarEdge and Also Energy browser automation):
   ```bash
   npx playwright install chromium
   ```

   On Linux, also install the required system libraries:
   ```bash
   npx playwright install-deps chromium
   ```

3. **Set up your environment:**
   - Create a PostgreSQL database
   - Copy `.env.example` to `.env` and fill in your `DATABASE_URL`
   ```bash
   cp .env.example .env
   # Edit .env with your database connection string
   ```

4. **Push the database schema:**
   ```bash
   npm run db:push:local
   ```

5. **Run in development mode:**
   ```bash
   npm run dev:local
   ```
   The app will be available at the `PORT` from your `.env` file.

6. **Build for production:**
   ```bash
   npm run build
   npm start
   ```

## Environment Variables

See `.env.example` for all available variables. In the current codebase, the required variable is:

- `DATABASE_URL` - PostgreSQL connection string (required)

Useful local-development variables:

- `PORT` - App port for local development
- `ADMIN_USERNAME` - Enables the login screen when set
- `ADMIN_PASSWORD` - Password for the hosted/admin login
- `SESSION_SECRET` - Session cookie signing secret
- `SEED_ON_BOOT=true` - Seeds demo data when the database is empty
- `ENABLE_INTERNAL_SCHEDULER=false` - Keeps background sync jobs out of the way while testing changes

For production or any public deployment, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET` are required. In local development, if you leave the admin credentials unset, the app skips the login screen for convenience.

### Per-Site Credentials (Optional)

For solar portal credentials stored as environment variables, use the pattern:
- `{KEY}_USERNAME` - Portal username
- `{KEY}_PASSWORD` - Portal password
- `{KEY}_URL` - Portal URL
- `{KEY}_API_KEY` - API key (for API-based scrapers)

Example: If credential key is `SOLAR_PORTAL_1`:
- `SOLAR_PORTAL_1_USERNAME=myuser@example.com`
- `SOLAR_PORTAL_1_PASSWORD=mypassword`
- `SOLAR_PORTAL_1_API_KEY=your-solaredge-api-key`

Also Energy example:
- `ALSOENERGY_TEST_USERNAME=myuser@example.com`
- `ALSOENERGY_TEST_PASSWORD=super-secret-password`
- `ALSOENERGY_TEST_URL=https://apps.alsoenergy.com`

You can also store credentials directly in the database via the UI (no environment variables needed).

## Project Structure

```
├── client/           # React frontend (Vite)
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── lib/         # Utilities
│   │   └── pages/       # Page components
│   └── index.html
├── server/           # Express backend
   │   ├── scrapers/     # Portal-specific scrapers
   │   │   ├── egauge.ts                    # eGauge JSON WebAPI with XML fallback
   │   │   ├── solaredge-api.ts             # SolarEdge REST API
   │   │   ├── solaredge-browser.ts         # SolarEdge Playwright automation
   │   │   ├── alsoenergy.ts                # Also Energy REST API
   │   │   ├── alsoenergy-browser.ts        # Also Energy Playwright automation
   │   │   ├── alsoenergy-api-archived.ts   # Older archived Also Energy implementation
   │   │   └── mock.ts                      # Mock data for testing
│   ├── routes.ts     # API routes
│   ├── storage.ts    # Database access layer
│   ├── scraper.ts    # Scraper router
│   └── scheduler.ts  # Auto-sync scheduler (1 AM Central)
├── shared/           # Shared types & schemas
│   ├── schema.ts     # Drizzle DB schema + Zod validation
│   └── routes.ts     # API route contracts
└── script/
    └── build.ts      # Production build script
```

## Scraper Types

| Type | Auth Method | Use Case |
|------|-------------|----------|
| `solaredge_api` | API Key or stored secret | SolarEdge with admin/API access |
| `solaredge_browser` | Username/Password | SolarEdge viewer-only (Playwright) |
| `egauge` | Optional Username/Password | eGauge monitors (JSON WebAPI when available, legacy XML fallback for classic proxy meters) |
| `alsoenergy` | Username/Password | Also Energy PowerTrack (browser with `S...` site key, or REST API with numeric site ID) |
| `mock` | None | Testing/development |

## SolarEdge Setup Notes

SolarEdge now has two supported onboarding paths in this repo:

1. **API-key discovery** for accounts with SolarEdge API access. The Add Site dialog can list available sites from a direct API key or from a stored `{KEY}_API_KEY` secret.
2. **Browser discovery** for viewer-only accounts. The Add Site dialog can log into the monitoring portal, enumerate visible sites, and save the numeric Site ID so the browser scraper does not have to guess which site to open later.

For the browser path, use **Discover Sites from Account** and keep the discovered numeric Site ID even if you originally knew the site by name. That makes multi-site accounts much more reliable at scrape time.

## Also Energy Setup Notes

Also Energy PowerTrack currently has two workable paths in this repo:

1. Browser automation for standard account logins. The discover flow returns `S`-prefixed PowerTrack site keys (for example `S41121`), and those keys drive the browser scraper.
2. REST API access for accounts where numeric PowerTrack site IDs are available and authorized.

The browser scraper logs into `https://apps.alsoenergy.com`, follows the current redirect-based auth flow, discovers `S`-prefixed site keys from the portal navigation, and then extracts production data by intercepting the authenticated `/api/production/{siteKey}` response.

To add Also Energy sites without API setup, use the **Discover Sites from Account** flow in the Add Site dialog. That path only needs a working username and password. If you later obtain REST API access, keep the discovered `S...` browser key and add the numeric API site ID in the edit dialog so the app can prefer the API path and still keep the browser fallback.

## Notes

- The hosted app now uses an admin login before anyone can manage sites or trigger syncs
- The auto-sync scheduler runs daily at 1:00 AM Central Time
- Duplicate readings are automatically prevented
- The app serves both frontend and API on the same port (default 5000)
- Also Energy and SolarEdge browser scrapers require Chromium (installed via Playwright)
- The `npm run dev:local` and `npm run db:push:local` commands load `.env` automatically
- For hosted deployments, see `HOSTING.md`
