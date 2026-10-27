# Business onboarding

## Sub-features

- Save the business from the onboarding panel.
- Add a site, a contractor, and an assignment from Team & cleaning sites.
- Press Finish setup once a schedule step is the remaining guide. `[data-feature=owner-onboarding]` is gone after that.

## How to get to it (user POV)

Sign up, or sign in at `/sign-in`, and stay on `/dashboard`. The panel title is Add your business. Business name and Contact email are required. NZBN is blank or 13 digits. Timezone, currency, and week start are fixed (Pacific/Auckland, NZD, Monday). Press Save business. Later steps link to `#team` with Add a site, Add a contractor, and the assignment card. The last step's button finishes setup.

## Driving it with Playwright

Requires the sign-up session. On `[data-feature=owner-onboarding]`:

- `getByLabel("Business name")` and `getByLabel("Contact email")`, then `getByRole("button", { name: "Save business" })`.
- Site: open the `+ Add site` summary, `getByLabel("Site name")`, press Save site.
- Contractor: `getByRole("button", { name: "Add contractor" })`, labels Name and Default hourly rate (NZD), press Save contractor.
- Assignment: `+ Assign to site`, then Save assignment.
- Finish: the schedule step button that completes onboarding. There is no `GET /api/business`. `GET /api/dashboard` includes `business` after save, and `onboardingCompletedAt` is set only after finish.

## Gotchas

There is no seeded business. Skipping sign-up leaves the panel absent only when no session exists; the page redirects through auth. Saving a business with an empty name does not advance. A second `POST /api/business` returns the stored profile and does not overwrite it. Do not type a real NZBN or contact address into the report.
