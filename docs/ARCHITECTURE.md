# Architecture

## Product slice

`owner -> contractors + sites -> assignments -> daily time entries -> weekly summary`

An assignment connects a contractor to a site and may provide a rate override. Assignment CRUD is owner-scoped: list and get return active and archived rows joined to the same-owner contractor and site; create inserts or reuses the unique pair; PATCH updates only `rateCents`; DELETE archives (`active=false`); restore reactivates when both relations are still active. Unassign confirmation is a UI concern; the API archives in one owner-scoped DELETE and does not delete history.

The owner/contractor/site unique index is reused rather than inserting duplicates. An archived pair restored by POST create applies the submitted rate; restore-by-id does not change `rateCents`. A second active create returns `duplicate_assignment` only when both related entities are still active; otherwise create returns `not_found`.

When a time entry is created, the service resolves the active assignment (inner-joining an active owned contractor and site), snapshots the effective rate onto that new entry only, calculates paid minutes, and stores both. Weekly summaries aggregate immutable entry snapshots. Changing an assignment override later never rewrites `time_entry.rate_cents`.

Paid-hours entries store integer paid minutes directly. Clock columns remain required, so those rows use a same-day window equal to the paid duration (`00:00` plus paid minutes, no break) and `entry_mode = paid_hours` so the UI does not treat them as clock times. Start-and-finish entries keep `entry_mode = clock`. Create and update both persist those paid-hours sentinels.

The owner can assign a contractor to another site in the same create-entry request (`assignSite`). That inline path creates a missing assignment or restores an archived pair (applying `assignSite.rateCents`), and does not rewrite an already-active override. Shift validation and the duplicate contractor/site/date check run before the assignment write so a failed entry does not leave a restored assignment. Inline assign-another-site remains create-only. Dashboard new-entry options include only assignments whose contractor and site are both active and owned (inner joins); archived assignments and inactive relations are omitted from that list.

The weekly dashboard GET remains the collection read for time entries: Monday–Sunday, owner-scoped joins to contractors and sites, ordered by work date then contractor name. There is no separate collection GET for time entries.

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

There is no DELETE on contractors. Cookie-authenticated mutations use `authorize(request, true)`. Errors: `401 unauthorized`, `403 forbidden`, `404 not_found`, `409 duplicate_contractor`, `413 payload_too_large`, `400 invalid_request` (optional `fields` on create/patch Zod failures only).

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
