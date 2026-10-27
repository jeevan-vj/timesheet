# Architecture

## Product slice

`owner membership -> business -> contractors + sites -> assignments (+ optional schedule versions) -> daily time entries -> weekly summary`

The active business is the session user's single active `business_member` row with `role = owner`. Phase 1 does not offer a business switcher. The table allows more than one membership row; a partial unique index on `business_member(user_id) WHERE active = 1` allows only one active membership. Domain reads and writes keep the session `owner_user_id` predicate and add `business_id` from that membership. Clients do not send either id.

`POST /api/business` inserts `biz_<user id>` and `mem_<user id>` and leaves `onboarding_completed_at` null. A second POST, including after a unique-key race, returns the stored profile and does not overwrite it. If the business row exists and the membership does not, the handler inserts only the membership. `POST /api/business/onboarding/complete` sets the completion timestamp once.

`GET /api/dashboard` adds `business: null` or the profile resource. With no membership the week payload is empty and `approval.status` is `open`. Collection list routes used by the dashboard return their existing empty `200` bodies. Other domain mutations return `409 business_required` and write nothing. Item reads stay `404 not_found`. Unexpected JSON API failures return `500 internal_error` with a server correlation id.

Migration `0004_business_workspace.sql` creates those tables, backfills one completed business per existing user, and sets `business_id` from that user's single active owner membership. A scalar subquery that matches more than one membership aborts. A guard table then rejects blank user names or emails, a user whose active membership count is not 1, owner mismatches between an assignment and its site or contractor, a schedule version whose owner differs from its assignment, a time entry whose owner differs from its site or contractor, or a null `business_id`. Triggers then abort inserts and updates that would store a null `business_id`. The migration does not assign `rate_cents`, `paid_minutes`, approval status, or approval timestamps. `owner_user_id` columns and the existing unique indexes stay.

An assignment connects a contractor to a site and may provide a rate override. Assignment CRUD is owner-scoped: list and get return active and archived rows joined to the same-owner contractor and site; create inserts or reuses the unique pair; PATCH updates only `rateCents`; DELETE archives (`active=false`); restore reactivates when both relations are still active. Unassign confirmation is a UI concern; the API archives in one owner-scoped DELETE and does not delete history.

The owner/contractor/site unique index is reused rather than inserting duplicates. An archived pair restored by POST create applies the submitted rate; restore-by-id does not change `rateCents`. A second active create returns `duplicate_assignment` only when both related entities are still active; otherwise create returns `not_found`.

When a time entry is created, the service resolves the active assignment (inner-joining an active owned contractor and site), snapshots the effective rate onto that new entry only, calculates paid minutes, and stores both. Weekly summaries aggregate immutable entry snapshots. Changing an assignment override later never rewrites `time_entry.rate_cents`.

Paid-hours entries store integer paid minutes directly. Clock columns remain required, so those rows use a same-day window equal to the paid duration (`00:00` plus paid minutes, no break) and `entry_mode = paid_hours` so the UI does not treat them as clock times. Start-and-finish entries keep `entry_mode = clock`. Create and update both persist those paid-hours sentinels.

The owner can assign a contractor to another site in the same create-entry request (`assignSite`). That inline path creates a missing assignment or restores an archived pair (applying `assignSite.rateCents`), and does not rewrite an already-active override. Shift validation and the duplicate contractor/site/date check run before the assignment write so a failed entry does not leave a restored assignment. Inline assign-another-site remains create-only. Dashboard new-entry options include only assignments whose contractor and site are both active and owned (inner joins); archived assignments and inactive relations are omitted from that list.

The weekly dashboard GET remains the collection read for time entries: Monday–Sunday, owner-scoped joins to contractors and sites, ordered by work date then contractor name. There is no separate collection GET for time entries. The same response includes `approval: { status, approvedAt, reopenedAt }` without `id` or `ownerUserId`. Missing `week_approval` rows map to `{ status: "open", approvedAt: null, reopenedAt: null }`. Dashboard assignments are `{ id, contractorId, siteId, rateCents, schedule }` where `schedule` is the current open version (`{ id, weekdays, paidMinutes, effectiveFrom }`) or `null`. Entries include `occurrenceKind` and `scheduleVersionId`; `entryMode` may be `absent`. GET dashboard, GET entry, and GET schedule never insert or update `time_entry` or `assignment_schedule_version`.

