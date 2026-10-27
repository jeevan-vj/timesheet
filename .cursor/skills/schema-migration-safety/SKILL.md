---
name: schema-migration-safety
description: >-
  Never edit an applied migration. Add drizzle/000N_*.sql forward-only, keep
  rate_cents and paid_minutes untouched on backfills, and follow destructive
  migration gates. Use for any src/db/, drizzle/, or schema change.
---

# Schema / migration safety

## When

Diffs under `drizzle/`, `src/db/`, or anything that alters D1 tables.

## Hard rules

1. **Never modify an applied migration.** Add `drizzle/000N_name.sql` only.
2. Backfills must not rewrite `time_entry.rate_cents` or historical
   `paid_minutes`. Snapshot integrity is a P0.
3. Destructive SQL (`DROP TABLE/COLUMN/INDEX`, `TRUNCATE`, `DELETE FROM`
   without `WHERE`, table rebuilds) needs an entry in
   `.github/migration-destructive-ok.txt` (preferred), or the PR label
   `migration-destructive-ok`, or commit trailer
   `Migration-Destructive-Ok: <basename>.sql`.
4. Owner / `business_id` scoping stays enforced. Prefer failing closed
   (`not_found`) over leaking cross-owner rows.
5. Risk: these paths are **high** in `.factory/risk-policy.json` — human-gated
   after checks pass. Do not ask the factory to auto-merge.

## Steps

1. Read the latest `drizzle/000*.sql` and `src/db/schema.ts`.
2. Write the forward migration + Drizzle schema update together.
3. Add a migration test under `tests/` that proves historical rates/minutes
   unchanged when the change is a backfill.
4. Document rollback reality in the PR: D1 Time Travel bookmark is recorded by
   release; there is no automatic D1 restore on Worker rollback.

## Done when

New numbered SQL file exists, applied migration files are untouched, and tests
cover the data invariant.
