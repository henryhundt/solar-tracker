# Contribution Workflow

Keep `main` deployable. Make changes on a short-lived branch (Codex branches use `codex/`), open a pull request, and merge only after `CI / validate` passes and review conversations are resolved.

Before opening a pull request, run:

```bash
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run build
npm audit --omit=dev --audit-level=high
```

Browser regression tests use intercepted fixture pages and synthetic credentials; they do not contact solar providers.

## Database changes

Add a forward-only SQL file in `migrations/` using the next numeric prefix. Never edit a migration after it has been applied: the runner verifies SHA-256 checksums and rejects modified history. Make migrations safe for both a populated production database and a clean database. Test a second run to prove idempotency.

Do not use `db:push` against staging or production. Deployments use `npm run migrate`; back up production before a data-changing migration.

## Merge and deploy policy

- Use squash merge for focused pull requests and write the final message in imperative form.
- Require one approval and the `CI / validate` status check on `main`.
- Disallow force pushes and branch deletion for `main`.
- Deploy production only from `main`; use a staging environment for migrations, auth, scraper, or hosting changes.
- Revert the merge commit for application rollback. Do not reverse a production migration unless a separately reviewed forward migration makes that safe.
