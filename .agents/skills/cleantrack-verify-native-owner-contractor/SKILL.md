---
name: cleantrack-verify-native-owner-contractor
description: Verify installed CleanTrack React Native owner and contractor flows, work and remittance on an iOS simulator or Android emulator, separately from responsive web proof.
---

# Native owner and contractor verification

Use synthetic accounts and an isolated local Worker only. Read `.cursor/skills/verify-cleantrack/SKILL.md` for launch, doctor and cleanup; do not use production or `--remote`. Read `SPEC.md`, `SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md` and the relevant tests before execution. Preserve existing working-tree changes.

Record the git SHA, commands, platform, fixture week (Monday in Pacific/Auckland), expected and actual results, and screenshot paths under `docs/verification/owner-contractor/`. Never capture passwords, session cookies or invitation fragments. Mark each unmet criterion FAIL or BLOCKED with its cause; never infer a pass from source inspection. Run `pnpm install --frozen-lockfile`, `pnpm verify`, and `pnpm verify:mobile`; retain their output. Clean up only processes and disposable data owned by the run.

## Setup and evidence boundary

Read `apps/mobile/README.md`, `apps/mobile/app.config.ts`, `apps/mobile/src/api-config.mjs`, `apps/mobile/src/role-route.ts`, and the actual screens before driving. Use existing development build/start commands from `apps/mobile/package.json`; verify the resolved API origin is the isolated local backend. The API resolver defaults to production: never launch synthetic mutations with an unverified origin. Record platform, simulator/device id, installed bundle/version, runtime and source SHA. A reachable web page or Expo web export is not native evidence.

If no compatible installed development build/device is available, report native execution BLOCKED; do not publish an OTA or store build as a workaround. Reuse the web skill's synthetic invitation and payroll fixture, capturing its inbox locally. Do not claim native invite acceptance if acceptance actually occurred in a browser.

## Acceptance criteria

1. Sign in as owner: role routing opens owner workspace, Team lists the fixture contractor, invitation pending/active states are correct after refresh. Exercise add/invite using existing Team controls and verify the same row on web; capture Team without one-time links.
2. Sign out and sign in as contractor: route to contractor workspace, see only linked businesses and own work. Check the five fixture shifts total 600 minutes. Capture work screen. A dual-role user must switch workspace without retaining the wrong role's data.
3. Owner reviews and approves the same week. Contractor refresh shows approved NZD 320 gross and matching details. Open native remittance and exercise its PDF/share control if supported by the installed screen. Verify PDF content against the web fixture; dismiss the share sheet without sending it. Capture payment and remittance screens.
4. Sign out and confirm private screens cannot be reopened with stale session data. Exercise offline/error and retry states; mutations must not duplicate. Check a second contractor has no access to the first contractor's work/remittance.
5. Repeat on each requested platform. Record unsupported controls as gaps rather than silently substituting web. Screenshots must originate from the running native app with platform and stage in filenames.

Use `tests/mobile-owner-team.test.ts`, `tests/mobile-owner-mutations.test.ts`, `tests/mobile-contractor-view.test.ts`, `tests/mobile-api-client.test.ts`, and `tests/portal-routes.test.ts` as supporting checks, not substitutes for installed-app proof. Report native iOS, native Android, responsive web, API tests and PDF inspection as distinct results.
