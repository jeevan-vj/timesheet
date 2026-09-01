# Threat Model

## Protected assets

Contractor identity/contact data, site locations, rates, work notes, time records, pay totals, account credentials, sessions, and production configuration.

## Trust boundaries and mitigations

| Risk | Mitigation |
| --- | --- |
| One owner reads or mutates another owner's data | Server-derived owner ID plus owner predicates on every query and relation lookup |
| Client forges ownership or a relationship | APIs do not accept owner IDs; assignment and entry services verify owner-scoped contractor/site rows. Cross-owner assignment ids return `not_found` |
| Rate changes rewrite prior payroll | Effective assignment/default rate is snapshotted on entry creation; assignment PATCH never updates `time_entry` |
| Duplicate daily entry inflates pay | Unique owner/contractor/site/date index, pre-insert owner-scoped lookup, and a specific `duplicate_entry` error |
| Duplicate active assignment or extra rows for the same pair | Unique owner/contractor/site index; archived rows are reused instead of inserting duplicates; a second active create returns `duplicate_assignment` |
| Unassign deletes history | Unassign only sets `active=false`; time entries and snapshotted rates remain |
| Client forges an inline assignment | Inline restore/create still verifies owner-scoped active contractor and site rows before the entry is stored; `not_found` is not swallowed. Shift validation and duplicate-date checks run before the assignment write |
| CSRF creates or deletes records | Cookie-authenticated mutations require a configured trusted Origin |
| Accidental deletion of a recorded shift | Confirmation dialog before the existing owner-scoped DELETE; authorization and payroll math are unchanged |
| Money/time rounding drift | Integer cents and minutes; per-entry cent rounding is specified and tested |
| Sensitive data reaches logs | No request-body/domain logging; automated boundary test |
| Cloud agent reaches production | Cursor receives no production secrets; trusted GitHub workflows own merge/deploy gates |

## Residual risks

An authenticated owner can enter incorrect hours or rates. MVP totals are gross contractor payments, not tax or payroll advice. Production should add backups, audit events, MFA/SSO, approval states, and rate-limited abuse protection as the product grows.
