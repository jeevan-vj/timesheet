# Threat Model

## Protected assets

Contractor identity/contact data, site locations, rates, work notes, time records, pay totals, account credentials, sessions, and production configuration.

## Trust boundaries and mitigations

| Risk | Mitigation |
| --- | --- |
| One owner reads or mutates another owner's data | Server-derived owner ID plus owner predicates on every query and relation lookup |
| Client forges ownership or a relationship | APIs do not accept owner IDs; assignment and entry services verify owner-scoped contractor/site rows |
| Cross-owner site get, edit, archive, or restore | Owner-scoped site lookup returns `not_found`; no writes and no mention of other owners |
| CSRF creates or deletes records | Cookie-authenticated mutations, including site create/edit/archive/restore, require a configured trusted Origin |
| Duplicate site names collide inside an owner | Unique owner/name index; create, edit, and restore map unique failures to `duplicate_site` without writing |
| Archive is mistaken for hard-delete | Archive sets `active = false` and deactivates that site's assignments; the site row and historical time entries remain |
| Rate changes rewrite prior payroll | Effective assignment/default rate is snapshotted on entry creation |
| Duplicate daily entry inflates pay | Unique owner/contractor/site/date index, pre-insert owner-scoped lookup, and a specific `duplicate_entry` error |
| Client forges an inline assignment | Assignment create still verifies owner-scoped contractor and site rows before the entry is stored |
| Accidental deletion of a recorded shift | Confirmation dialog before the existing owner-scoped DELETE; authorization and payroll math are unchanged |
| Money/time rounding drift | Integer cents and minutes; per-entry cent rounding is specified and tested |
| Sensitive data reaches logs | No request-body, site name/address, or other domain logging; automated boundary test |
| Cloud agent reaches production | Cursor receives no production secrets; trusted GitHub workflows own merge/deploy gates |

## Residual risks

An authenticated owner can enter incorrect hours or rates. MVP totals are gross contractor payments, not tax or payroll advice. Production should add backups, audit events, MFA/SSO, approval states, and rate-limited abuse protection as the product grows.
