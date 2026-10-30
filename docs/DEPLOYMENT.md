# Deployment

## Production resources

- Worker: `cleantrack-timesheet`
- D1 database: `cleantrack-timesheet` in Oceania, bound as `DB`
- Direct production origin: `https://cleantrack-timesheet.jeevan90wijerathna.workers.dev`, also stored as the `PRODUCTION_URL` variable in the protected GitHub `production` environment

`BETTER_AUTH_SECRET` and `OPS_BOT_TOKEN` are Worker runtime secrets. Keep them in Cloudflare and never copy them into GitHub. `OPS_BOT_TOKEN` is required by `wrangler.jsonc`. Set it with `wrangler secret put OPS_BOT_TOKEN` on the target Worker before a deploy that includes this config. `BETTER_AUTH_URL`, `AUTH_TRUSTED_ORIGINS`, and `RELEASE_SHA` are non-secret deployment variables supplied by the release workflow.

`SENTRY_DSN` is an optional Worker secret. Set it with `wrangler secret put SENTRY_DSN` on production and preview. When it is unset, error capture is off and existing deploys succeed without it. Do not copy `SENTRY_DSN` into GitHub. `RELEASE_SHA` is the non-secret release marker on the unexpected-error log and on the optional capture event. Error capture adds no migration.

`EMAIL_FROM` is the non-secret sender in `wrangler.jsonc` `vars`: `CleanTrack <invites@jnok.co.nz>`. Preview inherits it through `scripts/prepare-preview-wrangler.mjs`. No DNS changes are needed. The root domain `jnok.co.nz` is already verified in Resend, with sending enabled and tracking off. Do not add a `mail.jnok.co.nz` subdomain.

`RESEND_API_KEY` is an optional Worker secret and is not listed in `wrangler.jsonc` `secrets.required`. Use a sending-only Resend API key restricted to `jnok.co.nz`. The sender address is `invites@jnok.co.nz`. Store the key as a GitHub environment secret named `RESEND_API_KEY` on the protected `production` environment (Settings > Environments > production > Environment secrets). The release deploy step is the only workflow step that reads it. When the value is non-empty, that step writes a JSON object whose only field is `RESEND_API_KEY` to a file under `$RUNNER_TEMP` with umask `077` and mode `0600`, then passes the file on the same `wrangler deploy --secrets-file` command that tags the version with `GITHUB_SHA`. Wrangler `4.127.0` uploads that secret on the tagged version and keeps Worker secrets omitted from the file. The step deletes the temp file on exit and does not print the key. When the GitHub secret is empty or unset, the step logs `RESEND_API_KEY is unset; continuing without provisioning the Worker secret.` and runs the same deploy arguments as a release that does not provision this secret. When the Worker secret is absent, invitation email is skipped and the owner gets a one-time copy link. Local development leaves the key blank in `.dev.vars`. Wrangler only binds `.dev.vars` entries that are already `vars` or listed in `secrets.required`, so a local value for this key is not injected and local invites stay on the copy-link fallback unless `MAIL_TRANSPORT=smtp-dev` is set as described in `docs/DEVELOPMENT.md`. Do not commit the key. Do not add the name to `wrangler.jsonc`. `MAIL_TRANSPORT` in `vars` stays `""`. Do not set it to `smtp-dev` on a deployed Worker. A production runtime refuses that transport even if the var is present.

Weekly remittance advice is generated on read in the Worker with `pdf-lib`. Remittance itself adds no D1 migration, secrets, or bindings. Weekly approval still requires `0002_week_approval.sql`. Recurring assignment schedules require `0003_recurring_schedules.sql`. Business workspaces require `0004_business_workspace.sql`. The operator API requires `0005_ops_audit.sql` and the `OPS_BOT_TOKEN` secret. Contractor engagement profiles require `0006_contractor_engagement.sql`. Contractor invitations require `0007_contractor_portal_access.sql`. Native sign-in on Better Auth 1.7.13 requires `0008_account_provider_key.sql`. That migration rebuilds `account` so `issuer` stays nullable with default `local:credential`, drops `account_issuer_account_id_uq`, copies every existing row unchanged, and adds a unique index on `(provider_id, account_id)`. It does not rewrite sessions, password hashes, or `time_entry`. A duplicate `(provider_id, account_id)` aborts it. Rollback to the previous Worker remains safe because `issuer` is still present. Dropping the column is a later cleanup. Deploy the migration with the Worker that runs 1.7.13. `cleantrack://` is trusted in code. Do not put `exp://` or app schemes into `AUTH_TRUSTED_ORIGINS`. Apply the migration with the Worker. Do not drop `ops_audit`. A Worker rollback that stops calling `/api/ops` can leave the table in place. Restoring an earlier D1 bookmark is Cloudflare Time Travel (`wrangler d1 time-travel info` / `restore`) from an operator workstation, not an agent session.

