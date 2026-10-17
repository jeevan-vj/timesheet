# Approve and lock a week

## Sub-features

- Approve week asks for confirmation of the current minutes and gross pay.
- The badge becomes Week status: Approved & locked.
- Shift edits and deletes stay disabled until Reopen week.

## How to get to it (user POV)

On `/dashboard`, for the Monday week in the picker, press Approve week. The dialog title is Approve this week? The description names the paid duration and NZD gross pay. Press Approve week again to confirm, or Cancel. Reopen is Reopen week, then the dialog Reopen this week?

## Driving it with Playwright

```text
getByRole("button", { name: "Approve week" })
getByRole("heading", { name: "Approve this week?" })
getByRole("button", { name: "Approve week" })
getByLabel(/Week status: Approved & locked/)
```

The locked hint replaces + Add shift. `POST /api/time-entries` for a date in that week returns `409` `{ error: "week_locked" }`. Reopen uses `getByRole("button", { name: "Reopen week" })` and the heading Reopen this week?

## Gotchas

`POST /api/weeks/approve` needs the server-resolved owner business. A session with no business gets `409` `business_required` and the badge stays open. Finish business onboarding first. The confirm step sends the minutes and cents currently on screen; if a shift changes between open and confirm, the API returns `409` `stale_week`. An empty week can lock only after that business exists, with expected totals of 0 minutes and 0 cents. Do not approve a week you still need for the record-shift journey in the same database.