Pay, remittance, and week-approval totals read only `time_entry`. `summarizeWeek` always adds `paidMinutes` and calls `calculateEntryPayCents` only when `paidMinutes > 0`, so 0-minute absence rows do not throw. The dashboard also derives a site rollup and a copyable week brief from that same payload in the browser (`summarizeWeekBySite` / `formatWeekBrief`). Those views do not add a route, a table, or a second pay formula, and approval still compare-and-sets the contractor summary. `occurrence_kind` is `manual` (owner-entered, the default after migration `0003`), `scheduled` (apply-schedule), `absent` (scheduled day marked absent, `paid_minutes = 0`), or `hours_override` (scheduled day with different paid minutes). Apply-schedule copies the current assignment effective rate onto new rows only and never rewrites historical `rate_cents`.

POST `/api/weeks/apply-schedule` materializes scheduled rows for the requested Monday week from each active owned assignment's open version. It is idempotent: existing owner/contractor/site/date rows are skipped, approved dates are skipped, and archived assignments are omitted by an `assignment.active = true` inner join with active owned contractor and site. Apply does not throw `week_locked` when some or all dates are skipped.

PUT `/api/assignments/:id/schedule` creates or replaces (going-forward) an open version and then applies the submitted week. Going-forward rewrites unlocked unexcepted `scheduled` rows from that Monday (paid minutes, paid-hours sentinels, `schedule_version_id`) and does not touch `rate_cents`, absences, overrides, manuals, or approved weeks. DELETE closes the open version and leaves time entries in place. POST `/api/time-entries/:id/exception` writes one-day absences and hours overrides without mutating versions; hours-override going-forward opens a new version.

`week_approval` is unique on `(owner_user_id, week_start)` and stores only status plus `approved_at` / `reopened_at`. It is not a pay copy. Current week totals are computed at approve time from owner-scoped `time_entry` rows in `[weekStart, weekEnd]` and compared to the submitted expected minutes and cents. Approve and reopen never rewrite `time_entry.rate_cents`.

Time-entry create, update, and delete call `assertUnlockedWeek` so an approved week cannot be changed. Date-move checks both the existing work date’s week and the target week. Create checks the lock after `invalid_shift` validation and before inline `assignSite`, so a locked week does not restore or create an assignment.

An owner inspects one recorded shift with GET `/api/time-entries/:id`, which returns the dashboard-entry-shaped row (including contractor and site display names) after owner-scoped inner joins. PATCH `/api/time-entries/:id` updates contractor, site, date, entry mode, duration/clock, break, and notes. If contractor and site are unchanged, the original `rate_cents` snapshot is kept. If contractor or site changes, the service requires an active same-owner assignment and snapshots that assignment's effective rate as a reclassification.

## Contractor lifecycle

A contractor row stays in place for the owner's history. Archive sets `engagement_status='archived'` and `active=false` on the contractor, and sets `active=false` on all of that owner's assignments for the contractor. Restore sets `engagement_status='active'` and `active=true` on the same contractor row first, then reactivates those assignments. Neither inserts a new contractor. Both writes are issued in one Drizzle D1 `batch` so they share a single round trip. D1 batch is not rollback-atomic; retry remains safe because the operations are idempotent. Both never write `time_entry`.

`engagement_status` is the lifecycle source of truth: `draft`, `invited`, `active`, `suspended`, or `archived`. `active` is true only for `invited` and `active`, which is what assignment, schedule, and dashboard selects already require. `draft`, `suspended`, and `archived` therefore cannot be newly assigned. Saving `archived` deactivates assignments; saving `invited` or `active` from `archived` reactivates them; saving `draft` or `suspended` does not change assignments. Migration `0006_contractor_engagement.sql` backfills `active` rows to `active` and inactive rows to `archived`. Triggers reject an unknown status. A status change that disagrees with `active` fails. A write that changes only `active` is aligned to `active` or `archived`, so a pre-0006 Worker archive or restore still commits. The migration does not rewrite `time_entry`. Portal access is allowed only for `invited` and `active` (`contractorMayHoldPortalAccess`). Invitation create and resend enforce that predicate. Week, sites, and payment portal routes are not built yet.

