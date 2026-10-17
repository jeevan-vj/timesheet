# AGENTS.md

CleanTrack is a private contractor-hours and weekly-pay app. Behavior lives in [SPEC.md](SPEC.md), [SECURITY.md](SECURITY.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). This file is the boundary list.

## Architecture

vinext serves the React App Router on a Cloudflare Worker. D1 is the `DB` binding, accessed with Drizzle (`src/db/`, SQL in `drizzle/`). Better Auth stores users and sessions in that same database (`src/lib/auth.ts`, `src/app/api/auth/[...all]/route.ts`).

Tenancy is a business membership. The server resolves the session user, then the active `business_member` row with `role = owner`, and takes `business_id` from that row. Clients do not send `owner_user_id` or `business_id`.

`src/app/` is pages (`/`, `/sign-in`, `/sign-up`, `/dashboard`). `src/app/api/<resource>/route.ts` and `src/app/api/<resource>/[id]/route.ts` are HTTP. `src/services/` is owner-scoped reads and writes. `src/lib/` is payroll, validation, and auth. `src/components/` is the dashboard UI. Tests live in `tests/`.

Handlers call `authorize`, then a service, and `apiError` on failure. Known `Error.message` codes map to 4xx. Anything else is `500` `{ error: "internal_error", correlationId }` after `reportServerError` (query text stripped; no request body). Item reads map `business_required` to `404` through `readItemError`.

Cookie sessions are the product API. `/api/ops/*` is a bearer surface, not a browser session. It still resolves `business_id` on the server. `GET /api/health` returns the release and a D1 ping and is the readiness check.

`.factory/` is the intake, repair, and merge control plane. How to work inside it is [.factory/POTATO.md](.factory/POTATO.md). Do not add a second intake path.

## Commands

- `pnpm verify` — lint, test, typecheck, and build. This is the gate. Do not add a one-off check script beside it.
- `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm dev` (`vinext dev`, local D1, see README).
- `pnpm db:migrate:local` — `wrangler d1 migrations apply cleantrack-timesheet --local`.
- Local secrets stay in gitignored `.dev.vars` (copy from `.dev.vars.example`). Never commit them.
- `pnpm verify:e2e` is not on this branch. Browser proof is `.cursor/skills/verify-cleantrack/`. Factory CI smoke stays `.factory/e2e/harness.mjs`. The UI map is `.factory/feature-map.json`.

## Invariants

- Money is integer cents. Durations are integer minutes. Week and site rollups call `calculateEntryPayCents` on the snapshotted rate.
- New entries snapshot `rate_cents`. Later rate edits never rewrite historical `time_entry.rate_cents`.
- Migrations are forward-only. Never edit a file already applied under `drizzle/` (`0000_initial.sql` through `0005_ops_audit.sql` on this branch). Add the next file. `pnpm db:generate` only drafts it.
- `business_id` comes only from the server-resolved active owner membership.
- Cross-tenant get, update, archive, and restore return `404` `{ error: "not_found" }` and write nothing.
- Cookie mutations require a trusted `Origin` (`authorize(request, true)`). Otherwise `403`.
- Do not log contractor details, rates, notes, request bodies, tokens, or passwords.
- An approved week is locked. Entry create, update, and delete call `assertUnlockedWeek`.

## Do / don't

- Scope every domain query by the session owner and that membership's `business_id`.
- Add a test when the change is pay, authorization, or a new derivation.
- Run `pnpm verify`. For a UI change, run the verification skill and keep its evidence.
- Do not weaken a test or a validator so CI passes.
- Do not recompute historical pay from the current rate.
- Do not put `@cursor` on factory issues. Protected diffs stay human-gated.
- Do not log the bearer `OPS_BOT_TOKEN`. `/api/ops/*` resolves `business_id` from the body's `ownerUserId`, and raw SQL is not owner-scoped. Details are in the README, not here.

## Protected paths

Checks passing do not waive the human gate. The lists are [.factory/risk-policy.json](.factory/risk-policy.json).

- Protected: `AGENTS.md`, `.github/`, `.factory/`.
- High: auth, payroll, week rollup, validation, `src/db/`, `drizzle/`, `SECURITY.md`, `docs/THREAT_MODEL.md`, `wrangler.jsonc`.
- Protected and high-risk changes are never autonomously merged.
- Medium includes `package.json`, `pnpm-lock.yaml`, `src/app/api/`, and `src/services/`. Low includes `src/components/` and `tests/`.

One change, one branch, one PR. Say the outcome before editing. The author of a change does not call a screen verified because `pnpm verify` passed.

Factory review shorthand, when a PR needs it: P0 is cross-owner disclosure, payroll corruption, or credential exposure. P1 is an auth bypass, wrong pay, or a destructive migration. P2 is a requirement or test gap. P3 is maintainability. Factory PR text still names the closed issue, the plan, `pnpm verify`, security and payroll impact, and migration notes.
