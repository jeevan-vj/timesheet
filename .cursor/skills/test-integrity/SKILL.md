---
name: test-integrity
description: >-
  Never skip, .only, or weaken tests or validation to make CI pass. Prefer
  fixing product code. Use when tests fail, when adding fixtures, or when
  tempted to eslint-disable / ts-ignore / broaden mocks.
---

# Test integrity

## When

Failing CI, flaky E2E, or any change to `tests/`, assertions, Zod schemas, or
lint allowlists.

## Hard rules (also in AGENTS.md)

1. Never weaken tests or validation to make CI pass.
2. No `describe.only` / `it.only` / `test.skip` / `xit` left in the tree.
3. No new `@ts-ignore`, `@ts-expect-error` without a one-line justification that
   names the upstream bug, and no `eslint-disable` for paved-path rules.
4. Do not mock away the behavior under test (payroll math, owner scoping,
   rate snapshotting). Mock I/O boundaries only.
5. `pnpm lint` (`scripts/lint-paved-path.mjs`) bans `console.*`, `TODO` /
   `FIXME` / `HACK`, and the word `workaround` in `src/` — fix the cause;
   do not comment a workaround.
6. Snapshot / HTML assertions must match real markup (decode entities; do not
   assert raw `&` when the page serves `&amp;`).

## Steps

1. Reproduce the failure with the focused vitest file.
2. Fix product code or the incorrect assertion — not the threshold.
3. If E2E flakes on `networkidle`, fix load abort / in-flight mutations (see
   empty-week apply-schedule) rather than shortening timeouts blindly.
4. Re-run `pnpm verify` before claiming green.

## Done when

The original failure mode has a regression test, and no skip/weaken landed.
