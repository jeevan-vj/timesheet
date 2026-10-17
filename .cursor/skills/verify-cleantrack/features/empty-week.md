# Empty week

## Sub-features

- The Monday–Sunday heading and This week control.
- The empty-state heading No shifts this week.
- Copy week brief still runs on a zero week.
- By site shows the empty copy until shifts exist.

## How to get to it (user POV)

Sign in and open `/dashboard`. Use This week, or the Week of date, or Previous week / Next week. Before any shift, the grid area says No shifts this week. Payment totals say they appear as shifts are added.

## Driving it with Playwright

```text
getByRole("button", { name: "This week" })
getByRole("heading", { name: "No shifts this week" })
locator("[data-feature=copy-week-brief]")
locator("[data-feature=week-site-summary]")
```

Press Copy week brief. The status text is the page's live announcement that the brief was copied. The clipboard text has a zero total and no email address.

## Gotchas

A brand-new account still shows No shifts this week under the onboarding panel. That is the empty week. If a shift was recorded earlier in this database, the heading is gone and this journey does not pass. Launch's empty database is the precondition. Do not delete shifts to force the empty state during a later journey.
