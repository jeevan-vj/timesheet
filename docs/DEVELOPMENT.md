# Local development

## App

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

Open `http://localhost:3000`. `pnpm dev` is the local Worker dev server. A production build refuses the dev mail transport below, including `pnpm start` of that build.

## Checks

`pnpm verify` checks the web app: lint, test, web typecheck, `packages/core` typecheck, and the vinext build. `pnpm verify:mobile` typechecks `packages/core`, then typechecks and lints `apps/mobile`. Core stays on both commands so a web-only run still typechecks the shared package.

GitHub Actions still runs the web lint, test, typecheck, and build steps and does not run the mobile app. CI will need a path-filtered job later for changes under `apps/mobile` (core is already typechecked by `pnpm verify`). Do not add that job until the workflow change is in scope.

## Invitation inbox

Production sends contractor invitations through Resend. Locally, capture them in Mailpit:

```bash
docker run --rm -d --name cleantrack-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
```

SMTP is `127.0.0.1:1025`. The inbox UI is `http://127.0.0.1:8025`. The message list is `GET http://127.0.0.1:8025/api/v1/messages`.

In `.dev.vars` (not committed):

```bash
MAIL_TRANSPORT=smtp-dev
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
```

`MAIL_TRANSPORT` is an empty Worker var so this local override is injected. Leave it empty in `wrangler.jsonc`. `smtp-dev` is refused when `NODE_ENV` is `production`, when `SMTP_HOST` is not `localhost`, `127.0.0.1`, or `::1`, or when the port is not an integer from 1 to 65535. A refused dev transport does not fall back to Resend. If the Worker runtime cannot open the SMTP socket, the same dev transport posts the message to Mailpit's HTTP API at `http://<SMTP_HOST>:8025/api/v1/send` (`SMTP_HTTP_PORT` overrides 8025).

`scripts/invite-accept-e2e.mjs` runs the owner invite, inbox, password, `/portal`, sign-out, and sign-in flow against this inbox. It is not part of `pnpm verify`.
