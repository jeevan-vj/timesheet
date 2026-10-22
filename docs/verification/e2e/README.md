# Browser verification

CleanTrack UI changes require proof from the running application with synthetic data.

## Contractor invitation flow

Mailpit must be available on SMTP `127.0.0.1:1025` and UI/API `http://127.0.0.1:8025`. Install and start the local binary with Homebrew if needed:

```sh
brew install mailpit
mailpit
```

Do not start another Mailpit when one is already running. Configure `.dev.vars` locally (never commit it) with `EMAIL_PROVIDER=mailpit`, `EMAIL_FROM=noreply@example.test`, `MAILPIT_URL=http://127.0.0.1:8025`, and `APP_BASE_URL=http://127.0.0.1:3000`.

Run with the Playwright package already in the repository; do not run `playwright install`:

```sh
PW_CHANNEL=chrome npx pnpm@10.26.0 test:invites
```

The test uses the system Chrome channel when `PW_CHANNEL=chrome`, reads the message from Mailpit's API, and stores screenshots in `docs/verification/invites/`.
