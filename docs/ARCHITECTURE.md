# Architecture

## Product slice

`owner -> contractors + sites -> assignments -> daily time entries -> weekly summary`

An assignment connects a contractor to a site and may provide a rate override. When a time entry is created, the service resolves the assignment, snapshots the effective rate, calculates paid minutes, and stores both. Weekly summaries aggregate immutable entry snapshots.

## Runtime

The vinext App Router runs as a Cloudflare Worker. D1 is accessed through the `DB` binding with Drizzle. Better Auth stores users and sessions in the same D1 database. The browser calls same-origin route handlers; route handlers validate input and invoke owner-scoped services.

## Decisions

- Monday is the first day of a payroll week.
- NZD is the MVP default, stored as `NZD` plus integer cents.
- An overnight shift is out of scope; finish must be later on the same date.
- One contractor/site/date entry keeps entry and correction semantics simple for the first release.
- Gross totals are contractor payments before tax/GST/expenses and are not a payroll or tax determination.
