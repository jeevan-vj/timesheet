# Deployment

## Production resources

- Worker: `cleantrack-timesheet`
- D1 database: `cleantrack-timesheet` in Oceania, bound as `DB`
- Direct production origin: `https://cleantrack-timesheet.jeevan90wijerathna.workers.dev`, also stored as the `PRODUCTION_URL` variable in the protected GitHub `production` environment

`BETTER_AUTH_SECRET` is a Worker runtime secret. Keep it in Cloudflare and never copy it into GitHub. `BETTER_AUTH_URL`, `AUTH_TRUSTED_ORIGINS`, and `RELEASE_SHA` are non-secret deployment variables supplied by the release workflow.

## Manual release

1. Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, and `pnpm build`.
2. Apply migrations with `pnpm exec wrangler d1 migrations apply cleantrack-timesheet --remote --config wrangler.jsonc`.
3. Deploy the generated Worker with `pnpm exec wrangler deploy --config dist/server/wrangler.json`, supplying the exact HTTPS `BETTER_AUTH_URL`, an empty or explicitly approved `AUTH_TRUSTED_ORIGINS`, and a safe `RELEASE_SHA` variable.
4. Verify `/api/health` reports D1 health and the expected release, then verify sign-up/sign-in, owner isolation, mutation origin checks, a rate override, and a weekly total using synthetic data only.

## Continuous delivery

The release workflow runs verification first, serializes production deployments from `main`, rebuilds before migration, applies D1 migrations, deploys with the merge SHA as both the Worker version tag and application release marker, verifies the active Cloudflare version, and performs a cache-busted live health/header check.

The protected GitHub `production` environment contains only `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the non-secret `PRODUCTION_URL` variable. The Cloudflare token must be dedicated to this deployment and scoped to the resolved account's Workers Scripts and D1 edit permissions.