Owner mobile status changes require additive migration `0009_owner_time_entry_audit.sql`. It adds an append-only audit table, does not backfill or rewrite `time_entry`, and requires no new secret or binding. A Worker rollback may leave the unused table in place; restoring data uses the D1 Time Travel bookmark recorded by the release workflow.

## Manual release

1. Run `pnpm install --frozen-lockfile` and `pnpm verify`.
2. Apply migrations with `pnpm exec wrangler d1 migrations apply cleantrack-timesheet --remote --config wrangler.jsonc`. This release includes `0004_business_workspace.sql`, `0005_ops_audit.sql`, `0006_contractor_engagement.sql`, `0007_contractor_portal_access.sql`, and `0008_account_provider_key.sql` (and still requires `0002_week_approval.sql` and `0003_recurring_schedules.sql`). Deploy the Worker and those migrations together. `0004` adds `business` and `business_member`, backfills one owner business per existing user (`biz_<user id>`, `mem_<user id>`), and sets `business_id` on existing domain rows. It does not rewrite `time_entry.rate_cents`, paid minutes, or week-approval status and timestamps. It aborts if an owner cannot be mapped deterministically, if a user name or email is blank, or if any domain `business_id` would stay null. After it commits, inserts and updates that omit `business_id` fail with `business_required`. `0005` adds append-only `ops_audit` and does not rewrite payroll rows. Set `OPS_BOT_TOKEN` before deploying the Worker that requires it. `0006` adds contractor engagement columns and backfills `engagement_status` from the existing `active` flag (`1` to `active`, `0` to `archived`). It does not rewrite `time_entry.rate_cents`, paid minutes, or week approvals. The release workflow applies this migration before the new Worker is serving. A pre-0006 archive or restore sets only `active`. The align trigger rewrites `engagement_status` to `archived` or `active` for that write, so the request commits and the row stays consistent. A writer that sets `engagement_status` to a value that disagrees with `active` still fails with `engagement_active_mismatch`. An unknown status fails with `invalid_engagement_status`. `0007` adds `contractor_invitation` and `contractor_account`, stores only the SHA-256 digest of an invite token, and does not backfill rows or rewrite `time_entry`.
`0009_owner_time_entry_audit.sql` is included in this release. Apply it with the Worker; it is additive, performs no backfill, and leaves historical rates and paid minutes unchanged.

3. Deploy the generated Worker with `pnpm exec wrangler deploy --config dist/server/wrangler.json`, supplying the exact HTTPS `BETTER_AUTH_URL`, an empty or explicitly approved `AUTH_TRUSTED_ORIGINS`, and a safe `RELEASE_SHA` variable.
4. Verify `/api/health` reports D1 health and the expected release, then verify sign-up/sign-in, owner isolation, mutation origin checks, a rate override, and a weekly total using synthetic data only.

Rollback of weekly approval: leave the `week_approval` table in place. Do not `DROP` it without a backup. A Worker rollback that no longer writes the table is safe; existing Open weeks remain Open.

Rollback of recurring schedules: leave the `assignment_schedule_version` table and the `time_entry.occurrence_kind` / `schedule_version_id` columns in place. Do not DROP them. A Worker that does not read the new columns remains compatible with extra nullable/defaulted fields. Restoring a pre-`0003` Worker that SELECTs unknown columns would fail; deploy schema and Worker together.

Rollback of business workspaces: do not drop `business`, `business_member`, `business_backfill_guard`, the `business_id` columns, or the `business_required` triggers. Do not roll a pre-`0004` Worker back onto a database that has this migration. Old inserts omit `business_id` and the triggers abort them. Extra columns are ignored by an old `SELECT`, but the triggers make that rollback unsafe. Forward-fix instead.

