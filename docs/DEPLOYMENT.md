# Deployment

## Production resources

- Worker: `cleantrack-timesheet`
- D1 database: `cleantrack-timesheet` in Oceania, bound as `DB`
- Direct production origin: `https://cleantrack-timesheet.jeevan90wijerathna.workers.dev`, also stored as the `PRODUCTION_URL` variable in the protected GitHub `production` environment

`BETTER_AUTH_SECRET` and `OPS_BOT_TOKEN` are Worker runtime secrets. Keep them in Cloudflare and never copy them into GitHub. `OPS_BOT_TOKEN` is required by `wrangler.jsonc`. Set it with `wrangler secret put OPS_BOT_TOKEN` on the target Worker before a deploy that includes this config. `BETTER_AUTH_URL`, `AUTH_TRUSTED_ORIGINS`, and `RELEASE_SHA` are non-secret deployment variables supplied by the release workflow.

`SENTRY_DSN` is an optional Worker secret. Set it with `wrangler secret put SENTRY_DSN` on production and preview. When it is unset, error capture is off and existing deploys succeed without it. Do not copy `SENTRY_DSN` into GitHub. `RELEASE_SHA` is the non-secret release marker on the unexpected-error log and on the optional capture event. Error capture adds no migration.

Weekly remittance advice is generated on read in the Worker with `pdf-lib`. Remittance itself adds no D1 migration, secrets, or bindings. Weekly approval still requires `0002_week_approval.sql`. Recurring assignment schedules require `0003_recurring_schedules.sql`. Business workspaces require `0004_business_workspace.sql`. The operator API requires `0005_ops_audit.sql` and the `OPS_BOT_TOKEN` secret. Contractor engagement profiles require `0006_contractor_engagement.sql`. Apply the migration with the Worker. Do not drop `ops_audit`. A Worker rollback that stops calling `/api/ops` can leave the table in place. Restoring an earlier D1 bookmark is Cloudflare Time Travel (`wrangler d1 time-travel info` / `restore`) from an operator workstation, not an agent session.

## Manual release

1. Run `pnpm install --frozen-lockfile` and `pnpm verify`.
2. Apply migrations with `pnpm exec wrangler d1 migrations apply cleantrack-timesheet --remote --config wrangler.jsonc`. This release includes `0004_business_workspace.sql`, `0005_ops_audit.sql`, and `0006_contractor_engagement.sql` (and still requires `0002_week_approval.sql` and `0003_recurring_schedules.sql`). Deploy the Worker and those migrations together. `0004` adds `business` and `business_member`, backfills one owner business per existing user (`biz_<user id>`, `mem_<user id>`), and sets `business_id` on existing domain rows. It does not rewrite `time_entry.rate_cents`, paid minutes, or week-approval status and timestamps. It aborts if an owner cannot be mapped deterministically, if a user name or email is blank, or if any domain `business_id` would stay null. After it commits, inserts and updates that omit `business_id` fail with `business_required`. `0005` adds append-only `ops_audit` and does not rewrite payroll rows. Set `OPS_BOT_TOKEN` before deploying the Worker that requires it. `0006` adds contractor engagement columns and backfills `engagement_status` from the existing `active` flag (`1` to `active`, `0` to `archived`). It does not rewrite `time_entry.rate_cents`, paid minutes, or week approvals. The release workflow applies this migration before the new Worker is serving. A pre-0006 archive or restore sets only `active`. The align trigger rewrites `engagement_status` to `archived` or `active` for that write, so the request commits and the row stays consistent. A writer that sets `engagement_status` to a value that disagrees with `active` still fails with `engagement_active_mismatch`. An unknown status fails with `invalid_engagement_status`.
3. Deploy the generated Worker with `pnpm exec wrangler deploy --config dist/server/wrangler.json`, supplying the exact HTTPS `BETTER_AUTH_URL`, an empty or explicitly approved `AUTH_TRUSTED_ORIGINS`, and a safe `RELEASE_SHA` variable.
4. Verify `/api/health` reports D1 health and the expected release, then verify sign-up/sign-in, owner isolation, mutation origin checks, a rate override, and a weekly total using synthetic data only.

Rollback of weekly approval: leave the `week_approval` table in place. Do not `DROP` it without a backup. A Worker rollback that no longer writes the table is safe; existing Open weeks remain Open.

Rollback of recurring schedules: leave the `assignment_schedule_version` table and the `time_entry.occurrence_kind` / `schedule_version_id` columns in place. Do not DROP them. A Worker that does not read the new columns remains compatible with extra nullable/defaulted fields. Restoring a pre-`0003` Worker that SELECTs unknown columns would fail; deploy schema and Worker together.

Rollback of business workspaces: do not drop `business`, `business_member`, `business_backfill_guard`, the `business_id` columns, or the `business_required` triggers. Do not roll a pre-`0004` Worker back onto a database that has this migration. Old inserts omit `business_id` and the triggers abort them. Extra columns are ignored by an old `SELECT`, but the triggers make that rollback unsafe. Forward-fix instead.

Rollback of contractor engagement: do not drop the `0006` columns or the engagement triggers. A pre-0006 Worker can still archive and restore after this migration, because an update that changes only `active` is aligned to `engagement_status`. New columns have defaults, and the old Worker does not select them. Prefer deploying the Worker that writes `engagement_status` in the same release. Forward-fix a bad status rather than dropping the columns.

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
| `SENTRY_DSN` | Optional Worker secret on `cleantrack-timesheet-preview` | Error capture. Set with `wrangler secret put SENTRY_DSN`. Unset means capture is off. Do not copy it into GitHub |

Create the preview database with `pnpm exec wrangler d1 create cleantrack-timesheet-preview`, put its id in `PREVIEW_D1_DATABASE_ID`, and set `PREVIEW_URL` to the workers.dev (or custom) origin before the first deploy. The workflow rewrites the built `dist/server/wrangler.json` to the preview name and database, applies migrations there, and deploys. It does not read or write the production D1 database.
