# Issue 39 — Recurring assignment schedules (schema)

Owner-scoped weekday templates for contractor/site assignments. This change lands the D1 table, `time_entry` columns, Drizzle types, and pure date/mask helpers only. Services, HTTP routes, and UI apply/exception writes are out of scope here.

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
| `scheduled` | Created by apply-schedule |
| `absent` | Scheduled day marked absent |
| `hours_override` | Scheduled day with different paid minutes |

`entry_mode` type is `"clock" \| "paid_hours" \| "absent"`. Absent exception rows are a later service concern; this migration does not insert them.

## Apply-schedule skip rules

Owner-scoped unique key remains one row per owner/contractor/site/date. For each expanded work date, if any `time_entry` row already exists for that key, skip that date (`shouldSkipExistingEntry` is true when the lookup returns a row). Do not overwrite manual, locked, or previously applied entries. Skip is per date; other dates in the week still apply.

Apply is an explicit mutation. It must still respect `week_locked` (later service). This change does not write entries.

## GET does not write

Dashboard GET, entry GET, and any future schedule preview/read must not insert `time_entry` or `assignment_schedule_version` rows. Expanding dates in `expandScheduledDates` is pure and has no DB I/O.

## Not in this change

Timesheet apply-schedule / exception writes, `summarizeWeek` behavior, HTTP routes, React UI, and product text in `SPEC.md` / `SECURITY.md` / `ARCHITECTURE.md` / `THREAT_MODEL.md` / `DEPLOYMENT.md` land with the API specialist and orchestrator after this schema slice.

## Migration / rollback

Forward: apply `drizzle/0003_recurring_schedules.sql` with the Worker that understands the new columns. Existing `time_entry` rows receive `occurrence_kind = 'manual'` and `schedule_version_id` NULL via the ALTER defaults; no pay backfill.

Rollback: leave the table and columns in place. Do not DROP. A Worker that does not read the new columns remains compatible with extra nullable/defaulted fields. Restoring a pre-`0003` Worker that SELECTs unknown columns would fail; deploy schema and Worker together going forward.
