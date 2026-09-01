# Threat Model

## Protected assets

Contractor identity/contact data, site locations, rates, work notes, time records, pay totals, account credentials, sessions, and production configuration.

## Trust boundaries and mitigations

| Risk | Mitigation |
| --- | --- |
| One owner reads or mutates another owner's data | Server-derived owner ID plus owner predicates on every query and relation lookup |
| Client forges ownership or a relationship | APIs do not accept owner IDs; assignment and entry services verify owner-scoped contractor/site rows |
| Cross-owner contractor get, update, archive, or restore | Identical `404 { error: "not_found" }` with no writes; owner predicates on every contractor and assignment query |
| Same-owner duplicate contractor name, including archived | Unique `(owner, name)` index; `409 { error: "duplicate_contractor" }` is same-owner only |
| Rate changes rewrite prior payroll | Effective assignment/default rate is snapshotted on entry creation; contractor rate edits never rewrite `time_entry.rate_cents` |
| Accidental contractor removal | Archive deactivates the contractor and assignments; no hard delete. Time entries use `ON DELETE RESTRICT`. Archive confirmation is a later UI concern |
| Duplicate daily entry inflates pay | Unique owner/contractor/site/date index, pre-insert owner-scoped lookup, and a specific `duplicate_entry` error |
| Client forges an inline assignment | Assignment create still verifies owner-scoped contractor and site rows before the entry is stored |
| CSRF creates or deletes records | Cookie-authenticated mutations require a configured trusted Origin |
| Accidental deletion of a recorded shift | Confirmation dialog before the existing owner-scoped DELETE; authorization and payroll math are unchanged |
| Money/time rounding drift | Integer cents and minutes; per-entry cent rounding is specified and tested |
| Sensitive data reaches logs | No request-body/domain logging; automated boundary test |
| Cloud agent reaches production | Cursor receives no production secrets; trusted GitHub workflows own merge/deploy gates |

## Residual risks

An authenticated owner can enter incorrect hours or rates. MVP totals are gross contractor payments, not tax or payroll advice. Production should add backups, audit events, MFA/SSO, approval states, and rate-limited abuse protection as the product grows.
