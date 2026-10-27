---
name: read-before-write
description: >-
  Before adding CleanTrack code, locate the existing helper, service, schema,
  or UI pattern and cite its path. Use for any non-trivial edit under src/,
  packages/core/, apps/mobile/, drizzle/, or tests/. Stops agents inventing
  parallel helpers or second pay/auth paths.
---

# Read before write

## When

Any change that adds a function, route, component, migration, or test under
`src/`, `packages/core/`, `apps/mobile/`, `drizzle/`, or `tests/`.

## Steps (do in order)

1. Read `AGENTS.md`, `.factory/POTATO.md`, and the relevant slice of `SPEC.md`.
2. Search before inventing:
   - Pay / minutes / rollup → `packages/core/src/payroll.ts`, `week-rollup.ts`
   - Validation → `packages/core/src/validation.ts` (web re-exports from `src/lib/`)
   - Auth / session → `src/lib/auth.ts`, `request-session.ts`, `runtime-env.ts`
   - Owner-scoped writes → matching file under `src/services/`
   - API errors → `apiError` in `src/lib/api.ts` / domain codes already used by sibling routes
   - Mobile theme / tokens → `apps/mobile/src/theme.ts` only
3. In the PR plan (or factory task notes), cite the file you will extend. Example:
   `Extend summarizeWeekBySite in packages/core/src/week-rollup.ts`.
4. Prefer extending the cited module over a new sibling with a similar name.
5. If no existing pattern fits, stop and say so in the PR (or ask) before adding
   a new abstraction. Do not invent a second pay formula, auth check, or env
   reader.

## Done when

- The diff touches the cited module (or explicitly documents why a new one is
  required).
- No duplicate of `calculateEntryPayCents`, `mondayFor`, `apiError`, or owner
  scoping helpers appears under a new path.
