# Issue 39 — Recurring assignment schedules

Owner-scoped weekday templates for contractor/site assignments. Schema (`0003`), Drizzle types, and pure date/mask helpers land with the database slice. This document also records the HTTP and service contract for apply/exception writes.

## Schema

`assignment_schedule_version`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | |
| `owner_user_id` | text NOT NULL | FK `user(id)` ON DELETE CASCADE |
| `assignment_id` | text NOT NULL | FK `assignment(id)` ON DELETE RESTRICT |
| `weekdays_mask` | integer NOT NULL | bits below; no CHECK |
| `paid_minutes` | integer NOT NULL | integer minutes per scheduled day |
| `effective_from` | text NOT NULL | ISO date inclusive |
| `effective_to` | text NULL | ISO date inclusive; NULL = open-ended |
| `created_at` / `updated_at` | integer NOT NULL | unix timestamps |

Indexes:

- `assignment_schedule_version_owner_idx` on `owner_user_id`
- `assignment_schedule_version_assignment_idx` on `(owner_user_id, assignment_id, effective_from)` (non-unique)

No unique constraint beyond the primary key. Two owners may each store versions for their own assignments. Overlap of open-ended versions is a service rule, not a database CHECK.

`0003_recurring_schedules.sql` also ALTERs `time_entry` (same one-column ADD style as `0001_entry_mode.sql`):

- `occurrence_kind` text DEFAULT `'manual'` NOT NULL
- `schedule_version_id` text NULL

`time_entry_owner_contractor_site_date_uq` is unchanged.

Applied migrations `0000_initial.sql`, `0001_entry_mode.sql`, and `0002_week_approval.sql` are byte-stable and must not be edited. `0003` has no CHECK, DROP, or INSERT/backfill of pay data.

### `schedule_version_id` foreign key

SQLite/D1 `ALTER TABLE … ADD COLUMN` does not reliably attach an enforceable `REFERENCES` clause (existing ALTER style in `0001` also omits FKs). The column is a logical pointer to `assignment_schedule_version.id` without a D1 FK. Do not hard-delete versions in lieu of `ON DELETE SET NULL`; leave historical version rows in place. Drizzle matches the SQL: nullable text, no `.references()`.

## Weekday mask

ISO weekday `n` (Mon = 1 … Sun = 7) sets bit `1 << (n - 1)`:

Mon = 1, Tue = 2, Wed = 4, Thu = 8, Fri = 16, Sat = 32, Sun = 64. Mon–Fri = 31.

`encodeWeekdays` / `decodeWeekdays` reject empty or out-of-range values. Decode returns unique days sorted ascending.

## Version rules (for the later service)

- A version covers inclusive ISO dates `[effective_from, effective_to]`. `effective_to` NULL means open-ended.
- Going-forward replacement: `newEffectiveFrom` must be a Monday. Close the current open version with `effective_to` = that Monday minus one day (Sunday). Insert the new version with `effective_from` = that Monday. Pure helper: `planCloseAndOpenVersions`.
- Mid-week going-forward (`midWeekGoingForward`): Tue–Sun → `{ thisDayOnly: true, newEffectiveFrom: next Monday }`; Monday → `{ thisDayOnly: false, newEffectiveFrom: that Monday }`.
- First version `effective_from` may be any ISO date (including mid-week). `expandScheduledDates` includes a date in the Monday week iff the weekday bit is set AND `date >= effective_from` AND (`effective_to` is null OR `date <= effective_to`).
- `paid_minutes` and snapshotted `time_entry.rate_cents` stay integers. Applying a schedule copies the current assignment effective rate onto new rows only; never rewrite historical rates.

## `time_entry.occurrence_kind`

| Value | Meaning |
| --- | --- |
| `manual` | Owner-entered (default for all existing rows after `0003`) |
| `scheduled` | Created by apply-schedule. Pending until the owner confirms it. |
| `worked` | Scheduled day confirmed worked as scheduled. Paid minutes come from that row's schedule version. A later going-forward schedule change does not rewrite it. |
| `absent` | Scheduled day marked didn't work. `paid_minutes = 0`. |
| `hours_override` | Scheduled day with different paid minutes |

`entry_mode` type is `"clock" \| "paid_hours" \| "absent"`. Absent exception rows store `paid_minutes = 0` with `occurrence_kind = 'absent'` and do not change schedule versions.

## HTTP contract

| Method | Path | CSRF | Body | Success |
| --- | --- | --- | --- | --- |
| GET | `/api/assignments/:id/schedule` | no | — | `200 { current, versions }` |
| PUT | `/api/assignments/:id/schedule` | yes | `schedulePutInput` | `200` current open version |
| DELETE | `/api/assignments/:id/schedule` | yes | `{ weekStart }` Monday | `200 { ok: true }` |
| POST | `/api/weeks/apply-schedule` | yes | `{ weekStart }` | `200 { weekStart, inserted }` |
| POST | `/api/time-entries/:id/exception` | yes | `occurrenceExceptionInput` | `200` dashboard-shaped entry |

