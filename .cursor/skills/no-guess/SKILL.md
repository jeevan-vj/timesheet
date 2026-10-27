---
name: no-guess
description: >-
  If an API route, env var, schema column, Worker binding, or external service
  is not found in this repo, stop. Do not invent names. Add an explicit question
  to the PR or issue. Use whenever an agent is unsure about CleanTrack wiring.
---

# No-guess rule

## When

You need a route, env var, D1 column, Wrangler binding, secret, or third-party
API and you have not opened the defining file yet.

## Allowed sources (read these)

| Need | Look here |
| --- | --- |
| HTTP routes | `src/app/api/**/route.ts` |
| API errors | `src/lib/api.ts` (`apiError`) |
| Env / secrets | `wrangler.jsonc`, `src/lib/runtime-env.ts`, `SECURITY.md` |
| Schema | `src/db/schema.ts`, `drizzle/*.sql` |
| Feature reach | `.factory/feature-map.json` |
| Ops auth | `OPS_BOT_TOKEN` + `/api/ops/*` (bearer only) |
| Email | `RESEND_API_KEY`, `EMAIL_FROM`, `MAIL_TRANSPORT` |

## Steps

1. `rg` / open the files above. Quote the symbol you found.
2. If it is missing: **do not invent** `process.env.FOO`, a new `/api/...` path,
   or a column. Write an explicit question in the PR body under `## Open
   questions` (or comment on the factory issue) and stop that slice.
3. Never invent Cloudflare bindings, Better Auth options, or EAS profile names.
   Use what `eas.json` and `wrangler.jsonc` already declare.
4. For "how does X work?", prefer `docs/ARCHITECTURE.md` and `docs/specs/*`
   over guessing from memory of other apps.

## Done when

Every new symbol either (a) already existed in-repo and is cited, or (b) is
introduced with a migration / route / wrangler change that the plan called out.
