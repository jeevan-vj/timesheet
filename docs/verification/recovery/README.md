# Auth and dashboard recovery verification

Scope: port the still-relevant local fixes onto main at `11e7e6a`.

## Acceptance criteria

- Rejected auth handlers return a generic, non-cacheable 503; normal responses and cookies pass through.
- Sign-in and sign-up connection failures show an accessible error and re-enable submission.
- Empty/invalid calendar input does not replace the selected Monday.
- Failed dashboard reads clear stale totals and actions and offer retry, including failure of the read after schedule application.
- A confirmed mutation keeps its success message when the following read fails; retry only reloads the week.

## Automated checks

`pnpm install --frozen-lockfile` and `pnpm verify` passed (lint, 521 tests, typecheck, build). New auth/date tests were observed failing before implementation and passing afterward. The local build warns that `OPS_BOT_TOKEN` is unset; the operator API is outside this change.

## Browser proof

Local vinext dev server, synthetic account only. Sign-in and sign-up were each submitted with the server stopped: both displayed the connection error and re-enabled the submit button. Screenshots:

- [Sign-in offline](sign-in-offline.png)
- [Sign-up offline](sign-up-offline.png)

Dashboard checks used controlled browser fetch fixtures after the synthetic account signed up. They verify the running React UI, not backend persistence:

- Initial failed load showed Retry instead of an endless spinner; retry with a valid response rendered the week.
- Clearing the date retained the selected Monday and rendered week.
- Approval returned success, then dashboard GET returned 503. The success notice remained, stale totals/actions disappeared, and Retry appeared.
- Retry fetched an approved/locked week; the approval write count stayed at one.
- Malformed JSON and rejected network reads also showed Retry without stale totals.

Screenshots: [Initial load failure](dashboard-load-failed.png), [confirmed save with failed refresh](saved-refresh-failed.png).

A separate read-only reviewer found no blocking authorization/payroll regressions. Existing limitation: HTTP auth errors retain the existing generic sign-in/sign-up copy; only rejected requests use the connection-error copy.

## Impact

No owner/business query, payroll calculation, historical rate, migration, or factory control-plane changes. The auth wrapper catches exceptions escaping Better Auth; it does not alter responses returned by Better Auth or its internal logging. No deployment configuration changes are required.
