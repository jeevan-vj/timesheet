---
name: verify-e2e
description: Run the CleanTrack owner payroll path in a local browser and record pass/fail evidence. Use when proving signup, business onboarding, sites, contractors, schedules, weekly pay, remittance, or cross-business isolation. Do not use against production.
metadata:
  surfaces:
    - ide
    - cloud
---

# Verify CleanTrack end to end

Run the owner payroll path in a real browser against a local D1 database. Record each step. This skill does not replace `pnpm verify` or the factory smoke harness in `.factory/e2e/harness.mjs`.

## Outcome

A repeatable local run that shows whether an owner can onboard a business, set up sites and contractors, apply a week, lock it, and download remittance, and whether a second owner is refused with `404 not_found`.

## Do not

- Open or migrate production. The production origin is `https://cleantrack-timesheet.jeevan90wijerathna.workers.dev`. The runner throws if that host is the base URL.
- Pass `--remote` to Wrangler. `pnpm verify:e2e` applies migrations with `--local` and state under `.wrangler/verify-e2e-state`.
- Put real contractor names, rates, notes, tokens, or passwords in the report, the PR, or logs. The fixture is synthetic.
- Build contractor invite or the contractor portal here. Those are issues #46 and #47. Record them as not implemented until that UI exists.
- Edit `.factory/**` or `.github/**` as part of this run.

## Setup

From the repo root, on the branch you want to prove:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
```

`pnpm verify:e2e` builds only when `dist/server/wrangler.json` is missing. After a source change, run `pnpm build` or `pnpm verify` before the browser run so the served worker matches the branch.

Local auth is written to gitignored `.dev.vars` for `http://127.0.0.1:8788`. The runner deletes `.wrangler/verify-e2e-state` before migrating, so each run starts from an empty local database.

## Command

```bash
pnpm verify:e2e
```

That is `node scripts/verify-e2e.mjs --start-app`. It boots Wrangler on `127.0.0.1:8788`, drives Chromium headlessly, and writes `verify-e2e-output/REPORT.md` plus `verify-e2e-output/screenshots/`. Exit code is 1 when an implementable step fails. `not_implemented` does not fail the run.

Useful flags:

```bash
node scripts/verify-e2e.mjs --start-app --build --evidence docs/verification/e2e
node scripts/verify-e2e.mjs --base-url http://127.0.0.1:8788
node scripts/verify-e2e.mjs --start-app --headed
```

`--evidence` copies the report, `report.json`, and PNGs into that directory. Scratch logs stay in `verify-e2e-output/` and are gitignored.

## Seed data

`tests/e2e/payroll-fixture.mjs` is the roster. Emails gain a run id and use `@example.test`. The password stays in the runner and must not be copied into the report.

| Who | Site | What gets recorded | Rate used |
| --- | --- | --- | --- |
| Aroha Test | Harbour Wharf | Mon and Wed, 2h 00m, repeating schedule | default 2800 cents |
| Ben Test | Civic Tower | Tue, 3h 15m, repeating schedule | site override 3500 cents, not the 3250 default |
| Cara Test | Airport Lounge | Monday manual paid hours, 4h 30m | default 4000 cents |
| Dana Test | Harbour Wharf | Thursday 09:00–12:00, no break, clock entry | default 2200 cents |

Per entry, pay is `Math.round(paidMinutes * rateCents / 60)`. Week pay is the sum of those entry cents. The expected week is 5 entries, 885 minutes, 47175 cents.

| Site | Minutes | Cents |
| --- | ---: | ---: |
| Harbour Wharf | 420 | 17800 |
| Civic Tower | 195 | 11375 |
| Airport Lounge | 270 | 18000 |

`tests/verify-e2e-fixture.test.mjs` locks those numbers to `calculateEntryPayCents`.

## Flow

Labels below are the accessible names in the current UI.

