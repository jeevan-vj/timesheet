# Architecture

## Product slice

`owner -> contractors + sites -> assignments -> daily time entries -> weekly summary`

An assignment connects a contractor to a site and may provide a rate override. Assignment CRUD is owner-scoped: list and get return active and archived rows joined to the same-owner contractor and site; create inserts or reuses the unique pair; PATCH updates only `rateCents`; DELETE archives (`active=false`); restore reactivates when both relations are still active. Unassign confirmation is a UI concern; the API archives in one owner-scoped DELETE and does not delete history.

The owner/contractor/site unique index is reused rather than inserting duplicates. An archived pair restored by POST create applies the submitted rate; restore-by-id does not change `rateCents`. A second active create returns `duplicate_assignment` only when both related entities are still active; otherwise create returns `not_found`.

When a time entry is created, the service resolves the active assignment (inner-joining an active owned contractor and site), snapshots the effective rate onto that new entry only, calculates paid minutes, and stores both. Weekly summaries aggregate immutable entry snapshots. Changing an assignment override later never rewrites `time_entry.rate_cents`.

Paid-hours entries store integer paid minutes directly. Clock columns remain required, so those rows use a same-day window equal to the paid duration (`00:00` plus paid minutes, no break) and `entry_mode = paid_hours` so the UI does not treat them as clock times. Start-and-finish entries keep `entry_mode = clock`.

The owner can assign a contractor to another site in the same create-entry request (`assignSite`). That inline path creates a missing assignment or restores an archived pair (applying `assignSite.rateCents`), and does not rewrite an already-active override. Shift validation and the duplicate contractor/site/date check run before the assignment write so a failed entry does not leave a restored assignment. Dashboard new-entry options include only assignments whose contractor and site are both active and owned (inner joins); archived assignments and inactive relations are omitted from that list.

## Runtime

The vinext App Router runs as a Cloudflare Worker. D1 is accessed through the `DB` binding with Drizzle. Better Auth stores users and sessions in the same D1 database. The browser calls same-origin route handlers; route handlers validate input and invoke owner-scoped services.

## Decisions

- Monday is the first day of a payroll week.
- NZD is the MVP default, stored as `NZD` plus integer cents.
- An overnight shift is out of scope; finish must be later on the same date, and paid-hours entries must stay under 24 hours.
- One contractor/site/date entry keeps entry and correction semantics simple for the first release. Duplicate creates return `duplicate_entry`.
- Gross totals are contractor payments before tax/GST/expenses and are not a payroll or tax determination.
- Deleting a recorded shift requires confirmation that names the contractor, site, and work date before the owner-scoped DELETE runs.
