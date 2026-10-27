# CleanTrack Product Specification

## Goal

Give a small cleaning business one private place to record contractor shifts across multiple sites and calculate weekly pay accurately.

## MVP scope

### CT-001 Owner access

All business data is private to the authenticated user's active owner business. Every domain query and mutation derives `owner_user_id` from the server-side session and `business_id` from that user's active owner membership. The client never submits either id.

### CT-002 Sites and contractors

Owners can create, list, view, edit, archive, and restore cleaning sites. Site names are unique per owner; a duplicate create, edit, or restore returns `duplicate_site` and does not write. Archive is a soft-delete of the same row (`active = false`) and, in the same batch, deactivates that site's owner-scoped active assignments. Restore sets the same row `active = true` and reactivates that site's currently-inactive assignments. Archived sites are omitted from the default list and cannot be selected for new assignments or time entries. Historical time entries keep the archived site's identity and snapshotted pay.

Owners can list, create, read, update, archive, and restore contractors. A contractor has a default hourly rate in integer cents and may work at many sites. Contractor names are unique per owner, including archived rows; different owners may share names. Archive deactivates the contractor and that owner's assignments for the contractor; it does not delete rows or time entries. Restore reactivates the same contractor row and those assignments. Dashboard contractor and site selects stay limited to schedulable contractors.

The same contractor row stores an engagement profile: optional preferred name, optional start date (`YYYY-MM-DD`), engagement status (`draft`, `invited`, `active`, `suspended`, or `archived`), a GST-registered flag, an optional GST number (8 or 9 digits when supplied), optional internal notes, and optional emergency contact name and phone. GST fields are metadata only. They do not change entry pay, weekly totals, or remittance. Owners issue a portal invitation for an `invited` or `active` contractor (CT-016). Accepting that invitation links `contractor_account` and opens `/portal`. The read-only portal week, sites, and payments remain later slices (CT-017).

`engagement_status` is the lifecycle source of truth. The existing `active` flag remains what assignment, schedule, and dashboard selects read, and it stays true only for `invited` and `active`. `draft`, `suspended`, and `archived` cannot be newly assigned or scheduled: those creates return `not_found`. Migration `0006_contractor_engagement.sql` maps an existing `active = 1` row to `active` and an existing `active = 0` row to `archived`. It does not change time entries, rates, or paid minutes. A trigger rejects any other status. An update that changes `engagement_status` to a value that disagrees with `active` fails with `engagement_active_mismatch`. An update that changes only `active` is kept consistent: the row becomes `active` when the flag turns on and `archived` when it turns off. That keeps a pre-0006 archive or restore from aborting during the migration window.

The default contractor list includes every status except `archived`. `includeArchived` adds archived rows, so draft and suspended contractors stay visible and stay off shift-entry selects. Archive sets status `archived` and deactivates that owner's assignments. Restore sets status `active` and reactivates those assignments. Saving status `archived` does the same assignment deactivation. Saving `invited` or `active` over an archived contractor reactivates those assignments. Saving `draft` or `suspended` changes only the contractor row. Historical entries stay readable for every status.

Portal access is allowed only for `invited` and `active` (`contractorMayHoldPortalAccess`). `draft`, `suspended`, and `archived` must not receive a new invitation. Invitation create and resend enforce that rule. Accepting a pending invitation promotes `invited` to `active`. Portal week, sites, and payment routes are not in this change.

### CT-003 Site assignments

Owners can list, read, create, update the rate override, unassign (archive), and restore contractor-to-site assignments. An assignment may override the contractor's default hourly rate. The effective hourly rate is the assignment override, or the contractor default when the override is null (`rateInherited`).

The owner/contractor/site pair is unique. Creating an assignment for a pair that is already active returns `duplicate_assignment` and does not insert a second row, but only when both the contractor and site are still active and owned. Missing, inactive, or cross-owner contractor/site references return `not_found` with no writes, even if an assignment row already exists. Creating for an archived pair reuses the same row: sets `active=true`, applies the submitted `rateCents` (including null), and keeps `id` and `createdAt`.

Unassign sets `active=false` and does not delete the row or historical time entries. Restore-by-id reactivates an archived pair only when both contractor and site are still active and owned; it does not change `rateCents`. Restore-by-pair (POST create on an archived row) applies the submitted rate.