## Viewer and invitations

`GET /api/me` calls `resolveViewer`. The owner half is the active owner membership and its business. The contractor half is active `contractor_account` rows for the session user, joined to `business` for the display name. Contractor links are not `business_member` rows, so the one-active-membership index still allows a person to own one business and work at others. Until an invitation is accepted, `contractorOf` is empty. `/dashboard` sends a contractor-only user to the `/portal` placeholder. Sign-in and sign-up keep a same-origin `returnTo` of `/invite`, `/portal`, or `/dashboard`.

Migration `0007_contractor_portal_access.sql` adds `contractor_invitation` and `contractor_account`. Nothing is backfilled. Tokens are stored as hex SHA-256 digests. The deliverable link puts the token in the URL fragment. Create and resend write the row before calling Resend. `last_delivery` records `email`, `link_only`, or `email_failed`. A pending invite is revoked by a trigger when `contractor.email` changes to a different address. The sender is `CleanTrack <invites@jnok.co.nz>`. How the optional Worker secret is provisioned is in `docs/DEPLOYMENT.md`. `MAIL_TRANSPORT=smtp-dev` is a local loopback SMTP transport and is refused when `NODE_ENV` is `production`.

Accepting an invitation writes `user`, `account`, `contractor_account`, the invitation status, the contractor engagement status, and `session` from `POST /api/invitations/accept`. The statements share one D1 `batch`. D1 batch is not rollback-atomic, so each statement is conditional on the invite still being the pending row that was read, and a retry is safe. The page keeps the token in the fragment and in `sessionStorage` for the sign-in return trip. It is not placed on a server URL.

Invitation routes:

| Method | Path | Cookie mutation | Success |
| --- | --- | --- | --- |
| GET | `/api/me` | no | `200 { owner, contractorOf }` |
| GET | `/api/contractors/[id]/invitation` | no | `200` state, `expiresAt`, `sendCount`, `lastDelivery` |
| POST | `/api/contractors/[id]/invitation` | yes | `201 { invitation, delivery, inviteLink }` |
| POST | `/api/contractors/[id]/invitation/resend` | yes | `200 { invitation, delivery, inviteLink }` |
| POST | `/api/contractors/[id]/invitation/revoke` | yes | `200 { invitation }` |
| POST | `/api/invitations/preview` | public, trusted Origin | `200` ready or closed state |
| POST | `/api/invitations/accept` | public, trusted Origin | `200 { ok: true }` and session cookie |

The unique index `contractor_owner_name_uq` on `(owner_user_id, name)` includes archived rows. A same-owner create or rename that collides, including with an archived name, returns `409 { error: "duplicate_contractor" }`. Different owners may share names. Cross-owner get, update, archive, and restore return identical `404 { error: "not_found" }` with no writes.

`GET /api/dashboard` contractor and site selects remain limited to `active=true` rows, which for contractors means engagement status `invited` or `active`. The assignment query returns only active assignments whose contractor and site are also `active=true`. Time-entry joins still load contractors and sites without an active filter so historical weeks keep names and snapshotted pay. Creating an assignment or time entry still requires an active contractor and site; a draft, suspended, or archived contractor is `not_found`.

### Contractor HTTP contract

`ContractorResource` omits `ownerUserId` and serializes timestamps as JSON dates:

`{ id, name, email, phone, defaultRateCents, currency: "NZD", active, preferredName, startDate, engagementStatus, gstRegistered, gstNumber, internalNotes, emergencyContactName, emergencyContactPhone, createdAt, updatedAt }`

`active` is derived from `engagementStatus` and is still returned. Omitted engagement fields on PATCH are left unchanged. Omitted engagement fields on POST default to an empty profile, `engagementStatus: "active"`, and `active: true`.

