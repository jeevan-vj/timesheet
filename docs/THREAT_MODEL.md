# Threat Model

## Protected assets

Contractor identity/contact data, site locations, rates, work notes, time records, pay totals, account credentials, sessions, and production configuration.

## Trust boundaries and mitigations

| Risk | Mitigation |
| --- | --- |
| One owner reads or mutates another owner's data | Server-derived owner ID plus owner predicates on every query and relation lookup |
| Client forges ownership or a relationship | APIs do not accept owner IDs; assignment and entry services verify owner-scoped contractor/site rows |
| Rate changes rewrite prior payroll | Effective assignment/default rate is snapshotted on entry creation. Duration/date/mode/notes-only edits keep that snapshot and do not re-read current rates |
| Silent reprice on duration-only edit | PATCH preserves the stored rate snapshot unless contractor or site changes |
| Reclassify to another contractor or site | Update snapshots the current assignment effective rate only when contractor or site changes, and only after an owner-scoped active assignment join |
| Duplicate daily entry inflates pay | Unique owner/contractor/site/date index, pre-insert owner-scoped lookup, pre-update lookup that excludes the current entry id, and a specific `duplicate_entry` error |
| Client forges an inline assignment | Assignment create still verifies owner-scoped contractor and site rows before the entry is stored; updates never create assignments |
| CSRF creates, updates, or deletes records | Cookie-authenticated mutations (POST, PATCH, DELETE) require a configured trusted Origin |
| Cross-owner inspect, update, or delete | Owner-scoped GET, PATCH, and DELETE return a non-disclosing `not_found` 404 |
| Accidental deletion of a recorded shift | Confirmation dialog before the existing owner-scoped DELETE; authorization and payroll math are unchanged |
| Money/time rounding drift | Integer cents and minutes; per-entry cent rounding is specified and tested |
| Sensitive data reaches logs | No request-body/domain logging; automated boundary test |
| Cloud agent reaches production | Cursor receives no production secrets; trusted GitHub workflows own merge/deploy gates |

## Residual risks

An authenticated owner can enter incorrect hours or rates. MVP totals are gross contractor payments, not tax or payroll advice. Production should add backups, audit events, MFA/SSO, approval states, and rate-limited abuse protection as the product grows.
