# Deployment

## Production resources

- Worker: `cleantrack-timesheet`
- D1 database: `cleantrack-timesheet` in Oceania, bound as `DB`
- Direct production origin: `https://cleantrack-timesheet.jeevan90wijerathna.workers.dev`, also stored as the `PRODUCTION_URL` variable in the protected GitHub `production` environment

`BETTER_AUTH_SECRET` is a Worker runtime secret. Keep it in Cloudflare and never copy it into GitHub. `BETTER_AUTH_URL`, `AUTH_TRUSTED_ORIGINS`, and `RELEASE_SHA` are non-secret deployment variables supplied by the release workflow.

Weekly remittance advice is generated on read in the Worker with `pdf-lib`. Remittance itself adds no D1 migration, secrets, or bindings. Weekly approval still requires `0002_week_approval.sql`. Recurring assignment schedules require `0003_recurring_schedules.sql` in this release.

## Manual release

1. Run `pnpm install --frozen-lockfile` and `pnpm verify`.
2. Apply migrations with `pnpm exec wrangler d1 migrations apply cleantrack-timesheet --remote --config wrangler.jsonc`. This release includes `0003_recurring_schedules.sql` (and still requires `0002_week_approval.sql`). Deploy the Worker and `0003` together. Existing `time_entry` rows stay `occurrence_kind = manual` with `schedule_version_id` NULL; there is no pay backfill.
3. Deploy the generated Worker with `pnpm exec wrangler deploy --config dist/server/wrangler.json`, supplying the exact HTTPS `BETTER_AUTH_URL`, an empty or explicitly approved `AUTH_TRUSTED_ORIGINS`, and a safe `RELEASE_SHA` variable.
4. Verify `/api/health` reports D1 health and the expected release, then verify sign-up/sign-in, owner isolation, mutation origin checks, a rate override, and a weekly total using synthetic data only.

Rollback of weekly approval: leave the `week_approval` table in place. Do not `DROP` it without a backup. A Worker rollback that no longer writes the table is safe; existing Open weeks remain Open.

Rollback of recurring schedules: leave the `assignment_schedule_version` table and the `time_entry.occurrence_kind` / `schedule_version_id` columns in place. Do not DROP them. A Worker that does not read the new columns remains compatible with extra nullable/defaulted fields. Restoring a pre-`0003` Worker that SELECTs unknown columns would fail; deploy schema and Worker together.

## Continuous delivery

The release workflow runs verification first, serializes production deployments from `main`, rebuilds before migration, applies D1 migrations, deploys with the merge SHA as both the Worker version tag and application release marker, verifies the active Cloudflare version, and performs a cache-busted live health/header check.

The protected GitHub `production` environment contains only `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the non-secret `PRODUCTION_URL` variable. The Cloudflare token must be dedicated to this deployment and scoped to the resolved account's Workers Scripts and D1 edit permissions.

## Preview

Pull requests run `.github/workflows/preview.yml`. Verification always runs. A preview Worker deploy runs only when every value below is present; otherwise the job exits successfully and prints this list.

Repository secrets (same account as production, scoped to the preview Worker and preview D1 only if you use a second token):

| Name | Where | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub repository secret | Workers Scripts edit and D1 edit |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub repository secret | Account for Wrangler |

Repository variables:

| Name | Where | Purpose |
| --- | --- | --- |
| `PREVIEW_D1_DATABASE_ID` | GitHub repository variable | D1 id for `cleantrack-timesheet-preview`. Never the production database id |
| `PREVIEW_URL` | GitHub repository variable | Exact HTTPS origin of the preview Worker, used as `BETTER_AUTH_URL` |

Cloudflare, not GitHub:

| Name | Where | Purpose |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Worker secret on `cleantrack-timesheet-preview` | Auth signing secret. Set with `wrangler secret put BETTER_AUTH_SECRET`. Do not copy it into GitHub or Cursor |

Create the preview database with `pnpm exec wrangler d1 create cleantrack-timesheet-preview`, put its id in `PREVIEW_D1_DATABASE_ID`, and set `PREVIEW_URL` to the workers.dev (or custom) origin before the first deploy. The workflow rewrites the built `dist/server/wrangler.json` to the preview name and database, applies migrations there, and deploys. It does not read or write the production D1 database.
