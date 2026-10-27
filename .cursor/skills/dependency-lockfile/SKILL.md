---
name: dependency-lockfile
description: >-
  After any package.json change, regenerate pnpm-lock.yaml and prove
  pnpm install --frozen-lockfile. Keep web verify separate from verify:mobile.
  Use when adding Expo, npm, or workspace dependencies.
---

# Dependency and lockfile discipline

## When

Edits to root or workspace `package.json`, `pnpm-lock.yaml`, `apps/mobile/**`,
or `packages/core/**` dependencies.

## Steps

1. Add the dependency with pnpm (workspace-aware). Do not hand-edit lockfile
   hashes.
2. Declare required peers (e.g. `expo-font`) explicitly when Expo / native
   tooling demands them.
3. Run:
   ```bash
   pnpm install --frozen-lockfile
   pnpm verify
   ```
   and when mobile changed:
   ```bash
   pnpm verify:mobile
   ```
4. Keep root `pnpm verify` on the web/worker path; do not fold a broken mobile
   typecheck into web green by skipping it — use the separate script and CI job.
5. Medium risk in `.factory/risk-policy.json` for `package.json` /
   `pnpm-lock.yaml`. Call out supply-chain / audit impact (`pnpm audit` is in
   CI at high severity for prod).

## Anti-patterns (seen in-repo)

- Landing Expo SDK bumps without regenerating the lockfile (broke frozen
  install; required a follow-up fix on PR #81).
- Inventing new npm scripts that duplicate `pnpm verify`.

## Done when

Frozen install + verify (and verify:mobile if needed) pass on a clean tree.
