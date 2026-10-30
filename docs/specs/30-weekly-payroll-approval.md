# Issue 30 — Weekly payroll approval (API lock)

Owner-scoped Monday week lock. Totals are compare-and-set only; `week_approval` stores no pay copy.

## Schema (already landed)

`week_approval`: `id`, `owner_user_id`, `week_start`, `status` (`approved` | `reopened`), `approved_at`, `reopened_at`, timestamps. Unique `(owner_user_id, week_start)`. No minutes, rate, or pay columns.

Missing row = **Open**.

## Week identity

`weekStartFromDate(isoDate)` → UTC Monday of that ISO date’s week. Sunday belongs to the previous Monday. Invalid ISO throws `invalid_week_start`.

## Totals

Owner-scoped `time_entry` rows with `work_date` in `[weekStart, weekEnd]`.

- `currentPaidMinutes` = sum of `paid_minutes`
- `currentPayCents` = sum of `calculateEntryPayCents` per entry with `paidMinutes > 0`

Empty week is `0` / `0`. Never persist expected totals. Never rewrite `time_entry.rate_cents`.

## Service

- `approveWeek(db, ownerUserId, { weekStart, expectedPaidMinutes, expectedPayCents })`
  - mismatch → `stale_week`, no writes
  - already approved → return existing timestamps
  - reopened → new `approvedAt`, `reopenedAt = null`
  - missing → insert approved
- `reopenWeek(db, ownerUserId, { weekStart })`
  - missing → `week_not_approved`
  - already reopened → existing timestamps
  - approved → `reopened`, keep `approvedAt`
- `assertUnlockedWeek(db, ownerUserId, workDate)` → `week_locked` when status is approved

Create checks the lock after `invalid_shift` and before inline `assignSite`. Update checks existing and target work dates. Delete selects owner-scoped first, then locks, then deletes.

## HTTP

| Method | Path | CSRF | Errors |
| --- | --- | --- | --- |
| POST | `/api/weeks/approve` | trusted origin | `400 invalid_week`, `400 invalid_request`, `409 stale_week` |
| POST | `/api/weeks/reopen` | trusted origin | `400 invalid_week`, `409 week_not_approved` |
| POST/PATCH/DELETE | `/api/time-entries` | trusted origin | `409 week_locked` |

Dashboard GET stays `authorize(request)` and adds `approval` without `id` or `ownerUserId`.

Owner ID comes only from the session. Cross-owner rows are invisible.

## Mobile owner client

Owner Week and Payroll show an explicit confirmation before approve or reopen. Approve sends the same `paidMinutes` and `payCents` currently displayed from the dashboard summary; reopen sends only the selected Monday. The mobile request wrapper supplies the authenticated cookie and `X-CleanTrack-Client` header. These mutations are not optimistic and are never automatically retried. `stale_week`, `week_locked`, and `week_not_approved` trigger a dashboard refetch so the owner must review current server state before confirming again. Owner dashboard and pay data are not persisted locally.
