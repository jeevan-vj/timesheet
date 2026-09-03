# Deployment

## Production resources

- Worker: `cleantrack-timesheet`
- D1 database: `cleantrack-timesheet` in Oceania, bound as `DB`
- Direct production origin: `https://cleantrack-timesheet.jeevan90wijerathna.workers.dev`, also stored as the `PRODUCTION_URL` variable in the protected GitHub `production` environment

`BETTER_AUTH_SECRET` is a Worker runtime secret. Keep it in Cloudflare and never copy it into GitHub. `BETTER_AUTH_URL`, `AUTH_TRUSTED_ORIGINS`, and `RELEASE_SHA` are non-secret deployment variables supplied by the release workflow.

Weekly remittance advice is generated on read in the Worker with `pdf-lib`. That is an application dependency only: no D1 migration, no new secrets, and no new bindings.

## Manual release

1. Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, and `pnpm build`.
2. Apply migrations with `pnpm exec wrangler d1 migrations apply cleantrack-timesheet --remote --config wrangler.jsonc`. This release includes `0002_week_approval.sql`. Deploy the Worker and that migration together. Existing weeks stay Open (no `week_approval` row, no backfill).
3. Deploy the generated Worker with `pnpm exec wrangler deploy --config dist/server/wrangler.json`, supplying the exact HTTPS `BETTER_AUTH_URL`, an empty or explicitly approved `AUTH_TRUSTED_ORIGINS`, and a safe `RELEASE_SHA` variable.
4. Verify `/api/health` reports D1 health and the expected release, then verify sign-up/sign-in, owner isolation, mutation origin checks, a rate override, and a weekly total using synthetic data only.

Rollback of weekly approval: leave the `week_approval` table in place. Do not `DROP` it without a backup. A Worker rollback that no longer writes the table is safe; existing Open weeks remain Open.

## Continuous delivery

The release workflow runs verification first, serializes production deployments from `main`, rebuilds before migration, applies D1 migrations, deploys with the merge SHA as both the Worker version tag and application release marker, verifies the active Cloudflare version, and performs a cache-busted live health/header check.

The protected GitHub `production` environment contains only `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the non-secret `PRODUCTION_URL` variable. The Cloudflare token must be dedicated to this deployment and scoped to the resolved account's Workers Scripts and D1 edit permissions.