Rollback of contractor engagement: do not drop the `0006` columns or the engagement triggers. A pre-0006 Worker can still archive and restore after this migration, because an update that changes only `active` is aligned to `engagement_status`. New columns have defaults, and the old Worker does not select them. Prefer deploying the Worker that writes `engagement_status` in the same release. Forward-fix a bad status rather than dropping the columns.

Rollback of the account provider key: the previous Worker can still sign in. `0008` leaves `issuer` in place, nullable, with default `local:credential`, and does not rewrite existing issuer values, password hashes, `time_entry`, rates, or week approvals. Dropping `issuer` is a later cleanup, after no Worker still reads it. Do not put the `NOT NULL` constraint back while the current Worker is serving: Better Auth 1.7.13 sign-up does not write the column, and a required column with no write would reject sign-up. Invitation acceptance writes `local:credential` on the credential row.

Rollback of contractor invitations: do not drop `contractor_invitation`, `contractor_account`, or the email-change trigger. `0007` does not rewrite `time_entry`, rates, or week approvals, and it does not backfill rows. Deploy the migration and the Worker that reads those tables together. A pre-0007 Worker does not select the new tables. Forward-fix a bad invitation rather than dropping the tables. Leave the Worker secret unset and owners can still copy the invite link. See the provisioning section above.

## Continuous delivery

The release workflow runs verification first and serializes production deployments from `main`. Before `wrangler d1 migrations apply`, it records a D1 Time Travel bookmark (`wrangler d1 time-travel info cleantrack-timesheet --json`) and the Worker version currently at 100% traffic. Both values are written to the job summary and to the artifact `d1-recovery-<git sha>` (kept 30 days, the same window D1 will accept that bookmark). It then refuses the release when a pending migration contains `DROP TABLE`, `DROP COLUMN`, `DROP INDEX`, `TRUNCATE`, `DELETE FROM` without a `WHERE` clause, or a table rebuild, unless that migration is explicitly approved. A table rebuild is a script that creates a `*_new` or `__new_*` table, copies rows with `INSERT ... SELECT`, drops the original table, and renames the copy. `0008_account_provider_key.sql` matches that pattern. It is not pre-approved. If it is still pending on production, add its basename to `.github/migration-destructive-ok.txt` or label the merged pull request `migration-destructive-ok` before the next release.

Approve a destructive migration in one of these ways:

- Prefer a per-file opt-in: add the basename, one file per line, to `.github/migration-destructive-ok.txt` in the same change. This is the durable record and it names the migration.
- Add the `migration-destructive-ok` label to the pull request. The deploy job reads labels with `GET /repos/{owner}/{repo}/commits/{sha}/pulls`. That label opts in every pending destructive migration in that release, not one file. Use the marker file when only some of the pending migrations should be approved.
- Put a trailer on the merge commit, once per file: `Migration-Destructive-Ok: 0009_example.sql`.

The workflow then applies D1 migrations and deploys with the merge SHA as both the Worker version tag and the `RELEASE_SHA` variable. It verifies the active Cloudflare version tag and runs the production smoke script. The smoke checks are read-only: `/api/health`, signed-out `GET /api/me` (401), `POST /api/sites` with a dummy cookie and an untrusted `Origin` (403, before any write), the home page title, and the deployed version tag equal to the SHA. If the identity check or the smoke test fails, the job runs `wrangler rollback <pre-deploy version id> --yes` and exits non-zero. The failure log prints the bookmark. It does not run `wrangler d1 time-travel restore`. Restore D1 by hand from an operator workstation only when you mean to move the database back:

```
pnpm exec wrangler d1 time-travel restore cleantrack-timesheet --bookmark=<bookmark>
```