Ownership comes only from `authorize` (`ownerUserId` from the session). Cookie mutations use `authorize(request, true)`. Cross-owner ids return identical `404 { error: "not_found" }`. Errors: `invalid_request` 400, `invalid_week` 400, `payload_too_large` 413, `schedule_exists` 409, `no_schedule` 409, `week_locked` 409, `duplicate_entry` 409.

GET `/api/assignments` and GET `/api/assignments/:id` attach the current **open** version only (`effective_to IS NULL`, owner-scoped): `schedule: null | { id, weekdays, paidMinutes, effectiveFrom }`. Dashboard assignments use the same shape. Dashboard entries add `occurrenceKind` and `scheduleVersionId`. GET dashboard is a read: it must not insert or update `time_entry` or `assignment_schedule_version`.

PATCH `/api/assignments/:id` remains rate-only. `timeEntryInput` / `timeEntryUpdateInput` are unchanged: clients cannot POST `occurrenceKind: scheduled`, and `paidMinutes` min stays 1.

## Apply-schedule rules

Owner-scoped unique key remains one row per owner/contractor/site/date. For each expanded work date, if any `time_entry` row already exists for that key, skip that date (`shouldSkipExistingEntry` is true when the lookup returns a row). Do not overwrite manual, locked, or previously applied entries. Skip is per date; other dates in the week still apply.

`applyScheduleToWeek` is idempotent. It inner-joins active owned assignments with active owned contractor and site, so archived assignments are skipped and old entries remain. If a date's week is approved, skip that date (`inserted` may be 0). Do not throw `week_locked` for the whole apply.

Create mode inserts an open version (`effective_from = fromDate ?? weekStart`) then applies the submitted week. Going-forward closes the open version with `planCloseAndOpenVersions`, inserts a new open version from that Monday, updates unlocked unexcepted `scheduled` rows (`paid_minutes` / paid-hours sentinels / `schedule_version_id` only — never `rate_cents`), deletes unlocked unexcepted scheduled rows whose weekday left the mask, then applies. Approved-week actuals are not rewritten.

## Exception rules

Owner-scoped by entry id. Manual rows return `no_schedule`. If the work date's week is approved and `this_day` would change the row, return `week_locked`. Use `assertUnlockedWeek` for `this_day` writes.

- `absent` + `this_day`: `occurrence_kind=absent`, `entry_mode=absent`, paid/clock zeros. Do not change versions. Idempotent if already absent. Keep `rate_cents`. Didn't-work already persists on `occurrence_kind`; no extra column.
- `confirm_worked` + `this_day`: `occurrence_kind=worked`, `entry_mode=paid_hours`, `paid_minutes` restored from **this row's** `schedule_version_id` version. Keep `rate_cents`. Idempotent when the row already matches. Approved weeks that would change return `week_locked`.
- `worked_as_scheduled` + `this_day`: restore `paid_minutes` from **this row's** `schedule_version_id` version, `occurrence_kind=scheduled`, `entry_mode=paid_hours`. Keep original `rate_cents`. This is reset-to-scheduled, including undoing a confirmation.
- `hours_override` + `this_day`: set `paid_minutes`, `occurrence_kind=hours_override`. Keep `rate_cents`. Do not change versions or other dates.
- `hours_override` + `going_forward`: Monday of an unlocked week becomes `scheduled` under the new version. Tue–Sun keep this day as `hours_override` and open the new version from next Monday. If this week is approved, do not change this row; still persist a new version from next Monday without rewriting locked actuals.

Apply is an explicit mutation. GET must not write entries.

## GET does not write

Dashboard GET, entry GET, and any future schedule preview/read must not insert `time_entry` or `assignment_schedule_version` rows. Expanding dates in `expandScheduledDates` is pure and has no DB I/O.

## Not in this change

React UI / CSS for schedule editors and exception controls land with the frontend specialist after this API slice.

## Migration / rollback

Forward: apply `drizzle/0003_recurring_schedules.sql` with the Worker that understands the new columns. Existing `time_entry` rows receive `occurrence_kind = 'manual'` and `schedule_version_id` NULL via the ALTER defaults; no pay backfill.

Rollback: leave the table and columns in place. Do not DROP. A Worker that does not read the new columns remains compatible with extra nullable/defaulted fields. Restoring a pre-`0003` Worker that SELECTs unknown columns would fail; deploy schema and Worker together going forward.