| Method | Path | Cookie mutation | Success |
| --- | --- | --- | --- |
| GET | `/api/contractors` | no | `200 { contractors: ContractorResource[] }` name asc; `includeArchived` omit/false/0 = every status except `archived`, true/1 = all statuses |
| POST | `/api/contractors` | yes | `201 ContractorResource` |
| GET | `/api/contractors/[id]` | no | `200 ContractorResource` (archived readable by owner) |
| PATCH | `/api/contractors/[id]` | yes | `200 ContractorResource` |
| POST | `/api/contractors/[id]/archive` | yes | `200 ContractorResource` `active: false`, `engagementStatus: "archived"` |
| POST | `/api/contractors/[id]/restore` | yes | `200 ContractorResource` `active: true`, `engagementStatus: "active"` |
| GET | `/api/contractors/[id]/remittance` | no | `200` PDF (`?week=YYYY-MM-DD` Monday) |

There is no DELETE on contractors. Cookie-authenticated mutations use `authorize(request, true)`. Errors: `401 unauthorized`, `403 forbidden`, `404 not_found`, `409 duplicate_contractor`, `413 payload_too_large`, `400 invalid_request` (optional `fields` on create/patch Zod failures only), `500 internal_error` (correlation id) for unexpected failures.

`GET /api/contractors/[id]/remittance?week=YYYY-MM-DD` is a cookie read (`authorize(request)` without mutation CSRF). Ownership comes from the session. The handler loads the contractor with `id` plus `owner_user_id`, then that owner's time entries for the Monday–Sunday week, inner-joining contractor and site by id and owner only (no `active` filter). The PDF is generated on read with `pdf-lib`; nothing is stored. Success headers: `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="remittance-<slug>-<weekEnd>.pdf"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Empty weeks return `400 { error: "no_entries" }` JSON, not a PDF. Cross-owner ids return `404 { error: "not_found" }`. Approved weeks stay readable: remittance does not call `assertUnlockedWeek`.

## Runtime

The vinext App Router runs as a Cloudflare Worker. D1 is accessed through the `DB` binding with Drizzle. Better Auth stores users and sessions in the same D1 database. The browser calls same-origin route handlers; route handlers validate input and invoke owner-scoped services.

A native client uses the same routes. Better Auth's Expo server plugin stores the session cookie for the app's secure storage and trusts the `cleantrack://` scheme. `cleantrack-preview://` is trusted only when `BETTER_AUTH_URL` is exactly `https://cleantrack-timesheet-preview.jeevan90wijerathna.workers.dev`, and also on loopback HTTP. `exp://` patterns are trusted only for loopback HTTP and are not production variables. Cookie mutations that omit `Origin` must send `X-CleanTrack-Client: mobile/<version>`. `GET /api/me` remains the signed-in role read for that cookie. There is no second role endpoint.

Better Auth 1.7.13 identifies an account by `provider_id` and `account_id`. Migration `0008_account_provider_key.sql` keeps `issuer`, makes it nullable with default `local:credential`, drops the old issuer unique index, copies existing rows unchanged, and adds a unique index on `(provider_id, account_id)`. The Drizzle schema maps `issuer` as an optional column with default `local:credential`, which is the value invitation acceptance writes. Better Auth sign-up omits the column, so SQLite applies that default. The password hash stays on the row. The migration does not rewrite `time_entry`. Dropping the column is a later cleanup.

Site APIs are `GET/POST /api/sites`, `GET/PATCH/DELETE /api/sites/[id]`, and `POST /api/sites/[id]/restore`. Collection GET is a read (`authorize(request)`) and defaults to the owner's active sites; `?includeArchived=1` includes archived rows. Cookie-authenticated site mutations require a trusted Origin, or `X-CleanTrack-Client: mobile/<version>` when Origin is absent. Duplicate names map to `duplicate_site` (409). DELETE archives; it never issues `DELETE FROM site` and never updates `time_entry` rows. Archive and restore update the site and that site's owner-scoped assignments together through D1/Drizzle `batch`.

The dashboard continues to load only `sites.active = true` and `assignments.active = true` for pickers. The weekly time-entry join matches sites by id and owner only, so archived site names still render on historical rows while pay snapshots stay on the entry.

## Operator API