The protected GitHub `production` environment contains `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, the optional `RESEND_API_KEY` secret, and the non-secret `PRODUCTION_URL` variable. The Cloudflare token must be dedicated to this deployment and scoped to the resolved account's Workers Scripts and D1 edit permissions. Keep `RESEND_API_KEY` on the production environment rather than as a repository secret, and leave it unset until the sending-only key exists. The release still succeeds when it is unset. The tagged `wrangler deploy --secrets-file` above is how the key reaches the Worker.

## Preview

Pull requests run `.github/workflows/preview.yml`. Verification always runs. The `deploy-preview` job runs only when every value below is present. When one is missing, that job is skipped, `preview-config` writes the missing names to the job summary, and the check is not a successful deploy. When the values are present and the deploy fails, `deploy-preview` fails. Preview Workers should not carry `RESEND_API_KEY`. `preview.yml` does not read it, and the production release is the workflow that can pass it.

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

## Mobile OTA (EAS Update)

CleanTrack iOS/Android JavaScript updates use EAS Update from `apps/mobile`. See [`apps/mobile/README.md`](../apps/mobile/README.md) for channels, publish scripts, OTA-safe vs native changes, rollback, and the GitHub Actions production workflow. Do not publish an update or start a build without explicit approval. Builds that predate `expo-updates` cannot receive OTA; ship a new production build after the Update setup merges.

## Mobile production (GitHub Actions)

`.github/workflows/mobile-release.yml` releases iOS from `main`. It does not deploy the web Worker. A push that changes `apps/mobile/**`, `packages/core/**`, `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`, or that workflow runs it. `workflow_dispatch` on `main` takes `auto`, `force-build`, or `force-update`.

The decide job does not use a protected environment. It first reads `GET /repos/jeevan-vj/timesheet/environments/mobile-production` and stops unless that environment has a required reviewer. That job's token has `contents: read` and `actions: read`. GitHub App tokens need `actions: read` for this endpoint; `contents: read` alone returns 403. Publish and build keep the workflow default, `contents: read` only. It then computes the iOS fingerprint with `APP_VARIANT=production`, computes it again with the production EAS environment (the same environment `update:production` loads), and lists production store builds with `eas build:list --fingerprint-hash`. `apps/mobile/fingerprint.config.js` supplies the same `extraSources` and generated `ios`/`android` ignores to that command, to `eas build`, and to the EAS worker. If those two fingerprints differ, it stops and neither publishes nor builds, including `force-update`. A build with a missing, empty, whitespace, unknown, or non-matching hash is not a match. An `unknown` fingerprint does not fall through to the runtime version. `auto` publishes `pnpm -F mobile update:production` when a finished, in-progress, in-queue, or new build already has the fingerprint, including when the EAS artifact has expired. The publish job recomputes that fingerprint and refuses to publish if it is not the approved hash. Otherwise the workflow runs `eas build --platform ios --profile production --auto-submit --freeze-credentials`. The decision is written to the decide job summary before approval.

The publish and build jobs run in the GitHub environment `mobile-production`. They check out the commit the decide job recorded. They do not start when the environment is missing or has no required reviewer, because the decide job fails first.

One-time setup, required before a release can succeed:

1. Settings → Environments → create `mobile-production`. Add Jeevan as a required reviewer and save the protection rule. The workflow checks this through the environments API and stops when the reviewer is absent.
2. Create an Expo Viewer robot for `@jnok/cleantrack`. Store its token as the repository secret `EXPO_TOKEN_READ`. Only the decide job reads it, for `eas env:exec` and `eas build:list`. If EAS rejects that read, decide stops. It does not fall back to the publish token.
3. Create an Expo robot that can build, submit, and publish updates. Store its token as the environment secret `EXPO_TOKEN` on `mobile-production` only. Do not create a repository secret named `EXPO_TOKEN`. Delete one if it was added for an earlier revision of this workflow. The workflow does not print either token.
4. The EAS `production` environment must exist. `update:production` already passes `--environment production`.
5. iOS production credentials and App Store Connect app `6827417051` must already be on EAS. `--freeze-credentials` makes a missing certificate fail the job instead of creating a new one.

`eas.json` keeps `cli.appVersionSource` of `remote` and `build.production.autoIncrement` of `true`. The workflow does not set a build number. Production builds still run `apps/mobile/scripts/check-release.mjs` on the EAS builder. The checkout uses `persist-credentials: false`, so the uploaded archive does not contain a GitHub token. This repository is public, and that script fetches `origin/main`.

Roll back an OTA with `eas update:republish --group <previous-update-group-id>` or `eas update:roll-back-to-embedded --channel production`. See `apps/mobile/README.md` for the full commands. An OTA rollback does not remove a TestFlight build. Android is not built by this workflow. The build job waits up to 180 minutes; if Actions stops the job, check the Expo dashboard before starting another build, because the remote build may still be running.

