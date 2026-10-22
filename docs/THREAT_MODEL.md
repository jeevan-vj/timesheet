# Threat Model

## Protected assets

Contractor identity/contact data, site locations, rates, work notes, time records, pay totals, account credentials, sessions, and production configuration.

## Trust boundaries and mitigations

| Risk | Mitigation |
| --- | --- |
| One owner reads or mutates another owner's data | Server-derived owner ID plus owner and business predicates on every query and relation lookup |
| Client forges a business id | APIs ignore `businessId` in JSON. The active business comes from the session user's owner membership. Phase-1 ids are `biz_<user id>` and `mem_<user id>` |
| Client forges ownership or a relationship | APIs do not accept owner IDs; assignment and entry services verify owner-scoped and business-scoped contractor/site rows. Cross-business ids return `not_found` |
| User with no business mutates domain rows | Mutations other than `POST /api/business` return `409 business_required` and write nothing. Dashboard and collection reads stay empty `200` responses |
| Migration maps an owner to the wrong business | `0004` uses one scalar membership lookup per row and aborts when that lookup is ambiguous, a user has not exactly one active membership, related rows disagree on owner, or any `business_id` stays null. It does not rewrite rate snapshots or approval timestamps |
| Business profile reaches logs | No request-body, business name, NZBN, address, contact email, or phone logging |
| Cross-owner contractor get, update, archive, or restore | Identical `404 { error: "not_found" }` with no writes; owner predicates on every contractor and assignment query |
| Cross-owner site get, edit, archive, or restore | Owner-scoped site lookup returns `not_found`; no writes and no mention of other owners |
| Same-owner duplicate contractor name, including archived | Unique `(owner, name)` index; `409 { error: "duplicate_contractor" }` is same-owner only |
| Duplicate site names collide inside an owner | Unique owner/name index; create, edit, and restore map unique failures to `duplicate_site` without writing |
| Duplicate active assignment or extra rows for the same pair | Unique owner/contractor/site index; archived rows are reused instead of inserting duplicates; a second active create returns `duplicate_assignment` |
| Rate changes rewrite prior payroll | Effective assignment/default rate is snapshotted on entry creation; contractor and assignment rate edits never rewrite `time_entry.rate_cents` |
| Accidental contractor removal | Archive deactivates the contractor and assignments and sets `engagement_status` to `archived`; no hard delete. Time entries use `ON DELETE RESTRICT`. Archive requires accessible confirmation naming the contractor; cancel or close does not call archive |
| Cross-owner read or edit of engagement notes, GST number, or emergency contact | Same `404 { error: "not_found" }` with no writes. Those columns are read only with owner and business predicates. Responses omit `ownerUserId` and `businessId` |
| Draft, suspended, or archived contractor is newly assigned | `active` is derived from `engagement_status`. A status change that disagrees with `active` aborts. An active-only write is aligned to `active` or `archived`. Assignment and time-entry creates still require `contractor.active` |
| GST metadata changes historical pay | Payroll and remittance read snapshotted `time_entry` rows only. GST columns are not inputs to `calculateEntryPayCents` |
| Suspended or archived contractor keeps portal access | Account role joins `contractor_user` to contractor on contractor, owner, and business keys and permits only `invited` or `active`. `/contractor` resolves the session and role on the server before rendering; the link is retained so restored access can recover. |
| Archive is mistaken for hard-delete | Archive sets `active = false` and deactivates that site's assignments; the site row and historical time entries remain |
| Unassign deletes history | Unassign only sets `active=false`; time entries and snapshotted rates remain |
| Duplicate daily entry inflates pay | Unique owner/contractor/site/date index, pre-insert owner-scoped lookup, pre-update lookup that excludes the current entry id, and a specific `duplicate_entry` error |
| Client forges an inline assignment | Inline restore/create still verifies owner-scoped active contractor and site rows before the entry is stored; `not_found` is not swallowed. Shift validation and duplicate-date checks run before the assignment write; updates never create assignments |
| Rate changes rewrite prior payroll on duration-only edit | PATCH preserves the stored rate snapshot unless contractor or site changes |
| Reclassify to another contractor or site | Update snapshots the current assignment effective rate only when contractor or site changes, and only after an owner-scoped active assignment join |
| CSRF creates, updates, or deletes records | Cookie-authenticated mutations (POST, PATCH, DELETE), including site, contractor, and assignment create/edit/archive/restore, require a configured trusted Origin |
| Cross-owner inspect, update, or delete | Owner-scoped GET, PATCH, and DELETE return a non-disclosing `not_found` 404 |
| Accidental deletion of a recorded shift | Confirmation dialog before the existing owner-scoped DELETE; authorization and payroll math are unchanged |
| Accidental edit or delete of an approved week | Approve locks the owner-scoped week; create/update/delete and date-move throw `week_locked` with no writes until reopen |
| CSRF approves or reopens a week | Cookie-authenticated POST `/api/weeks/approve` and `/api/weeks/reopen` require a configured trusted Origin |
| One owner approves or reopens another owner's week | `week_approval` lookups and writes use the session owner plus week start; foreign rows are invisible (`open` / `week_not_approved`) |
| Approve commits stale hours or pay | Compare-and-set on current owner-scoped minutes and entry-snapshot pay; mismatch returns `stale_week` with no insert or timestamp bump |
| Money/time rounding drift | Integer cents and minutes; per-entry cent rounding is specified and tested |
| Owner downloads another owner's remittance PDF | Session-derived owner plus owner predicates on contractor, time entry, and contractor/site joins; missing and cross-owner ids return identical `not_found` |
| Remittance generation mutates a locked week | Remittance is generate-on-read and does not write `time_entry` or `week_approval`; `week_locked` applies to time-entry writes only |
| Remittance PDF is cached or mixed with error JSON | Generate-on-read; success is `application/pdf` with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; empty weeks and other failures return JSON only |
| Cross-owner schedule get, put, delete, apply, or exception | Session owner plus owner predicates on assignment, `assignment_schedule_version`, and time entry; missing and cross-owner ids return identical `not_found` and do not write |
| CSRF creates or replaces a schedule, applies a week, or posts an exception | Cookie-authenticated PUT/DELETE `/api/assignments/:id/schedule`, POST `/api/weeks/apply-schedule`, and POST `/api/time-entries/:id/exception` require a configured trusted Origin |
| GET dashboard materializes scheduled actuals | Dashboard GET, entry GET, and schedule GET are reads; they do not insert or update `time_entry` or `assignment_schedule_version`. Apply is an explicit mutation |
| Going-forward rewrite changes an approved week or historical rates | Unexcepted `scheduled` rewrites skip approved weeks and never set `rate_cents`. Locked actuals stay in place while later open weeks can still receive a new version |
| Absence counted as paid time | Absent rows store `paid_minutes = 0` and `occurrence_kind = absent`. `summarizeWeek` / remittance line pay skip `calculateEntryPayCents` when minutes are 0 |
| Duplicate daily entry from apply-schedule | Unique owner/contractor/site/date index; apply skips any existing row for that key and does not throw `duplicate_entry` |
| Apply restores an archived assignment | Apply inner-joins `assignment.active = true` with active owned contractor and site; archived assignments are skipped and historical entries remain |
| Site rollup or week brief recomputes pay from current rates | Both are derived from the owner-scoped dashboard entries already loaded; positive minutes use `calculateEntryPayCents` on the snapshotted `rateCents`. No new route, write, or log |
| Week brief leaves the browser | Copy is an explicit owner action of names, durations, and totals already on screen. The text omits rates, notes, email, and phone, and it is not sent to an API |
| Unexpected server error returns driver text | JSON API failures return `500 { error: "internal_error", correlationId }` and do not return driver text. Logs and optional Sentry events are scrubbed |
| Sensitive data reaches logs | No request-body, business profile, site name/address, PDF bytes, contractor, rate, or pay logging. Query failures are redacted to `query_failed` without SQL or bound values. Concrete `/invite/<token>` and `/api/invites/<token>/...` segments in routes, messages, and stacks become `[token]` before console or Sentry output. Cloudflare automatic invocation logs and traces are disabled because pre-Worker request URLs cannot be scrubbed. Optional `SENTRY_DSN` is a Worker secret and receives the same scrub; automated boundary tests force an invite-route failure. |
| Cloud agent reaches production | Cursor receives no production secrets; trusted GitHub workflows own merge/deploy gates |
| Ops bot token is guessed or logged | `OPS_BOT_TOKEN` is a Worker secret. Authorization is `Bearer` only, compared by SHA-256 digest. Missing or empty secrets fail closed. The token, confirm tokens, SQL, and parameters are not logged |
| Session cookie calls the ops API | `/api/ops/*` ignores the owner session and returns `unauthorized` without a matching bearer token |
| Ops request names another owner's rows | Contractor, time-entry, and wage queries filter by the requested `ownerUserId` and that user's active owner business. A foreign id is `not_found` or an empty week |
| Ops SQL drops tables, deletes rows, or rewrites the audit log | One statement only. `DROP`, `ALTER`, `CREATE`, `PRAGMA`, `ATTACH`, `DELETE`, comments, and multi-statements are rejected. Writes to `ops_audit` are rejected. `INSERT`/`UPDATE` commit only with an unexpired single-use confirm token whose row count still matches. Triggers abort `UPDATE` and `DELETE` on `ops_audit` |
| Ops rate change or revert rewrites historical pay | Contractor rate edits and rate reverts update `contractor.default_rate_cents` only. Time-entry revert restores the snapshotted `rate_cents` from the audit row |
| Ops edit bypasses an approved week by accident | Time-entry create, update, delete, and revert call the week lock. `confirmLockedWeek: true` is required to proceed. A day over 14 paid hours is flagged on the response |
| Raw SQL cannot be expressed as a named revert | `POST /api/ops/revert` restores named contractor and time-entry actions only. D1 Time Travel is the operator backstop for other writes |

