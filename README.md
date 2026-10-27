# CleanTrack

Contractor hours and weekly pay tracking for multi-site cleaning teams.

## Stack

- Next-compatible App Router via vinext
- React 19
- Cloudflare Workers + D1
- Drizzle ORM
- Better Auth
- Zod
- Vitest

## Local development

```bash
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

Then create the first owner account at `/sign-up` and open `/dashboard`. Local invitation mail is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Verification

```bash
pnpm verify
```

`pnpm verify` is the paved path: lint, test, typecheck, and build. See [.factory/POTATO.md](.factory/POTATO.md) for how agents specify, implement, verify, and ship on top of the existing factory.

See [SPEC.md](SPEC.md), [SECURITY.md](SECURITY.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [.factory/SETUP.md](.factory/SETUP.md), [.factory/control-plane.md](.factory/control-plane.md), and [.factory/e2e-evidence.md](.factory/e2e-evidence.md).

## Operator API

`/api/ops/*` is a bearer-token API for one trusted operator bot. It uses the Worker `DB` binding. Set `OPS_BOT_TOKEN` with `wrangler secret put OPS_BOT_TOKEN` (it is listed in `secrets.required`). The Worker compares `Authorization: Bearer <token>` in constant time and does not log the token. A browser session cookie is not accepted.

Optional Cloudflare Access can sit in front of the `/api/ops` path (an Access application plus a service token). Access is an extra gate. The Worker still requires `OPS_BOT_TOKEN`.

Domain routes take `ownerUserId` and derive `business_id` from that user's active owner membership. Raw SQL is not owner-scoped; the bearer token is the authorization for it. Contractor deactivation uses archive/restore. There is no contractor hard delete. Time-entry writes require `reason`. A contractor day over 14 paid hours returns `longDay: true` and still saves. A week locked by approval returns `week_locked` unless the body sets `confirmLockedWeek: true`. Wage reads use `summarizeWeek` and `weekPayrollTotals`.

`POST /api/ops/sql` runs one `SELECT` immediately, capped at 100 rows. `INSERT` and `UPDATE` return a dry-run row count, a sample, and a confirm token that expires after 5 minutes. `POST /api/ops/sql/execute` runs that statement only with the token. `DROP`, `ALTER`, `CREATE`, `PRAGMA`, `ATTACH`, every `DELETE`, comments, multi-statements, any write to `ops_audit`, and any `UPDATE` that assigns `contractor.active` are rejected. Lifecycle changes go through the contractor archive and restore routes. Each write appends an `ops_audit` row. `POST /api/ops/revert` undoes a named contractor or time-entry action by audit id. Raw SQL is not reverted that way.

Replace the host and token below. Do not send real contractor details in tickets or logs. Contractor create, update, archive, restore, and undo responses omit GST number, internal notes, and emergency contact.

```bash
curl -sS -H "Authorization: Bearer $OPS_BOT_TOKEN" \
  "https://cleantrack-timesheet.jeevan90wijerathna.workers.dev/api/ops/wages?ownerUserId=USER_ID&week=2026-08-31"

curl -sS -H "Authorization: Bearer $OPS_BOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"ownerUserId":"USER_ID","name":"Aroha","email":"","phone":"","defaultRateCents":3200,"reason":"Add contractor"}' \
  https://cleantrack-timesheet.jeevan90wijerathna.workers.dev/api/ops/contractors

curl -sS -H "Authorization: Bearer $OPS_BOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"sql":"SELECT id, name FROM contractor WHERE owner_user_id = ?","params":["USER_ID"]}' \
  https://cleantrack-timesheet.jeevan90wijerathna.workers.dev/api/ops/sql

curl -sS -H "Authorization: Bearer $OPS_BOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"sql":"UPDATE contractor SET phone = ? WHERE id = ? AND owner_user_id = ?","params":["","CONTRACTOR_ID","USER_ID"]}' \
  https://cleantrack-timesheet.jeevan90wijerathna.workers.dev/api/ops/sql

curl -sS -H "Authorization: Bearer $OPS_BOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"sql":"UPDATE contractor SET phone = ? WHERE id = ? AND owner_user_id = ?","params":["","CONTRACTOR_ID","USER_ID"],"confirmToken":"TOKEN_FROM_DRY_RUN","reason":"Clear a stale phone"}' \
  https://cleantrack-timesheet.jeevan90wijerathna.workers.dev/api/ops/sql/execute
```

Named-action revert is `POST /api/ops/revert` with `{ "ownerUserId", "auditId", "reason", "confirmLockedWeek" }`. To put the D1 database back to an earlier point in time, use Cloudflare D1 Time Travel from an operator workstation (`wrangler d1 time-travel info cleantrack-timesheet`, then `wrangler d1 time-travel restore`). That restore is outside this API. Do not run it against production from an agent session. Raw SQL writes are not undone by audit revert; Time Travel is the backstop for those.