Missing, inactive, or cross-owner contractor/site references return `not_found` with no writes. Inline `assignSite` on time-entry create is an explicit restore/create for that pair: it inserts a missing assignment, restores an archived pair (applying `assignSite.rateCents`), and does not rewrite an already-active override. Paid duration and duplicate-date checks run before that assignment write, so an `invalid_shift` or `duplicate_entry` failure does not restore an archived pair. Without `assignSite`, an archived or missing pair is `not_found` and no entry is created. Changing an assignment override never updates historical `time_entry.rate_cents` snapshots.

### CT-004 Daily time entries

An owner records a contractor, site, date, and paid duration. Paid duration is entered either as hours after unpaid breaks, or as start time, finish time, and unpaid break. Finish must be after start and paid time must remain positive. Overnight shifts are out of scope.

The contractor must be actively assigned to the site. The owner may assign the contractor to another active site from the same entry flow, with an optional site rate. Inline assign-another-site remains create-only.

An owner can inspect a recorded shift and correct contractor, site, date, entry mode, duration or clock times, unpaid break, and notes. Correcting the work date may move the shift out of the currently displayed week; the week view then refreshes. Only one entry per owner/contractor/site/date is allowed. Duplicate create or update returns `duplicate_entry` and does not write a second row.

Edit requires an active same-owner assignment only when contractor or site changes. Duration, date, mode, and notes-only corrections keep the original rate snapshot.

Create, edit (including a date-move into or out of a locked week), and delete of a time entry are rejected with `week_locked` while that week is approved. GET inspect remains allowed until the week is reopened.

### CT-005 Historical rate integrity

The effective hourly rate is copied onto every new time entry. Changing a contractor or assignment rate never rewrites historical `rate_cents`. Archived contractors remain readable by the owner; historical weeks keep the contractor name and snapshotted pay. Contractor update, archive, and restore never update or delete time entries.

Correcting an entry without changing contractor or site keeps the original snapshotted rate. Changing contractor or site snapshots the current assignment effective rate as a reclassification.

### CT-006 Weekly payroll

Weeks start on Monday in the business timezone. The dashboard groups entries by contractor and shows paid hours and gross contractor pay. Entry pay is `round(paid_minutes × rate_cents / 60)` and weekly pay is the sum of entry pay. `summarizeWeek` still uses that formula only when `paid_minutes > 0`; 0-minute rows add 0 minutes and 0 cents and do not throw.

### CT-007 Money and time correctness

Money is stored as integer cents. Work dates are ISO calendar dates and times are minutes after local midnight. Floating-point hours are display-only.

### CT-008 Confirmed shift deletion

An owner can delete a recorded shift from the weekly dashboard. The delete control opens a confirmation that identifies the contractor, site, and work date. Cancel or closing the dialog leaves the entry unchanged and does not call DELETE. Confirm sends one owner-scoped DELETE for that entry, then refreshes the week using the existing success and error messaging. Confirmed delete of a shift in an approved week is rejected with `week_locked` until the week is reopened.

### CT-009 Weekly payroll approval

An owner can approve a Monday-start week after comparing the current owner-scoped paid minutes and gross pay to the totals they expect. Approval is a lock, not a second pay snapshot: `week_approval` stores only status and timestamps, never copied minutes, rates, or pay.

States:

- **Open** — no `week_approval` row. This is the default for every week, including empty weeks.
- **Approved** — create, edit, delete, and date-move of time entries in that week are rejected with `week_locked`. Dashboard GET and entry GET remain allowed.
- **Reopened** — writes are allowed again. `approvedAt` is kept; a later approve sets a new `approvedAt` and clears `reopenedAt`.

Approve is compare-and-set: if current totals do not match `expectedPaidMinutes` / `expectedPayCents`, the API returns `stale_week` and writes nothing. Matching 0/0 is allowed for an empty week. A second approve of an already-approved week with matching totals is idempotent and does not rewrite timestamps. Changing a contractor default or assignment rate after approve never rewrites historical `time_entry.rate_cents`.

### CT-010 Weekly remittance

An owner can download a weekly remittance advice PDF for one contractor. The PDF is generated on read from that owner's time entries for the requested Monday–Sunday week; there is no remittance table and no stored PDF. `GET /api/contractors/:id/remittance?week=YYYY-MM-DD` is a cookie-authenticated read and remains allowed while the week is approved (`week_locked` applies to time-entry writes only). A missing contractor or cross-owner id is `not_found`. An empty week fails closed with `no_entries` and no PDF. A week whose only rows are 0-minute absences is not empty; the PDF includes those lines at 0h/$0. The document is gross contractor pay only (before tax, GST, expenses, or adjustments) and uses canonical `summarizeWeek` / `calculateEntryPayCents` math on snapshotted entry rates and paid minutes. `summarizeWeek` still sums integer minutes and per-entry pay; 0-minute rows contribute 0 minutes and 0 cents and do not call `calculateEntryPayCents`. Archived contractors remain readable for historical weeks.