## Contractor invitation threats

| Threat | Control |
| --- | --- |
| Token guessing or database disclosure | 32 random bytes from `crypto.getRandomValues`; email receives base64url while D1 stores only a SHA-256 digest. |
| Link replay or transition race | Acceptance compare-and-sets exact digest, `pending`, unexpired timestamp, normalized invited email, scoped contractor keys, and current `invited`/`active` status. A unique acceptance nonce conditionally gates the link insert and activation in the same D1 batch; every write must affect one row. Accepted, revoked, expired, malformed, missing, raced, and replayed tokens share `invite_unavailable`. |
| Invite creation races suspension or archive | Creation uses a conditional invite insert that rechecks contractor id, owner, business, recipient email, and `invited`/`active` status in the D1 batch. Contractor activation requires that exact insert, and affected-row checks reject the stale operation without an invite. |
| Old link after resend | Resend compare-and-sets the previously read digest, status, expiry, owner, and business before replacing the digest and seven-day expiry. A stale acceptance of the old digest cannot claim or create a link. |
| Resend or revoke overwrites another transition | Both owner writes match the previously read digest, status, and expiry and require one affected row. Resend also requires the contractor recipient email and eligible status read for delivery to remain unchanged. A CAS loser returns the same owner-side `not_found` and sends no email. |
| Wrong account signs up or accepts | Invite sign-up derives the account email from the server-side token snapshot and returns generic account-creation failures. Acceptance independently compares the normalized authenticated account email with that same snapshot; the read-only browser field is display-only. |
| Cross-business invite id | Owner operations derive owner and business from the session and filter both invite and contractor joins by both keys; misses are uniform 404s. |
| Duplicate contractor identity | Acceptance inserts only `contractor_user` and updates the existing contractor; it never inserts a contractor. Unique indexes allow one accepted identity per business/contractor. |
| Email/account enumeration | Owner and accept responses are generic and do not report whether an unrelated Better Auth account exists. |
| Token or PII leakage | Owner APIs omit raw tokens. Invite HTML and API responses are `no-store`. Token path segments are normalized before application reporting, and automatic edge invocation logs/traces are disabled. Logging of recipient, link, body, token, and provider response is prohibited; transport errors are canned. |
| Email configuration fails after invitation mutation | Provider credentials, sender, and HTTP(S) app base URL are validated before create/resend services run. Missing or malformed configuration returns canned `email_not_configured` with no database write. |
| Accidental production Mailpit | Mailpit is refused unless both app and Mailpit URLs use loopback hostnames. Production has no provider by default. |

## Residual risks

An authenticated owner can enter incorrect hours or rates. MVP totals are gross contractor payments, not tax or payroll advice. Production should add backups, audit events, MFA/SSO, and rate-limited abuse protection as the product grows. The MVP weekly approval lock (open / approved / reopened) is already in place.
