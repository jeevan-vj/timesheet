---
name: verify-cleantrack
description: CleanTrack weekly-pay dashboard on a local Cloudflare Worker. Use when launching the app, checking it is the local build, driving the owner UI, and keeping evidence. Do not use against production or as a substitute for pnpm verify.
---

# Verify CleanTrack

Local browser proof for the vinext Worker. `pnpm verify` does not do this. Upkeep is `/maintain-verification-skill`.

`.cursor/skills/verify-e2e` from PR #66 is not on `main` (it sits on `cursor/factory-43-765e` only), and `pnpm verify:e2e` is absent. This skill does not copy that runner. Factory CI smoke remains `.factory/e2e/harness.mjs` (`health-ok`, `owner-signup`, `empty-week-dashboard`) and writes `factory-e2e-output/`. This skill uses its own port, persist dir, and `verify-cleantrack-output/`.

Synthetic data only. Never point the base URL at `cleantrack-timesheet.jeevan90wijerathna.workers.dev` or pass `--remote`. Do not print passwords, session tokens, contractor details, or rates.

There is no fixture seed. Launch migrates an empty local D1. Journeys that need a site, contractor, or assignment fail until those rows exist. See each feature's Gotchas.

A second instance is another `VERIFY_CLEANTRACK_PORT` and a different persist directory. Do not share `.wrangler/verify-cleantrack` across ports.

## Launch

From the repo root, after `pnpm install --frozen-lockfile` and `pnpm exec playwright install chromium`:

```bash
node .cursor/skills/verify-cleantrack/scripts/launch.mjs
```

That wipes `.wrangler/verify-cleantrack`, applies `drizzle/` with `wrangler d1 migrations apply cleantrack-timesheet --local`, builds `dist/server/wrangler.json` when it is missing, and starts `wrangler dev` on `127.0.0.1:3017` (`VERIFY_CLEANTRACK_PORT` overrides the port). Ready means `GET /api/health` is `{ status: "ok", database: "ok", release: "verify-cleantrack" }`. The log is `.wrangler/verify-cleantrack-run/server.log`. Interactive `pnpm dev` is the README server on its own port; it is not this isolated database.

## Doctor

Read-only. Process from the pid file is alive, `/api/health` is the launch release, something is listening on that port and is that process tree when `ss` prints a pid, and `GET /api/dashboard` with no cookie is `401` `{ error: "unauthorized" }`.

```bash
node .cursor/skills/verify-cleantrack/scripts/doctor.mjs
```

## Drive

Sign-up is the scripted journey. It opens `/sign-up`, fills Your name, Email, and Password, presses Create account, and waits for `/dashboard`.

```bash
node .cursor/skills/verify-cleantrack/scripts/drive.mjs --feature sign-up
```

Handles: `getByLabel("Your name")`, `getByLabel("Email")`, `getByLabel("Password")`, `getByRole("button", { name: "Create account" })`, then headings `Hours & contractor pay`, `Add your business`, and `No shifts this week`. The signed-in `GET /api/dashboard` must be `200` with `business: null`. Other features are driven with the same Playwright page against `http://127.0.0.1:3017` using the selectors in `features/`. Passing `--feature` other than `sign-up` exits 1.

## Evidence

After the drive, read the local D1 file under `.wrangler/verify-cleantrack` and record counts. No email, password, or token is written.

```bash
node .cursor/skills/verify-cleantrack/scripts/evidence.mjs
```

Pass is `user_count = 1`, `session_count >= 1`, `business_count = 0`, plus `verify-cleantrack-output/screenshots/sign-up.png`. The report is `verify-cleantrack-output/REPORT.md`.

## Cleanup

Kills only the pid from `.wrangler/verify-cleantrack-run/pid` and its children. Restores a previous `.dev.vars` if launch replaced one. Does not delete `verify-cleantrack-output/`.

```bash
node .cursor/skills/verify-cleantrack/scripts/cleanup.mjs
```

## Helpers

| Helper | Invocation |
| --- | --- |
| Launch | `node .cursor/skills/verify-cleantrack/scripts/launch.mjs` |
| Doctor | `node .cursor/skills/verify-cleantrack/scripts/doctor.mjs` |
| Drive sign-up | `node .cursor/skills/verify-cleantrack/scripts/drive.mjs --feature sign-up` |
| Evidence | `node .cursor/skills/verify-cleantrack/scripts/evidence.mjs` |
| Cleanup | `node .cursor/skills/verify-cleantrack/scripts/cleanup.mjs` |
