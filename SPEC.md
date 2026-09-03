# CleanTrack Product Specification

## Goal

Give a small cleaning business one private place to record contractor shifts across multiple sites and calculate weekly pay accurately.

## MVP scope

### CT-001 Owner access

All business data is private to an authenticated owner. Every domain query and mutation derives `owner_user_id` from the server-side session.

### CT-002 Sites and contractors

Owners can create, list, view, edit, archive, and restore cleaning sites. Site names are unique per owner; a duplicate create, edit, or restore returns `duplicate_site` and does not write. Archive is a soft-delete of the same row (`active = false`) and, in the same batch, deactivates that site's owner-scoped active assignments. Restore sets the same row `active = true` and reactivates that site's currently-inactive assignments. Archived sites are omitted from the default list and cannot be selected for new assignments or time entries. Historical time entries keep the archived site's identity and snapshotted pay.

Owners can list, create, read, update, archive, and restore contractors. A contractor has a default hourly rate in integer cents and may work at many sites. Contractor names are unique per owner, including archived rows; different owners may share names. Archive deactivates the contractor and that owner's assignments for the contractor; it does not delete rows or time entries. Restore reactivates the same contractor row and those assignments. Dashboard contractor and site selects stay active-only.

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

### CT-005 Historical rate integrity

The effective hourly rate is copied onto every new time entry. Changing a contractor or assignment rate never rewrites historical `rate_cents`. Archived contractors remain readable by the owner; historical weeks keep the contractor name and snapshotted pay. Contractor update, archive, and restore never update or delete time entries.

Correcting an entry without changing contractor or site keeps the original snapshotted rate. Changing contractor or site snapshots the current assignment effective rate as a reclassification.

### CT-006 Weekly payroll

Weeks start on Monday in the business timezone. The dashboard groups entries by contractor and shows paid hours and gross contractor pay. Entry pay is `round(paid_minutes × rate_cents / 60)` and weekly pay is the sum of entry pay.

### CT-007 Money and time correctness

Money is stored as integer cents. Work dates are ISO calendar dates and times are minutes after local midnight. Floating-point hours are display-only.

### CT-008 Confirmed shift deletion

An owner can delete a recorded shift from the weekly dashboard. The delete control opens a confirmation that identifies the contractor, site, and work date. Cancel or closing the dialog leaves the entry unchanged and does not call DELETE. Confirm sends one owner-scoped DELETE for that entry, then refreshes the week using the existing success and error messaging.

### CT-009 Weekly approval and lock

An owner can approve a Monday–Sunday payroll week after confirming the current paid minutes and pay cents. Approval is an owner-scoped week status. A week with no approval row is open. Approving locks time-entry create, update, and delete for work dates in that week so reviewed totals cannot be edited by accident. Reopening sets the same row back to open and unlocks those writes. Site, contractor, and assignment CRUD stay allowed while a week is locked and must never rewrite historical `time_entry.rate_cents`. Approve and reopen never update time entries or persist totals. Expected totals that do not match the current owner-scoped week throw `stale_week_totals` and write nothing.

## Non-goals

- tax, holiday pay, GST, expenses, invoicing, or bank payments;
- contractor self-service and clock-in geolocation;
- overlapping/multi-shift days;
- accounting exports;
- multiple currencies inside one owner workspace.

## Definition of done

A feature is complete only when its acceptance criteria, tests, implementation, migration impact, security impact, and operator documentation are updated together.