1. **Register and onboard.** Open `/sign-up`. Fill Your name `Owner North`, a synthetic email, and the runner password. Submit Create account. The app lands on `/dashboard` with the heading Add your business. Fill Business name `Northwind Cleaning` and Contact email. Leave NZBN blank. Save business. Add Harbour Wharf in the Sites card (`+ Add site`, Site name, Site address, Save site). Add Aroha Test (Add contractor, Name, Email, Phone, Default hourly rate `28.00`, Save contractor). Assign her (`+ Assign to site`, Save assignment). Add her repeating schedule (Add repeating schedule, choose `Aroha Test — Harbour Wharf`, Mon and Wed, 2 hours, 0 minutes, Save schedule). Finish setup. The onboarding panel `[data-feature=owner-onboarding]` is gone.
2. **Sites and contractors.** Add Civic Tower and Airport Lounge. Add Ben Test at `32.50`, Cara Test at `40.00`, and Dana Test at `22.00`. `GET /api/dashboard?week=` returns 3 sites and those four default rates.
3. **Assignments and schedules.** Assign Ben to Civic Tower with Rate override `35.00`. Assign Cara to Airport Lounge and Dana to Harbour Wharf with a blank override. Add Ben's schedule for Tue only, 3 hours, 15 minutes. The week grid shows Aroha and Ben, and their entries use the snapshotted rates (2800 and 3500) and minutes (120 and 195).
4. **Week totals and approval.** Add Cara's Monday paid-hours shift (4 hours, 30 minutes) and Dana's Thursday clock shift (Start `09:00`, Finish `12:00`, Unpaid break `No break`). The Paid hours stat reads `14h 45m`. Contractor pay matches the browser `en-NZ` currency format of 47175 cents. By site (`[data-feature=week-site-summary]`) matches the site table above and sums to the contractor total. Approve week, confirm the dialog shows those totals, and expect the notice Week approved. plus the badge Week status: Approved & locked. A further `POST /api/time-entries` for Saturday returns `409` `week_locked`. The add-shift control is replaced by the locked hint.
5. **Remittance.** For each contractor, `GET /api/contractors/:id/remittance?week=` returns `application/pdf` while the week is locked. The PDF text contains Remittance Advice, the contractor, the site, the gross amount, and the snapshotted hourly rate. Ben's PDF contains `35.00` and does not contain `32.50`. The UI control is Download remittance for {name}, then Download remittance in the dialog. The notice reads Remittance downloaded.
6. **Cross-business isolation.** Sign out. Register Owner South and save Southwind Cleaning. The dashboard text does not contain the first business, its sites, or its contractors. `GET /api/sites/:id`, `/api/contractors/:id`, `/api/contractors/:id/remittance?week=`, `/api/assignments/:id`, and `/api/time-entries/:id` for the first owner's ids return `404` with `{ "error": "not_found" }`. Archived-inclusive lists do not contain those ids.
7. **Contractor invite and portal.** Do not invent this UI. Confirm the owner dashboard has no Invite button and that `/contractor` has no My week or My sites heading. Probe `/invite`, `/contractor`, `/contractors/portal`, `/api/invitations`, and `/api/contractors/:id/invite`. Record `not_implemented` with issues #46 and #47.

## Expected results

| Step id | Pass looks like |
| --- | --- |
| `register-onboarding` | Setup finished. Onboarding guide removed. |
| `sites-contractors` | 3 sites, 4 default rates 2800, 3250, 4000, 2200. |
| `assignments-schedules` | 4 assignments, 2 schedules, scheduled rows snapshotted. |
| `week-totals-approval` | 885 minutes, 47175 cents, site cents match, week locked, extra shift refused. |
| `remittance` | Four PDFs, override rate on Ben, UI download notice. |
| `cross-business-isolation` | Second owner sees none of the first business. Resource reads are 404. |
| `contractor-invite-and-portal` | `not_implemented` until #46 and #47 ship. A visible invite or My week heading is a failure, because this skill must be updated instead of ignored. |

## Evidence

Screenshots from a full run:

- `01-business-onboarding.png`, `01-site-step.png`, `01-onboarding-finished.png`
- `02-sites-contractors.png`
- `03-assignments-schedules.png`
- `04-week-totals.png`, `04-week-approved.png`
- `05-remittance-dialog.png`, `05-remittance-downloaded.png`
- `06-second-owner.png`
- `07-contractor-route.png`

A failure also writes `{step-id}-failure.png`.

Commit the evidence for a verification PR with `--evidence docs/verification/e2e`. Keep `verify-e2e-output/server.log` out of git. Do not paste request bodies or the password into the PR.

## PR preview

Use a preview origin only. Production stays refused even if the override is set.

```bash
VERIFY_E2E_ALLOW_PREVIEW=1 node scripts/verify-e2e.mjs \
  --base-url "$PREVIEW_URL"
```

The host must be `https` and contain `preview`. Do not point this at the production worker or the production D1 database. Signups on a preview create persistent preview users; keep the addresses on `@example.test`.

## When contractor access exists

Issues: [#46](https://github.com/jeevan-vj/timesheet/issues/46) invite and contractor sign-in, [#47](https://github.com/jeevan-vj/timesheet/issues/47) own work and remittance. The current product spec lists both as non-goals. When the absence check starts failing because the UI exists, change `contractor-invite-and-portal` from a not-implemented probe into the steps below. Do not enable them before the controls are real.

Invite (#46), after the owner roster exists:

1. Open the contractor row for a person who has an email.
2. Send invitation. The row shows pending.
3. Resend and revoke are visible for that pending invite. Revoke, then send again, and confirm the old acceptance path does not work.
4. In a fresh browser context, open the invitation as the invited person. Sign up or sign in with that same email.
5. Accept. The owner sees accepted. No second contractor row is created. Rates, assignments, and entries are unchanged.

Portal (#47), after acceptance:

1. Sign in as the contractor. The landing page is the contractor portal, not the owner dashboard.
2. My week shows only that contractor's scheduled and actual rows for the Monday week, with the same minutes and cents as the owner summary for that person.
3. My sites lists only that contractor's active sites.
4. Payments downloads only that contractor's remittance PDF, and the gross amount matches the owner PDF.
5. A second contractor session does not show the first contractor's name, sites, hours, or pay. Cross-id reads return a non-disclosing error.

## What this is not

`pnpm verify` is lint, unit tests, typecheck, and build. `pnpm verify:e2e` is the browser path. A green build does not prove the screens. The author of a change does not declare the product verified; the report is the observation a reviewer can check.