### CT-011 Recurring schedules

An assignment may have an optional weekday template stored as versioned `assignment_schedule_version` rows. Pay, remittance, and approval read only `time_entry` actuals. Applying a schedule materializes `occurrence_kind = scheduled` rows for dates in the requested Monday week; one-day exceptions never mutate schedule versions.

- **Create** writes an open version (`effective_from` may be mid-week) and applies that week. A second create while a version is open returns `schedule_exists`.
- **Going-forward** closes the open version on the Sunday before a Monday `weekStart`, inserts a new open version, rewrites unlocked unexcepted `scheduled` rows from that Monday (paid minutes and version id only — never `rate_cents`), deletes unlocked unexcepted scheduled rows whose weekday left the mask, then applies that week. Approved weeks are not rewritten.
- **Delete** closes the open version and does not delete time entries.
- **Apply** is idempotent and owner-scoped. Existing rows, approved dates, and archived assignments are skipped per date; apply never throws `week_locked` for the whole week.
- **Exceptions:** `absent` this day stores `paid_minutes = 0` and `occurrence_kind = absent`; `hours_override` this day changes that date only; `worked_as_scheduled` restores paid minutes from that row's historical version. `hours_override` going-forward opens a new version; Monday of an unlocked week becomes scheduled under the new version. Manual entries return `no_schedule`. Clients cannot POST `occurrenceKind: scheduled`; PATCH of a scheduled/absent/override duration becomes `hours_override`. Dashboard GET never inserts `time_entry` or `assignment_schedule_version` rows.

### CT-012 Site pay rollup

The weekly dashboard shows paid hours and gross pay grouped by site, next to the existing contractor summary. The rollup is derived in the browser from the time entries already returned for that owner and week. Each positive-minute entry contributes `calculateEntryPayCents(paidMinutes, rateCents)` using the snapshotted entry rate. A 0-minute row adds minutes only and does not call pay math. Site totals sum to the same minutes and cents as the contractor summary. Nothing is stored, and week approval still compare-and-sets the contractor summary only.

### CT-013 Copy week brief

An owner can copy a plain-text brief of the week they are viewing: the Monday–Sunday range, one line per contractor, one line per site, and the gross total. The brief includes names, durations, and pay only. It does not include rates, notes, email, or phone. Copy uses the clipboard and does not call an API. An empty week copies an explicit "No shifts this week." brief with a zero total.

### CT-014 Business workspace and owner onboarding

An authenticated user has one active owner business. `POST /api/business` creates the business and the owner membership together. The ids are server-derived: `biz_` plus the session user id, and `mem_` plus that user id. A later POST returns the stored profile and does not overwrite it. Cookie-authenticated creates still require a trusted origin when the request sends Origin, and `X-CleanTrack-Client: mobile/<version>` when it does not.

The profile stores a required name and contact email, an optional NZBN (blank or 13 digits), an optional address and phone, timezone `Pacific/Auckland`, currency `NZD`, and week start `monday`. Creating the business leaves onboarding incomplete. `POST /api/business/onboarding/complete` sets `onboarding_completed_at` once.

A user with no business still receives the empty weekly dashboard (`business: null`, no shifts). Domain mutations other than creating the business return `409 business_required` and write nothing. Collection reads used by that dashboard stay empty `200` responses.

The dashboard guides a new owner through the existing site, contractor, assignment, and optional repeating-schedule flows, then finishes on the same weekly dashboard. Refresh resumes from stored rows. Duplicate site, contractor, assignment, or schedule responses do not create a second implementation of those rules. Users migrated by `0004_business_workspace.sql` are already marked onboarded.

The migration copies each existing user onto one business and sets `business_id` on sites, contractors, assignments, schedule versions, time entries, and week approvals. It does not change `time_entry.rate_cents`, paid minutes, remittance math, or week-approval status and timestamps. Remittance still addresses the session user. A non-deterministic owner link or a blank user name or email aborts the migration.

Product slice: `owner membership -> business -> contractors + sites -> assignments (+ optional schedule versions) -> daily time entries -> weekly summary`.

### CT-015 Operator ops API

A single trusted bot calls `/api/ops/*` with `Authorization: Bearer` matching the `OPS_BOT_TOKEN` Worker secret. Session cookies are not accepted. Optional Cloudflare Access may sit in front of the path and does not replace the bearer check.

