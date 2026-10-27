---
name: evidence-based-verification
description: >-
  Run pnpm verify (and verify:mobile / e2e when relevant), paste command
  output, and attach screenshots for UI. A green build alone is not proof.
  Use for every CleanTrack PR that changes behavior or UI.
---

# Evidence-based verification

## When

Any PR that changes product behavior, UI, factory gates, or release smoke.

## Commands (this repo)

```bash
pnpm install --frozen-lockfile
pnpm verify          # lint + test + typecheck + typecheck:core + build (see package.json)
pnpm verify:mobile   # when apps/mobile or packages/core pay/validation changes
```

Optional focused runs after `pnpm verify`:

- Factory policy: `pnpm exec vitest run tests/factory*.test.mjs`
- Local owner path: only if `scripts/verify-e2e.mjs` / `.cursor/skills/verify-*`
  exist on the branch — do not invent a one-off runner.

## UI proof

1. Read `.factory/feature-map.json` for the touched feature id. If the flow is invite, portal, ops, or mobile and has no map entry yet, document the reach path in the PR and do not invent a map id mid-change.
2. Run `pnpm dev` (or the mobile app) and walk `reach` → `expect`.
3. Put screenshots (or a short recording) in the PR body or under
   `docs/verification/`. Synthetic owners only — no real contractor data.
4. The author of the change does not declare it verified. Factory verifier /
   independent review is separate.

## PR body must include

- Exact commands run and pass/fail counts (paste output, not "tested").
- Security / payroll impact (even if "none").
- Screenshots for UI, or an explicit "non-UI" note.
- For release/smoke changes: assert against **decoded** DOM/text where HTML
  entities appear (see production smoke title fix). Prefer parsing `<title>`
  over raw HTML substring matches.

## Done when

Acceptance criteria each have evidence. "Build passed" alone is a fail for UI.
