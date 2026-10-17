# Record a shift

## Sub-features

- Add a site, a contractor, and an assignment.
- Open Add a completed shift, save paid hours or a same-day clock time.
- The week grid shows the row. Pay uses the snapshotted assignment rate.

## How to get to it (user POV)

On `/dashboard`, finish the Team & cleaning sites cards: `+ Add site` (Site name, Save site), Add contractor (Name, Default hourly rate (NZD), Save contractor), `+ Assign to site` (Save assignment). Then press + Add shift. Choose Contractor, Site, and Date. Paid hours uses Hours and Minutes. Clock uses Start, Finish, and the break control. Press Save shift.

## Driving it with Playwright

The sheet is `getByRole("heading", { name: "Add a completed shift" })`. Entry method is the radiogroup `Entry method`. Save is `getByRole("button", { name: "Save shift" })`. The grid is `getByRole("grid", { name: "Weekly timesheet" })`. After save, `GET /api/dashboard?week=` includes the entry, and `time_entry.rate_cents` in local D1 equals the assignment rate at save time. Changing the assignment rate afterward leaves that cents value.

## Gotchas

No seed ships with launch. With no contractor, the dashboard shows "Add a contractor before recording a shift." and + Add shift is absent. With no site, the message is "Add a site before recording a shift." A contractor and a site without an assignment still opens the sheet; save then fails and the row is not stored. Do not skip the assignment to make the click succeed. An approved week replaces + Add shift with "This week is approved and locked. Reopen it to add a shift."
