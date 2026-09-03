# AGENTS.md

## Repository purpose

CleanTrack is a private contractor-hours and weekly-pay application for multi-site cleaning teams.

## Required reading

Before changing code, read `SPEC.md`, `SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, relevant tests, and any issue spec under `docs/specs/`.

## Engineering workflow

For non-trivial work:

1. Write a short plan and acceptance criteria.
2. Use TDD where practical.
3. Implement the smallest coherent vertical slice.
4. Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, and `pnpm build`.
5. Review the final diff for authorization, payroll, migration, and unintended behavior changes.

## Hard rules

- Derive ownership from the authenticated server session only.
- Scope every domain query and relation lookup by owner.
- Store money in integer cents and work durations in integer minutes.
- Snapshot rates on time entries; never recompute historical entries from current rates.
- Never log contractor details, rates, notes, request bodies, auth tokens, or passwords.
- Never modify an applied migration; add a new migration.
- Never weaken tests or validation to make CI pass.
- Treat `AGENTS.md`, `.github/**`, and `.factory/**` as protected control-plane code. Change them only for explicit factory work.

## Pull requests

Factory PRs must include `Closes #<issue-number>`, the plan, verification results, security/payroll impact, and migration/deployment notes. Factory workers are Cursor Cloud Agents started by the `factory:ready` label via Actions (preferred) or Codex Cloud (`@codex`). Do not put `@cursor` in factory issue bodies when GitHub↔Cursor mentions are live; use `@cursor` on PRs only for human refine. Protected control-plane changes are never autonomously merged.

## Review severity

- P0: cross-owner data disclosure, destructive payroll corruption, or credential exposure.
- P1: authorization bypass, materially incorrect pay, or destructive migration.
- P2: meaningful requirement, validation, or test gap.
- P3: non-blocking maintainability improvement.
