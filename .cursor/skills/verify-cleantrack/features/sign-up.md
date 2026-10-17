# Create owner account

## Sub-features

- Open `/sign-up` and submit name, email, and a password of at least 12 characters.
- Land on `/dashboard` still signed in.
- See the business onboarding step and an empty week. No `business` row yet.

## How to get to it (user POV)

From `/`, follow Create account, or open `/sign-up`. Enter Your name, Email, and Password. Press Create account.

## Driving it with Playwright

```bash
node .cursor/skills/verify-cleantrack/scripts/drive.mjs --feature sign-up
```

The helper uses `getByLabel("Your name")`, `getByLabel("Email")`, `getByLabel("Password")`, and `getByRole("button", { name: "Create account" })`. It then requires the headings `Hours & contractor pay`, `Add your business`, and `No shifts this week`, and `GET /api/dashboard` `200` with `business: null`.

## Gotchas

Launch must be a fresh migrated database. A second signup with the same email stays on `/sign-up` and shows "We could not create that account." The password is not written to evidence. Anonymous `GET /api/dashboard` is `401`, so the drive has to use the browser cookie.
