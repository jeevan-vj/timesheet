---
name: verify-e2e
description: Run CleanTrack browser verification with synthetic data and capture review evidence.
---

# CleanTrack E2E verification

Use synthetic `example.test` identities only. Never print or capture real contractor details, tokens, rates, notes, passwords, or secrets.

For contractor invitations, install/start the Mailpit binary locally (for example `brew install mailpit` then `mailpit`) with SMTP on `127.0.0.1:1025` and its UI/API on `http://127.0.0.1:8025`. Do not start a second process when it is already running.

Set local runtime values to `EMAIL_PROVIDER=mailpit`, `EMAIL_FROM=noreply@example.test`, `MAILPIT_URL=http://127.0.0.1:8025`, and `APP_BASE_URL=http://127.0.0.1:3000`. Then run:

```sh
PW_CHANNEL=chrome npx pnpm@10.26.0 test:invites
```

The runner applies local D1 migrations, starts the local app, reads the invitation through the Mailpit HTTP API, and exercises owner invite → contractor authentication → acceptance → owner Accepted badge → contractor re-sign-in and landing. It also exercises an unavailable negative link and writes evidence beneath `docs/verification/invites/`.

Review every screenshot for synthetic-only content and confirm the browser shows the behavior, rather than relying only on exit status.
