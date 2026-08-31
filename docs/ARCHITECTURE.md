# Architecture

## Product slice

`owner -> contractors + sites -> assignments -> daily time entries -> weekly summary`

An assignment connects a contractor to a site and may provide a rate override. When a time entry is created, the service resolves the assignment, snapshots the effective rate, calculates paid minutes, and stores both. Weekly summaries aggregate immutable entry snapshots.

Paid-hours entries store integer paid minutes directly. Clock columns remain required, so those rows use a same-day window equal to the paid duration (`00:00` plus paid minutes, no break) and `entry_mode = paid_hours` so the UI does not treat them as clock times. Start-and-finish entries keep `entry_mode = clock`.

The owner can assign a contractor to another active site in the same create-entry request. The service creates that owner-scoped assignment first, then snapshots the resulting effective rate onto the entry.

## Runtime

The vinext App Router runs as a Cloudflare Worker. D1 is accessed through the `DB` binding with Drizzle. Better Auth stores users and sessions in the same D1 database. The browser calls same-origin route handlers; route handlers validate input and invoke owner-scoped services.

## Decisions

- Monday is the first day of a payroll week.
- NZD is the MVP default, stored as `NZD` plus integer cents.
- An overnight shift is out of scope; finish must be later on the same date, and paid-hours entries must stay under 24 hours.
- One contractor/site/date entry keeps entry and correction semantics simple for the first release. Duplicate creates return `duplicate_entry`.
- Gross totals are contractor payments before tax/GST/expenses and are not a payroll or tax determination.
- Deleting a recorded shift requires confirmation that names the contractor, site, and work date before the owner-scoped DELETE runs.
