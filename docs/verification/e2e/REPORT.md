# CleanTrack local end-to-end evidence

Observed at 2026-10-15T21:07:22.220Z against `http://127.0.0.1:8788`.
Head `782ab30691f7035c062e239efdfe142addc7efdc`. This file records what the browser run observed. It is not a product sign-off.

## Steps

| Step | Result | What was observed |
| --- | --- | --- |
| `register-onboarding` | pass | Synthetic owner onboarded for week 2026-10-12. |
| `sites-contractors` | pass | 3 sites and 4 contractors stored with distinct default rates. |
| `assignments-schedules` | pass | 4 assignments. Aroha and Ben schedules materialized scheduled entries at snapshotted rates. |
| `week-totals-approval` | pass | 5 entries, 885 minutes, 47175 cents. Site cents match the contractor total. Week locked. |
| `remittance` | pass | Each contractor PDF contains the snapshotted gross amount. The browser saved the PDF. The week stayed locked. |
| `cross-business-isolation` | pass | Second owner lists are empty of the first business. Direct site, contractor, assignment, entry, and remittance reads return 404 not_found. |
| `contractor-invite-and-portal` | not_implemented | No invite control and no contractor portal. Probes: /invite 404, /contractor 404, /contractors/portal 404, /api/invitations 404, /api/contractors/645e0f69-b3bd-406d-93c2-edbfbdae1632/invite 404, /api/contractors/645e0f69-b3bd-406d-93c2-edbfbdae1632/invitations 404. Issue #46 (invite and contractor sign-in) and issue #47 (own work and remittance) are still open. |

## Fixture

Synthetic names only. Pay is `round(paidMinutes × rateCents / 60)` per entry, then summed.

Week `2026-10-12`. Total 885 minutes and 47175 cents.

| Contractor | Default cents | Snapshotted cents | Minutes | Pay cents |
| --- | ---: | ---: | ---: | ---: |
| Aroha Test | 2800 | 2800 | 240 | 11200 |
| Ben Test | 3250 | 3500 | 195 | 11375 |
| Cara Test | 4000 | 4000 | 270 | 18000 |
| Dana Test | 2200 | 2200 | 180 | 6600 |

## Screenshots

- `register-onboarding`: screenshots/01-business-onboarding.png
- `register-onboarding`: screenshots/01-site-step.png
- `register-onboarding`: screenshots/01-onboarding-finished.png
- `sites-contractors`: screenshots/02-sites-contractors.png
- `assignments-schedules`: screenshots/03-assignments-schedules.png
- `week-totals-approval`: screenshots/04-week-totals.png
- `week-totals-approval`: screenshots/04-week-approved.png
- `remittance`: screenshots/05-remittance-dialog.png
- `remittance`: screenshots/05-remittance-downloaded.png
- `cross-business-isolation`: screenshots/06-second-owner.png
- `contractor-invite-and-portal`: screenshots/07-contractor-route.png

## Bugs

No product bug was observed in the implementable steps.

## Not implemented

- `contractor-invite-and-portal` (not_implemented): https://github.com/jeevan-vj/timesheet/issues/46, https://github.com/jeevan-vj/timesheet/issues/47. No invite control and no contractor portal. Probes: /invite 404, /contractor 404, /contractors/portal 404, /api/invitations 404, /api/contractors/645e0f69-b3bd-406d-93c2-edbfbdae1632/invite 404, /api/contractors/645e0f69-b3bd-406d-93c2-edbfbdae1632/invitations 404. Issue #46 (invite and contractor sign-in) and issue #47 (own work and remittance) are still open.

