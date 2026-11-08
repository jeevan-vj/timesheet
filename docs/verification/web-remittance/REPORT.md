# Contractor web remittance verification

2026-11-08. Isolated worktree based on `origin/main` 61c6aec. Synthetic local data only, Worker port 3018. No iOS build, native release, production changes, or migrations added.

## Scope and correction

The primary checkout used for the earlier failure report was ten commits behind upstream. Current upstream already implements assigned work, pay details, and the pending-shift approval gate. This PR adds the missing per-business web PDF download action using the existing contractor-scoped endpoint, labels the headline with its actual week range, and packages reusable verification skills. Earlier stale-build screenshots are not PR evidence.

## Acceptance evidence

| Journey | Result | Evidence |
| --- | --- | --- |
| Owner signup, business, contractor, site and assignment | PASS through browser UI | Synthetic Current Web Cleaning workspace |
| Invite and accept | PASS, copy-link fallback in separate browser profile | Owner shows Active (portal); contractor reaches My work |
| Contractor sign-out/re-login | PASS on final build | Sign-in returns to /portal; approved pay details remain accessible |
| Assigned work | PASS | `assigned-work.png`; next-14-days roster contains the fixture site/shifts |
| Pending approval gate | PASS | `pending-approval.png`; disabled button and explicit pending explanation; direct API attempt returned 409 pending_shifts |
| Resolve and approve | PASS | Mark all worked, review/confirm approval; `owner-approved.png` shows locked 600 minutes / NZ$320 |
| Contractor pay detail | PASS | Five 120-minute rows at NZ$64, total NZ$320 for 9–15 November; `contractor-pay-details.png` |
| Contractor PDF | PASS | New visible per-business link downloaded PDF; authenticated fetch 200 application/pdf; `contractor-remittance.pdf`, `pdf-text.txt` contain five dates, site, 2h/$64 lines, NZ$320 total; rendered page also visually inspected |
| Owner PDF | PASS download action | Confirmation and browser download flow exercised |
| PDF access boundaries | PASS | No-session request 401; unlinked business 404; route tests cover unapproved/ineligible cases |
| Narrow web layout | PASS | 390px viewport, document scrollWidth 390; `contractor-responsive.png` |

The recurring template also predicts shifts in the following week; those are upcoming schedule projections, not extra paid entries in the approved fixture week. The fixture's minutes selector was explicitly set to 0 alongside Hours=2.

## Checks and review

- Frozen install passed, pnpm 10.26.0 / Node 24.22.1.
- Final `VITEST_MAX_WORKERS=1 pnpm verify` passed after the headline-label correction: 107 files, 883 tests (212.93 seconds); lint, typecheck, core typecheck and build passed.
- Independent read-only code review PASS; reviewer separately ran the three new rendering tests and inspected screenshot/PDF-text evidence. No independent installed-device proof is claimed.
- Both new skills pass skill-creator quick_validate.py.
- `git diff --check` passed.

## Limits

Email delivery was not configured; copy-link acceptance was tested. Native flows are documented in the skill but not executed, per request. No hosted CI/production conclusion follows from local evidence. Empty current-week headline status can say approved despite no approval row; this pre-existing status semantic is outside the PDF-link change. The headline range correction prevents mislabeling current-week totals as the latest approved week.

No new endpoints, ownership rules, payroll calculations, database schema, dependencies, or control-plane changes. Server-side eligibility and approval checks remain authoritative on every PDF request, including after a page has loaded.

## Factory CI readiness repair — 2026-11-09

Two hosted attempts on `78cd5d2` timed out on post-signup `networkidle` waits
although the required dashboard content was visible. User authorization covered
the protected Factory harness change. Dashboard readiness now waits for the
actual week-qualified dashboard response, required headings, HTTP 200, and
`business: null`. Response and UI waits retain 30-second limits; all three
scenarios, evidence policy, and workflow permissions remain intact. Signup's
original loading wait remains in place to avoid interacting before hydration.

The full evidence consumer also exposed premature pay-rules/holidays requests
before business creation. `LoadedWeek` now mounts `PayRulesSettings` only when
`data.business` exists, matching the existing owner-assistant readiness guard.
This changes no API authorization or payroll calculation.

Local final-source browser run: health-ok PASS, owner-signup PASS,
empty-week-dashboard PASS. Evidence consumer PASS with no reason codes,
console errors, or failed network requests. This is local evidence against the
uncommitted patch over `78cd5d2`, not hosted evidence for a new SHA.
Screenshot: `factory-empty-week.png`. Full local traces remain in
`/tmp/pr141-e2e-proof`.

Focused tests: 2 files, 20 tests passed, including missing UI, 401/500, malformed
workspace, and unexpected-business rejection. Independent harness review PASS;
its evidence-policy finding was fixed by the product guard above.

Initial full verify: 890 tests passed; one existing mobile fingerprint test
exceeded its unchanged 60-second deadline. No native build ran. Full rerun
results are recorded in `check-output.txt`.