`/api/ops/*` is served by the same Worker and uses the `DB` binding. Authentication is `Authorization: Bearer` compared to the `OPS_BOT_TOKEN` secret. Cookie sessions are not accepted. Optional Cloudflare Access may proxy the path; the Worker still checks the bearer token.

Contractor and time-entry writes, and wage reads, take `ownerUserId` and resolve `business_id` from that user's active owner membership. Wage JSON is `summarizeWeek`, `summarizeWeekBySite`, and `weekPayrollTotals` on the snapshotted entry rows. Contractor archive and restore execute `archiveWritePlan` / `restoreWritePlan` (assignment active flag, then contractor, or the reverse). Named contractor responses and undo snapshots include `engagementStatus` and omit GST number, internal notes, and emergency contact. Undo of archive or restore writes the saved prior status. It refuses with `stale_preview` when that status has changed. Time-entry writes go through `createTimeEntry` / `updateTimeEntry`. `confirmLockedWeek` is the only way those writes skip `assertUnlockedWeek`. A contractor/day total above 840 paid minutes sets `longDay` on the response.

`POST /api/ops/sql` classifies one statement. `SELECT` is wrapped in a 100-row cap. `INSERT` and `UPDATE` are previewed with a count and a five-row sample, then signed into a five-minute HMAC confirm token. An `UPDATE` that assigns `contractor.active` is `forbidden_sql` before the dry run. Execute recomputes the count, rejects a mismatch, and commits the statement plus the audit insert together. `POST /api/ops/revert` reads one `ops_audit` row and applies the inverse of `contractor.create`, `contractor.update`, `contractor.rate`, `contractor.archive`, `contractor.restore`, `time_entry.create`, or `time_entry.update`. `sql.insert` and `sql.update` are not reverted here.

`ops_audit` columns are `action`, `sql_text`, `params_json`, `old_json`, `new_json`, `reason`, `row_count`, and `created_at`. Triggers abort updates and deletes. The audit insert is the log; request bodies and tokens are not written to Worker logs.

## Decisions

- Monday is the first day of a payroll week.
- NZD is the MVP default, stored as `NZD` plus integer cents.
- An overnight shift is out of scope; finish must be later on the same date, and paid-hours entries must stay under 24 hours.
- Correcting a shift's work date may move it to another week; the dashboard then refreshes the week currently in view.
- One contractor/site/date entry keeps entry and correction semantics simple for the first release. Duplicate creates or updates return `duplicate_entry`.
- Gross totals are contractor payments before tax/GST/expenses and are not a payroll or tax determination.
- Deleting a recorded shift requires confirmation that names the contractor, site, and work date before the owner-scoped DELETE runs.

### Repository layout

The web app stays at the repository root (`src/`, `drizzle/`, `wrangler.jsonc`, vinext). `pnpm-workspace.yaml` includes `.`, `apps/*`, and `packages/*`. A separate repository was rejected because it would copy schemas and split an API change from the client that calls it.

`packages/core` (`@cleantrack/core`) holds the pure TypeScript shared by the web app and `apps/mobile`: Zod inputs, API error codes and response types, minute and money formatting, and week/date helpers. It does not import React, React Native, the DOM, or `cloudflare:*`. `src/lib/payroll.ts`, `src/lib/validation.ts`, and `src/lib/week-rollup.ts` re-export that package, so existing web imports stay on those paths. Pay still uses integer cents and `calculateEntryPayCents` on snapshotted rates.

`apps/mobile` is an Expo SDK 58 dev-client app (not Expo Go) with Expo Router native tabs. The contractor shell is Home, My week, Pay, and Account. Sign-in uses `@better-auth/expo/client` with `expo-secure-store` and the `cleantrack` scheme. The API origin is `EXPO_PUBLIC_API_URL`, then app config `extra.apiUrl`, then `https://cleantrack-timesheet.jeevan90wijerathna.workers.dev`. Device requests send the stored session cookie with `credentials: "omit"` and `X-CleanTrack-Client: mobile/<version>`. A 401 clears the stored session and returns to sign-in. Home reads the role from `GET /api/me`. Creating an account and resetting a password open the website. Bundle id `nz.co.jnok.cleantrack`, with `.preview` and `.dev` variants. No EAS project id or credentials are stored in the repo. The Worker deploy command remains `pnpm deploy` from the root. Mobile pins TypeScript `~6.0.3` because Expo SDK 58 and `expo/tsconfig.base` expect that compiler, while the web app and `packages/core` stay on TypeScript 7.0.2; pnpm's isolated installs keep the two toolchains from overriding each other.

