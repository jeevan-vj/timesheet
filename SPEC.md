# CleanTrack Product Specification

## Goal

Give a small cleaning business one private place to record contractor shifts across multiple sites and calculate weekly pay accurately.

## MVP scope

### CT-001 Owner access

All business data is private to an authenticated owner. Every domain query and mutation derives `owner_user_id` from the server-side session.

### CT-002 Sites and contractors

Owners can create, list, view, edit, archive, and restore cleaning sites. Site names are unique per owner; a duplicate create, edit, or restore returns `duplicate_site` and does not write. Archive is a soft-delete of the same row (`active = false`) and, in the same batch, deactivates that site's owner-scoped active assignments. Restore sets the same row `active = true` and reactivates that site's currently-inactive assignments. Archived sites are omitted from the default list and cannot be selected for new assignments or time entries. Historical time entries keep the archived site's identity and snapshotted pay.

A contractor has a default hourly rate in integer cents and may work at many sites.

### CT-003 Site assignments

Owners can assign contractors to sites. An assignment may override the contractor's default hourly rate. Cross-owner references are rejected.

### CT-004 Daily time entries

An owner records a contractor, site, date, and paid duration. Paid duration is entered either as hours after unpaid breaks, or as start time, finish time, and unpaid break. Finish must be after start and paid time must remain positive. Overnight shifts are out of scope.

The contractor must be actively assigned to the site. The owner may assign the contractor to another active site from the same entry flow, with an optional site rate. Inline assign-another-site remains create-only.

An owner can inspect a recorded shift and correct contractor, site, date, entry mode, duration or clock times, unpaid break, and notes. Correcting the work date may move the shift out of the currently displayed week; the week view then refreshes. Only one entry per owner/contractor/site/date is allowed. Duplicate create or update returns `duplicate_entry` and does not write a second row.

Edit requires an active same-owner assignment only when contractor or site changes. Duration, date, mode, and notes-only corrections keep the original rate snapshot.

### CT-005 Historical rate integrity

The effective hourly rate is copied onto every new time entry. Changing a contractor or assignment rate never changes historical pay.

Correcting an entry without changing contractor or site keeps the original snapshotted rate. Changing contractor or site snapshots the current assignment effective rate as a reclassification.

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
