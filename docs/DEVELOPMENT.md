# Local development

## App

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

Open `http://localhost:3000`. `pnpm dev` is the local Worker dev server. A production build refuses the dev mail transport below, including `pnpm start` of that build.

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

`MAIL_TRANSPORT` is an empty Worker var so this local override is injected. Leave it empty in `wrangler.jsonc`. `smtp-dev` is refused when `NODE_ENV` is `production`, when `SMTP_HOST` is not `localhost`, `127.0.0.1`, or `::1`, or when the port is not an integer from 1 to 65535. A refused dev transport does not fall back to Resend.

`scripts/invite-accept-e2e.mjs` runs the owner invite, inbox, password, `/portal`, sign-out, and sign-in flow against this inbox. It is not part of `pnpm verify`.
