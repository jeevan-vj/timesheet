---
name: Factory task
about: Delegate spec-driven implementation to Cursor Cloud via factory:ready
title: "factory: "
labels: "factory:ready"
assignees: ""
---

This issue is labeled `factory:ready`. GitHub Actions will dispatch the Cursor factory orchestrator through the Agents API (`autoCreatePR=true`). Do **not** mention `@cursor` here — a live GitHub↔Cursor integration would start a second, non-factory agent.

Use `@cursor` only on the resulting pull request for human refine outside the trusted factory repair loop.

Read and obey `AGENTS.md`, the product/security/architecture contracts, `.factory/agents/orchestrator.md`, and relevant tests. Ask the spec subagent for a task contract, route only the necessary specialists sequentially, verify the integrated acceptance criteria, run frozen install/test/typecheck/build, and open one PR containing `Closes #ISSUE_NUMBER`, verification results, and security/payroll/migration impact.

## Goal

Describe the outcome, not the steps. Restate the user-visible result.

## Acceptance criteria

- [ ]

## Verification

- [ ] `pnpm verify` passes.
- [ ] UI changes name the `.factory/feature-map.json` ids exercised and include a screenshot or recording.
- [ ] Non-UI changes name the test or command that proves the behavior.

## Constraints / non-goals

-