### Weekly approval HTTP contract

`WeekApprovalResource` omits `ownerUserId` and serializes timestamps as ISO strings:

`{ id, weekStart, status, approvedAt, reopenedAt }`

| Method | Path | Cookie mutation | Success |
| --- | --- | --- | --- |
| POST | `/api/weeks/approve` | yes | `200 WeekApprovalResource` |
| POST | `/api/weeks/reopen` | yes | `200 WeekApprovalResource` |

Cookie-authenticated mutations use `authorize(request, true)`. Errors: `401 unauthorized`, `403 forbidden`, `400 invalid_week` (non-Monday), `400 invalid_request` (malformed totals), `409 stale_week`, `409 week_not_approved`, `500 internal_error` (correlation id) for unexpected failures. Time-entry POST/PATCH/DELETE map `week_locked` to `409`.

### Recurring schedule HTTP contract

Open schedule view omits `ownerUserId`: `{ id, weekdays, paidMinutes, effectiveFrom }`. Version history adds `effectiveTo`.

| Method | Path | Cookie mutation | Success |
| --- | --- | --- | --- |
| GET | `/api/assignments/[id]/schedule` | no | `200 { current, versions }` |
| PUT | `/api/assignments/[id]/schedule` | yes | `200` current open version |
| DELETE | `/api/assignments/[id]/schedule` | yes | `200 { ok: true }` |
| POST | `/api/weeks/apply-schedule` | yes | `200 { weekStart, inserted }` |
| POST | `/api/time-entries/[id]/exception` | yes | `200` dashboard-shaped entry |

GET `/api/assignments` and GET `/api/assignments/[id]` include `schedule` as the current open version or `null`. PATCH `/api/assignments/[id]` remains rate-only. Cookie-authenticated mutations use `authorize(request, true)`. Errors: `401 unauthorized`, `403 forbidden`, `400 invalid_week` (non-Monday `weekStart`), `400 invalid_request`, `404 not_found` (missing or cross-owner), `409 schedule_exists`, `409 no_schedule`, `409 week_locked`, `409 duplicate_entry`, `409 business_required`, `413 payload_too_large`, `500 internal_error` (correlation id) for unexpected failures.

### Business HTTP contract

`BusinessResource` omits the member user id:

`{ id, name, nzbn, address, contactEmail, contactPhone, timezone, currency, weekStart, onboardingCompletedAt }`

| Method | Path | Cookie mutation | Success |
| --- | --- | --- | --- |
| POST | `/api/business` | yes | `201` on first create, `200` when the owner membership already exists |
| POST | `/api/business/onboarding/complete` | yes | `200 BusinessResource` |

Cookie-authenticated mutations use `authorize(request, true)`. A forged `businessId` in the JSON is ignored. Errors: `401 unauthorized`, `403 forbidden`, `400 invalid_request`, `409 business_required` (complete with no membership), `413 payload_too_large`, `500 internal_error` (correlation id) for unexpected failures. Timezone must be `Pacific/Auckland`, currency `NZD`, and week start `monday`. NZBN is empty or 13 digits.

### Client recovery and auth exception containment

Sign-in and sign-up re-enable submission and announce connection errors when the auth client rejects. Exceptions escaping the Better Auth GET/POST handlers become a non-cacheable `503 service_unavailable` without forwarding the exception to the framework logger; normal Better Auth responses (including cookies and redirects) pass through unchanged.

A failed dashboard read (HTTP, network, or JSON), including the read after applying schedules, hides stale week data and offers Retry. Confirmed mutation success notices remain visible separately from the refresh failure. Retry reloads the week through the existing idempotent schedule-application flow; it does not resubmit the original mutation. Empty or invalid date input leaves the selected Monday unchanged.