Contractor create, detail update, rate change, archive, and restore are owner-scoped. Archive and restore follow `archiveWritePlan` / `restoreWritePlan`. There is no contractor hard delete. Rate changes do not rewrite `time_entry.rate_cents`.

Time-entry add and adjust require a reason. The response flags a contractor day with more than 14 paid hours. Create, adjust, and revert of an approved week require `confirmLockedWeek: true`; otherwise the API returns `week_locked` and writes nothing.

Wage reads are owner-scoped for one Monday week, optionally one contractor or site, and use `summarizeWeek`, `summarizeWeekBySite`, and `weekPayrollTotals`.

`ops_audit` is append-only. Every ops write stores the action, SQL and parameters when the action is raw SQL, old and new JSON, reason, row count, and timestamp. `POST /api/ops/revert` restores a named contractor or time-entry action from that row. Raw SQL is not reverted by that action.

One `SELECT` runs immediately and returns at most 100 rows. `INSERT` and `UPDATE` return a dry-run count, a sample, and a short-lived confirm token, then execute only with that token. `DROP`, `ALTER`, `CREATE`, `PRAGMA`, `ATTACH`, every `DELETE`, multi-statements, and writes to `ops_audit` are rejected.

### CT-016 Contractor invitations

An owner invites one existing contractor to a later read-only portal. The invitation is owner-scoped and business-scoped. Cross-owner and cross-business ids return `404 { error: "not_found" }` and write nothing.

Create and resend require `contractorMayHoldPortalAccess` and a non-blank contractor email. A blank email returns `409 contractor_email_required`. A contractor who already has a `contractor_account` row returns `409 already_linked`. A second create while a pending row exists returns `409 invitation_exists` with the current state and does not mint a second token. Resend and revoke of a row that is not pending return `409 invitation_not_pending`. A resend within 60 seconds of `last_sent_at` returns `429 resend_too_soon` and does not rotate the token or send email. A resend whose stored `send_count` no longer matches the row just read returns `409 invitation_conflict` and does not send email.

The token is 32 random bytes, base64url. Only `sha256(token)` hex is stored. The link is `${BETTER_AUTH_URL}/invite#<token>`. The token is never in the path, the query, a GET response, or a log. The invitation expires 7 days after it is sent. Expired is `pending` and `expires_at < now`. Resend rotates the digest, refreshes the email snapshot, resets the 7-day window, and increments `send_count`. Revoke is allowed only while the row is pending, including when that pending row is already expired. Changing `contractor.email` to a different address (case-insensitive) revokes a pending invitation. Create sets `engagement_status` to `invited`.

`GET /api/contractors/:id/invitation` returns `state` (`none`, `pending`, `expired`, `accepted`, or `revoked`), `expiresAt`, `sendCount`, and `lastDelivery` (`email`, `link_only`, or `email_failed`). It never returns the token. Create and resend commit the row first, then try email, and return `{ invitation, delivery, inviteLink }` once so the owner can copy the link. Cookie-authenticated invitation mutations require a trusted origin when the request sends Origin, and `X-CleanTrack-Client: mobile/<version>` when it does not.

Email is one `POST https://api.resend.com/emails` from `src/lib/mailer.ts`. `EMAIL_FROM` is `CleanTrack <invites@jnok.co.nz>`. The optional Worker secret is provisioned as `docs/DEPLOYMENT.md` describes. When it is missing, or Resend returns an error or times out, the invitation stays pending and the response still includes `inviteLink`. The message subject is `<Business name> invited you to CleanTrack`. The body names the business and the contractor's first name and links to the fragment URL. It does not include rates, pay, or notes. `reply_to` is the business contact email. The idempotency key is `invite/<invitationId>/<sendCount>`. Operational logs may record `email_not_configured`, `email_send_failed`, or `email_dev_transport_refused` with `kind: invitation` and an optional `httpStatus`. They do not record the token, link, recipient, business name, request body, or provider body.

`MAIL_TRANSPORT=smtp-dev` sends that same message to a loopback SMTP inbox (`SMTP_HOST` defaults to `localhost`, `SMTP_PORT` defaults to `1025`) instead of Resend. If that socket cannot be opened, it posts to the inbox HTTP API on port `8025`. It is refused when `NODE_ENV` is `production`, or when the host is not `localhost`, `127.0.0.1`, or `::1`. The committed Worker var stays empty. Local setup is in `docs/DEVELOPMENT.md`.

