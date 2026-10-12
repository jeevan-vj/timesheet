# Architecture

## Product slice

`owner -> contractors + sites -> assignments (+ optional schedule versions) -> daily time entries -> weekly summary`

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

A contractor row stays in place for the owner's history. Archive sets `active=false` on all of that owner's assignments for the contractor, then on the contractor row. Restore is the inverse on the same row (contractor first, then assignments) and never inserts a new contractor. Both writes are issued in one Drizzle D1 `batch` so they share a single round trip. D1 batch is not rollback-atomic; retry remains safe because the operations are idempotent. Both never write `time_entry`.

The unique index `contractor_owner_name_uq` on `(owner_user_id, name)` includes archived rows. A same-owner create or rename that collides, including with an archived name, returns `409 { error: "duplicate_contractor" }`. Different owners may share names. Cross-owner get, update, archive, and restore return identical `404 { error: "not_found" }` with no writes.

`GET /api/dashboard` contractor and site selects remain active-only. The assignment query returns only active assignments whose contractor and site are also `active=true`. Time-entry joins still load contractors and sites without an active filter so historical weeks keep names and snapshotted pay. Creating an assignment or time entry still requires an active contractor and site; an archived contractor or site is `not_found`.

### Contractor HTTP contract

`ContractorResource` omits `ownerUserId` and serializes timestamps as JSON dates:

`{ id, name, email, phone, defaultRateCents, currency: "NZD", active, createdAt, updatedAt }`

| Method | Path | Cookie mutation | Success |
| --- | --- | --- | --- |
| GET | `/api/contractors` | no | `200 { contractors: ContractorResource[] }` name asc; `includeArchived` omit/false/0 = active only, true/1 = active+archived |
| POST | `/api/contractors` | yes | `201 ContractorResource` |
| GET | `/api/contractors/[id]` | no | `200 ContractorResource` (archived readable by owner) |
| PATCH | `/api/contractors/[id]` | yes | `200 ContractorResource` |
| POST | `/api/contractors/[id]/archive` | yes | `200 ContractorResource` `active: false` |
| POST | `/api/contractors/[id]/restore` | yes | `200 ContractorResource` `active: true` |
| GET | `/api/contractors/[id]/remittance` | no | `200` PDF (`?week=YYYY-MM-DD` Monday) |

There is no DELETE on contractors. Cookie-authenticated mutations use `authorize(request, true)`. Errors: `401 unauthorized`, `403 forbidden`, `404 not_found`, `409 duplicate_contractor`, `413 payload_too_large`, `400 invalid_request` (optional `fields` on create/patch Zod failures only).

`GET /api/contractors/[id]/remittance?week=YYYY-MM-DD` is a cookie read (`authorize(request)` without mutation CSRF). Ownership comes from the session. The handler loads the contractor with `id` plus `owner_user_id`, then that owner's time entries for the Monday–Sunday week, inner-joining contractor and site by id and owner only (no `active` filter). The PDF is generated on read with `pdf-lib`; nothing is stored. Success headers: `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="remittance-<slug>-<weekEnd>.pdf"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Empty weeks return `400 { error: "no_entries" }` JSON, not a PDF. Cross-owner ids return `404 { error: "not_found" }`. Approved weeks stay readable: remittance does not call `assertUnlockedWeek`.

## Runtime

The vinext App Router runs as a Cloudflare Worker. D1 is accessed through the `DB` binding with Drizzle. Better Auth stores users and sessions in the same D1 database. The browser calls same-origin route handlers; route handlers validate input and invoke owner-scoped services.

Site APIs are `GET/POST /api/sites`, `GET/PATCH/DELETE /api/sites/[id]`, and `POST /api/sites/[id]/restore`. Collection GET is a read (`authorize(request)`) and defaults to the owner's active sites; `?includeArchived=1` includes archived rows. Cookie-authenticated site mutations require a trusted Origin. Duplicate names map to `duplicate_site` (409). DELETE archives; it never issues `DELETE FROM site` and never updates `time_entry` rows. Archive and restore update the site and that site's owner-scoped assignments together through D1/Drizzle `batch`.

The dashboard continues to load only `sites.active = true` and `assignments.active = true` for pickers. The weekly time-entry join matches sites by id and owner only, so archived site names still render on historical rows while pay snapshots stay on the entry.

## Decisions

- Monday is the first day of a payroll week.
- NZD is the MVP default, stored as `NZD` plus integer cents.
- An overnight shift is out of scope; finish must be later on the same date, and paid-hours entries must stay under 24 hours.
- Correcting a shift's work date may move it to another week; the dashboard then refreshes the week currently in view.
- One contractor/site/date entry keeps entry and correction semantics simple for the first release. Duplicate creates or updates return `duplicate_entry`.
- Gross totals are contractor payments before tax/GST/expenses and are not a payroll or tax determination.
- Deleting a recorded shift requires confirmation that names the contractor, site, and work date before the owner-scoped DELETE runs.

### Weekly approval HTTP contract

`WeekApprovalResource` omits `ownerUserId` and serializes timestamps as ISO strings:

`{ id, weekStart, status, approvedAt, reopenedAt }`

| Method | Path | Cookie mutation | Success |
| --- | --- | --- | --- |
| POST | `/api/weeks/approve` | yes | `200 WeekApprovalResource` |
| POST | `/api/weeks/reopen` | yes | `200 WeekApprovalResource` |

Cookie-authenticated mutations use `authorize(request, true)`. Errors: `401 unauthorized`, `403 forbidden`, `400 invalid_week` (non-Monday), `400 invalid_request` (malformed totals), `409 stale_week`, `409 week_not_approved`. Time-entry POST/PATCH/DELETE map `week_locked` to `409`.

### Recurring schedule HTTP contract

Open schedule view omits `ownerUserId`: `{ id, weekdays, paidMinutes, effectiveFrom }`. Version history adds `effectiveTo`.

| Method | Path | Cookie mutation | Success |
| --- | --- | --- | --- |
| GET | `/api/assignments/[id]/schedule` | no | `200 { current, versions }` |
| PUT | `/api/assignments/[id]/schedule` | yes | `200` current open version |
| DELETE | `/api/assignments/[id]/schedule` | yes | `200 { ok: true }` |
| POST | `/api/weeks/apply-schedule` | yes | `200 { weekStart, inserted }` |
| POST | `/api/time-entries/[id]/exception` | yes | `200` dashboard-shaped entry |

GET `/api/assignments` and GET `/api/assignments/[id]` include `schedule` as the current open version or `null`. PATCH `/api/assignments/[id]` remains rate-only. Cookie-authenticated mutations use `authorize(request, true)`. Errors: `401 unauthorized`, `403 forbidden`, `400 invalid_week` (non-Monday `weekStart`), `400 invalid_request`, `404 not_found` (missing or cross-owner), `409 schedule_exists`, `409 no_schedule`, `409 week_locked`, `409 duplicate_entry`, `413 payload_too_large`.
