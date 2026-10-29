# PR 114 safety follow-up

Scope: mobile owner exception actions from #103, with production exposure disabled pending #53. No audit schema, server contract, payroll calculation, rate snapshot, migration, native dependency, fingerprint input, or factory/approval control is changed.

## Implementation and acceptance

| Criterion | Implementation | Evidence |
| --- | --- | --- |
| Destructive confirmation | The shift sheet names contractor, site and date, states zero paid time/pay, and requires a second explicit tap. Cancel/Close do not submit. | `node tests/mobile-owner-sheet.browser.mjs`; `absence-confirmation.png` |
| No implicit override reset through Worked | `ownerShiftActionsState` disables Worked on `hours_override`; Reset is explicitly labelled as restoring scheduled hours and requires confirmation. Existing server mappings are retained. | `tests/mobile-owner-mutations.test.ts`; browser check; `reset-confirmation.png` |
| Approved-week UI | Every submit rechecks action availability; an hours editor ceases to be available on approval. Existing server `week_locked` enforcement remains. | Browser approval transition; existing mutation tests |
| Safe release default | `OWNER_SHIFT_ACTIONS_ENABLED` is hard-coded false; both sheet and mutation hook enforce it. No environment variable or public runtime toggle. | `tests/mobile-owner-release-gate.test.mjs` executes all four real hook mutation functions and asserts zero transport/cache calls; `release-disabled.png` |
| Pending request lifecycle | Immediate ref prevents duplicate taps. Mutation-level settlement clears both latch and rendering state even after sheet close/reset. A previous request cannot close a different selected entry. | Browser double-click and close/reopen-before-settlement regression |
| Request validation and error behavior | Existing pure builders, core validation, mobileFetch and dashboard invalidation are retained. | Existing mutation/client tests |

## Browser evidence boundary

There is no mobile feature-map entry. Reach: Owner Today/Week -> tap a repeating shift -> shift sheet -> exception action. The reusable browser check renders the actual sheet, buttons, React Query hook and mutation builders using React Native Web at a 390 x 844 viewport. Only native icon/safe-area adapters and transport are replaced; no server or real account is contacted.

Run from repository root after frozen-lockfile installation and Playwright Chromium installation:

```sh
node tests/mobile-owner-sheet.browser.mjs
```

The first scenario uses the committed hard-off release gate. The second changes the gate only inside the loopback test Vite transform to exercise future enabled behavior. This does not edit the committed gate, expose a runtime opt-in, or ship test fixtures in the mobile app. Screenshots contain synthetic data only. External page requests are blocked.

This is component interaction evidence, not device/simulator, native VoiceOver/Dynamic Type, or dev/staging API integration evidence. Those checks remain mandatory before enabling the feature.

## Release and audit boundary

Ready for human code review does not authorize merge, deployment or OTA. Keep all four actions disabled until #53 supplies append-only business-scoped actor-attributed history, safe before/after paid-minute semantics and an explicit verified failure policy that prevents silent unaudited payroll mutations. Existing server endpoints and other clients are unchanged; this client gate is not server authorization or an audit implementation.

The conservative mobile behavior leaves Worked disabled on an override. A decision to support confirming worked while retaining custom minutes would need an explicit domain/API design; this follow-up does not reinterpret `confirm_worked`. Reset remains an explicit replacement of paid hours with historical scheduled minutes.

Other #103 slices (going-forward overrides, Add/Edit/Delete and Apply schedule) remain out of scope. Do not close #103 or #53 with this PR. The existing 15-minute picker is unchanged.

## Verification commands

- `corepack pnpm install --frozen-lockfile` (repository-pinned pnpm 10.26.0).
- `corepack pnpm verify` (lint, complete tests, root/core typechecks, vinext build).
- `corepack pnpm verify:mobile` (core/mobile typechecks, mobile lint).
- `node tests/mobile-owner-sheet.browser.mjs` (committed gate and synthetic enabled interaction scenarios).

Final command output/counts are recorded in the PR description. Independent read-only verification is separate from the implementation pass. No production testing is authorized.
