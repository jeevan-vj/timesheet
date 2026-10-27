---
name: spec-to-pr-traceability
description: >-
  Map every acceptance criterion from the issue/SPEC to code and a test in the
  PR body. Use for factory:ready work and any PR that closes an issue.
---

# Spec → PR traceability

## When

Factory issues (`factory:ready`), PRs with `Closes #N`, or work driven by
`docs/specs/*` / `SPEC.md`.

## Steps

1. Copy acceptance criteria into the PR plan **before** coding.
2. For each criterion, record:
   - Code path (file + symbol)
   - Test path (file + test name) **or** feature-map evidence for pure UI
3. List **non-goals** explicitly so repair agents do not expand scope.
4. Factory PRs must include: `Closes #<n>`, plan, verification results,
   security/payroll impact, migration/deploy notes.
5. If a criterion cannot be met, say so under `## Not implemented` with the
   follow-up issue — do not silently drop it.

## PR body template (minimum)

```markdown
## Plan
...

## Acceptance
| Criterion | Code | Test / evidence |
| --- | --- | --- |
| ... | `src/...` | `tests/...` |

## Verification
`pnpm verify` — <paste>

## Security / payroll
...

## Not implemented
...
```

## Done when

Every criterion is mapped or explicitly deferred with an issue link.
