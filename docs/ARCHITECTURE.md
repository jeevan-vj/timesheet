# Architecture

## Product slice

`owner -> contractors + sites -> assignments -> daily time entries -> weekly summary`

An assignment connects a contractor to a site and may provide a rate override. When a time entry is created, the service resolves the assignment, snapshots the effective rate, calculates paid minutes, and stores both. Weekly summaries aggregate those entry snapshots.

Paid-hours entries store integer paid minutes directly. Clock columns remain required, so those rows use a same-day window equal to the paid duration (`00:00` plus paid minutes, no break) and `entry_mode = paid_hours` so the UI does not treat them as clock times. Start-and-finish entries keep `entry_mode = clock`. Create and update both persist those paid-hours sentinels.

The owner can assign a contractor to another active site in the same create-entry request. The service creates that owner-scoped assignment first, then snapshots the resulting effective rate onto the entry. Inline assign-another-site is create-only.

The weekly dashboard GET remains the collection read for time entries: Monday–Sunday, owner-scoped joins to contractors and sites, ordered by work date then contractor name. There is no separate collection GET for time entries.

An owner inspects one recorded shift with GET `/api/time-entries/:id`, which returns the dashboard-entry-shaped row (including contractor and site display names) after owner-scoped inner joins. PATCH `/api/time-entries/:id` updates contractor, site, date, entry mode, duration/clock, break, and notes. If contractor and site are unchanged, the original `rate_cents` snapshot is kept. If contractor or site changes, the service requires an active same-owner assignment and snapshots that assignment's effective rate as a reclassification.

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
