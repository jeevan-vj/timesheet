---
name: scope-discipline
description: >-
  One scoped change, one branch, one PR. No drive-by refactors, no second
  intake path, no edits to AGENTS.md / .github / .factory unless the task is
  explicit factory work. Use for every CleanTrack agent session.
---

# Scope discipline

## When

Always for agent work in this repo. Reinforced by `.cursor/rules/potato.mdc`.

## Rules

1. One outcome, one branch, one PR. State non-goals up front.
2. Do not refactor adjacent modules "while here." Formatting-only churn on
   untouched files is out of scope.
3. Do not invent a second workflow beside `.factory/`. Intake stays
   `factory:ready` → factory runners.
4. Protected paths (human-gated, never autonomously merged):
   - `AGENTS.md`
   - `.github/**`
   - `.factory/**`
5. High-risk paths (auth, payroll, migrations, validation, time-entry write,
   accounts-config, etc. — see `.factory/risk-policy.json`) stay human-gated
   after checks pass.
6. Prefer the smallest vertical slice that ships the acceptance criteria.

## Repair

Factory repair is ≤2 cycles for CI/review/E2E feedback. Fix only failures
caused by this PR. Do not expand into unrelated debt.

## Done when

`git diff origin/main...HEAD --stat` shows only files justified by the plan.