`/invite` reads the token from the URL fragment only. `POST /api/invitations/preview` and `POST /api/invitations/accept` take the token in the JSON body. Both require a trusted `Origin`. Preview is limited to 30 requests per minute per client address and accept to 5. The rate-limit key is `invite-preview:<address>` or `invite-accept:<address>` and does not contain the token. A missing or untrusted origin is `403 forbidden` and does not consume the limit.

Preview of a pending, unexpired, eligible invite returns `200 { state: "ready", mode, businessName, email }`. `mode` is `setup` when the email has no user, `sign_in` when it does and nobody matching is signed in, and `accept` when the signed-in email matches. A signed-in different email returns `mode: "mismatch"` plus `signedInEmail`. Expired, revoked, already accepted, ineligible, or unknown tokens return `200 { state }` where `state` is `expired`, `revoked`, `used`, or `unknown`. That body has no email, business name, or account-existence field.

Accept of `setup` requires `password` and `passwordConfirm` to match and to be 12–128 characters. It creates the Better Auth user with the invited email, `emailVerified` true, name from the contractor, and a `credential` account (`issuer` `local:credential`, `accountId` equal to the user id). It inserts `contractor_account`, marks the invitation `accepted`, sets the contractor to `engagement_status` `active` when it was `invited`, and sets the session cookie. Those writes run in one D1 batch. Each statement inserts or updates only while the invite is still pending, so a revoke or rotation that wins the race writes nothing. D1 batch is not rollback-atomic; the statements are idempotent. A unique email conflict while the invite is still pending returns `409 sign_in_required` and does not replace an existing password.

An existing credential password is not overwritten. Accept then returns `409 sign_in_required`. The contractor signs in at `/sign-in?returnTo=/invite` and the page accepts without asking for a new password. A signed-in user whose email does not match returns `403 account_mismatch` and writes nothing. Accepting an already accepted invite with the same password issues a new session. A different password, or any other closed invite, returns `400` with `used`, `expired`, `revoked`, or `unknown` and does not say whether an account exists. Password errors are `400 password_mismatch` or `400 weak_password`. Success is `200 { ok: true }` plus `Set-Cookie`. The JSON body does not include the session token or the invite token.

The owner contractor row shows `Active (portal)` when the invitation is accepted and the contractor may hold portal access. Password reset is not in this change.

### CT-017 Contractor portal

`GET /api/me` returns `{ owner, contractorOf }` for the signed-in user. `owner` is the active owner business profile, or null. `contractorOf` lists active `contractor_account` links as `{ businessId, businessName }`. A signed-out request is `401`.

After sign-in, a user with no owner membership and at least one contractor link is sent to `/portal`. A user with no owner membership and no link still sees owner onboarding. A user who is both an owner and a contractor sees a switcher for the owner workspace and their contractor work. `/portal` is a placeholder. It does not show week entries, sites, rates, notes, or pay.

Sign-in and sign-up accept a same-origin `returnTo` of `/invite`, `/portal`, or `/dashboard`. Any other value, including an absolute URL, is ignored and the browser goes to `/dashboard`.

The read-only week, sites, and payments views and remittance download for contractors are later slices. Invitation acceptance is CT-016. No portal route accepts a client-supplied `contractorId`.

### CT-018 Mobile client scaffold

`apps/mobile` is an Expo dev-client for contractors. Email and password sign-in uses Better Auth’s Expo client and stores the session in the device secure store. Launch restores that session. Requests send `X-CleanTrack-Client: mobile/<version>` and, on a device, the session cookie with credentials omitted. The API base URL is `EXPO_PUBLIC_API_URL` or app config `extra.apiUrl`, otherwise the production Worker. Signed-out people see sign-in. Signed-in people see Home, My week, Pay, and Account. Home shows the session name and the role derived from `GET /api/me`. Account can sign out. Creating an account and resetting a password stay on the web. Owner tabs and in-app sign-up are later slices. Zod inputs, API error codes, week helpers, and money and minute formatting live in `@cleantrack/core`. The web app keeps importing `@/lib/payroll`, `@/lib/validation`, and `@/lib/week-rollup`.

## Non-goals

- tax, holiday pay, GST, expenses, invoicing, or bank payments;
- contractor time submission and clock-in geolocation;
- manager membership and an owner switching between businesses;
- overlapping/multi-shift days;
- accounting exports;
- multiple currencies inside one business workspace.

## Definition of done

A feature is complete only when its acceptance criteria, tests, implementation, migration impact, security impact, and operator documentation are updated together.
