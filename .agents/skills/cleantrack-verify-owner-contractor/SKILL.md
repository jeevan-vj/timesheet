---
name: cleantrack-verify-owner-contractor
description: Verify CleanTrack web owner invitations, contractor work visibility, weekly approval and remittance with synthetic local accounts and screenshot evidence.
---

# Owner to contractor web verification

Use synthetic accounts and an isolated local Worker only. Read `.cursor/skills/verify-cleantrack/SKILL.md` for launch, doctor and cleanup; do not use production or `--remote`. Read `SPEC.md`, `SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md` and the relevant tests before execution. Preserve existing working-tree changes.

Record the git SHA, commands, platform, fixture week (Monday in Pacific/Auckland), expected and actual results, and screenshot paths under `docs/verification/owner-contractor/`. Never capture passwords, session cookies or invitation fragments. Mark each unmet criterion FAIL or BLOCKED with its cause; never infer a pass from source inspection. Run `pnpm install --frozen-lockfile` and `pnpm verify`; retain their output. Run `pnpm verify:mobile` only if mobile or shared core code changes. This web journey requires no iOS build. Clean up only processes and disposable data owned by the run.

## Freshness gate

Fetch upstream and compare the checkout with `origin/main` before diagnosing missing features. Preserve a dirty/behind primary checkout and verify an isolated worktree from current upstream. Run a fresh `pnpm build` (or successful `pnpm verify`) before launch: the launcher reuses an existing `dist/` build, so its release marker alone does not prove source freshness. Record source SHA and build time. On resource-constrained hosts use `VITEST_MAX_WORKERS=1 pnpm verify`; do not increase timeouts or skip tests.

## Existing implementation and setup

Reuse `scripts/invite-accept-e2e.mjs` for the invitation journey. Its documented inputs are `E2E_BASE_URL`, `MAILPIT_URL`, and `E2E_ARTIFACTS`; for email-delivery proof use local Mailpit (SMTP 1025, inbox 8025) with the repository's `smtp-dev` transport. Inspect `src/lib/runtime-env.ts` and the local launcher before configuring mail. The copy-link fallback can verify acceptance without email; explicitly mark email delivery NOT TESTED in that case. Never include invite links in screenshots or logs. This runner stops after re-login: it does **not** prove payroll or remittance. `scripts/mobile-screenshots.mjs` proves responsive web only.

## Acceptance criteria and evidence

1. Owner signs up at `/sign-up`, creates a business, adds a contractor and sends an invitation. Expect pending status and, when testing email delivery, exactly one matching Mailpit message; for copy-link mode expect the explicit email-not-sent notice; capture the pending UI without exposing the invite link.
2. Separate contractor browser context accepts that invitation, creates credentials, reaches `/portal` / My work, signs out and signs in again. Owner refresh shows Active (portal). Capture both roles. A reused or revoked invitation must not create another link/account.
3. Owner creates a site and assignment using existing UI, then records five 120-minute shifts (set Hours to 2 AND Minutes to 0; the schedule form can default Minutes to 30) at a synthetic NZD 32/hour for next Monday's week so all dates appear inside Assigned work's next-14-days window. Select that same week on the owner dashboard; approved payment history includes it even when the headline still describes the current week. Expect 600 minutes and NZD 320 gross. Contractor sees the same dates, site and minutes, and no other contractor's work. Capture owner summary and contractor work.
4. Exercise the scheduled-shift confirmation flow when present: unresolved work must block approval (`pending_shifts`); resolve it through the UI. Approve with matching current totals. Expect approved state, locked entry writes, and contractor payment visibility after refresh. A stale-total approval must not write.
5. Open/download owner and contractor remittance using their actual visible controls. Expect the same week, five lines, 600 minutes and NZD 320 gross from historical snapshots. Inspect the downloaded PDF, not just HTTP status. Changing the current rate must leave that week's totals unchanged. Capture remittance UI and retain the synthetic PDF.
6. Check empty-week behavior and another synthetic owner/contractor: no foreign work or PDF access; no-session reads fail closed. Use the existing route tests to substantiate boundaries without logging private response payloads.

Map evidence to `tests/portal-routes.test.ts`, `tests/remittance-route.test.ts`, `tests/remittance-service.test.ts`, and `tests/week-approval-routes.test.ts`. UI reach paths come from `.factory/feature-map.json` where present; do not invent a feature id. Report invitation, work, approval and PDF results separately.
