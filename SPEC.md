# CleanTrack Product Specification

## Goal

Give a small cleaning business one private place to record contractor shifts across multiple sites and calculate weekly pay accurately.

## MVP scope

### CT-001 Owner access

All business data is private to an authenticated owner. Every domain query and mutation derives `owner_user_id` from the server-side session.

### CT-002 Sites and contractors

Owners can create active cleaning sites and contractors. A contractor has a default hourly rate in integer cents and may work at many sites.

### CT-003 Site assignments

Owners can list, read, create, update the rate override, unassign (archive), and restore contractor-to-site assignments. An assignment may override the contractor's default hourly rate. The effective hourly rate is the assignment override, or the contractor default when the override is null (`rateInherited`).

The owner/contractor/site pair is unique. Creating an assignment for a pair that is already active returns `duplicate_assignment` and does not insert a second row. Creating for an archived pair reuses the same row: sets `active=true`, applies the submitted `rateCents` (including null), and keeps `id` and `createdAt`.

Unassign sets `active=false` and does not delete the row or historical time entries. Restore-by-id reactivates an archived pair only when both contractor and site are still active and owned; it does not change `rateCents`. Restore-by-pair (POST create on an archived row) applies the submitted rate.

Missing, inactive, or cross-owner contractor/site references return `not_found` with no writes. Inline `assignSite` on time-entry create is an explicit restore/create for that pair: it inserts a missing assignment, restores an archived pair (applying `assignSite.rateCents`), and does not rewrite an already-active override. Without `assignSite`, an archived or missing pair is `not_found` and no entry is created. Changing an assignment override never updates historical `time_entry.rate_cents` snapshots.

### CT-004 Daily time entries

An owner records a contractor, site, date, and paid duration. Paid duration is entered either as hours after unpaid breaks, or as start time, finish time, and unpaid break. Finish must be after start and paid time must remain positive. Overnight shifts are out of scope.

The contractor must be actively assigned to the site. The owner may assign the contractor to another active site from the same entry flow, with an optional site rate.

Only one entry per contractor/site/date is allowed in MVP. Duplicate attempts return a specific error and do not create a second entry. Entries may be replaced by editing in a future version.

### CT-005 Historical rate integrity

The effective hourly rate is copied onto every new time entry. Changing a contractor or assignment rate never changes historical pay.

### CT-006 Weekly payroll

Weeks start on Monday in the business timezone. The dashboard groups entries by contractor and shows paid hours and gross contractor pay. Entry pay is `round(paid_minutes × rate_cents / 60)` and weekly pay is the sum of entry pay.

### CT-007 Money and time correctness

Money is stored as integer cents. Work dates are ISO calendar dates and times are minutes after local midnight. Floating-point hours are display-only.

### CT-008 Confirmed shift deletion

An owner can delete a recorded shift from the weekly dashboard. The delete control opens a confirmation that identifies the contractor, site, and work date. Cancel or closing the dialog leaves the entry unchanged and does not call DELETE. Confirm sends one owner-scoped DELETE for that entry, then refreshes the week using the existing success and error messaging.

## Non-goals

- tax, holiday pay, GST, expenses, invoicing, or bank payments;
- contractor self-service and clock-in geolocation;
- overlapping/multi-shift days;
- payroll approval workflows or accounting exports;
- multiple currencies inside one owner workspace.

## Definition of done

A feature is complete only when its acceptance criteria, tests, implementation, migration impact, security impact, and operator documentation are updated together.
