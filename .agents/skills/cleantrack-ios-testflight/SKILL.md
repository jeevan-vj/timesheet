---
name: cleantrack-ios-testflight
description: Build, submit, and verify CleanTrack iOS production releases through Expo EAS and TestFlight. Use for CleanTrack iOS store builds, first-time Apple signing setup, TestFlight submission, or live release-status checks; do not use for Expo OTA updates or public App Store promotion.
---

# CleanTrack iOS TestFlight

Ship the intended source revision to internal TestFlight and report the furthest state actually verified. A successful EAS build, queued submission, or Apple upload is not by itself TestFlight availability.

## Authorization and invariants

- Require explicit user authorization before starting a billable EAS build or mutating Apple Developer/App Store Connect state. This skill does not provide that authorization.
- Do not promote to the public App Store, add external testers, create invitations, or expand beta distribution unless separately requested.
- Preserve the existing EAS project, Apple team, bundle identifier, entitlements, signing certificate, and App Store Connect app record. Do not revoke or replace shared credentials merely to simplify setup.
- Never print Apple passwords, tokens, private keys, session cookies, or credential file contents.
- Treat historical build numbers, credentials, submission IDs, and TestFlight state as stale. Query live state each time.

## Stable production identity

Verify these values from current configuration and EAS before release:

- App directory: `apps/mobile`
- Expo project: `@jnok/cleantrack`
- EAS project ID: `2ac1a147-bf37-4ee6-9274-d896f7bd87a9`
- Production bundle ID: `nz.co.jnok.cleantrack`
- App Store Connect app ID: `6827417051`
- Build/submit profile: `production`

`apps/mobile/src/variant.mjs` defaults to `development` when `APP_VARIANT` is absent. The production build profile supplies the variable only to EAS Build; it is not automatically supplied while the local submit command evaluates the app config. Therefore prefix every local production config, submit, and App Store status command with `APP_VARIANT=production`.

If output mentions `CleanTrack (Dev)` or `nz.co.jnok.cleantrack.dev`, stop before confirming any mutation. Never submit the production artifact to that record. Do not delete or alter an unintended App Store Connect record without explicit authorization.

## Preflight

1. Read `AGENTS.md`, `SPEC.md`, `SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, and release-relevant tests/docs.
2. Fetch the requested upstream and record the remote, branch, exact commit, and working-tree state. Do not overwrite unrelated changes. Release from the exact source the user authorized.
3. From the repository root, run:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm verify:mobile
```

If pnpm is available only through Corepack, expose a temporary Corepack shim rather than changing project dependencies. Run `npx --yes expo-doctor@latest` from `apps/mobile`.

4. Resolve production config before touching Apple state:

```bash
APP_VARIANT=production pnpm --filter mobile exec expo config --type public --json
```

Confirm the resolved name is `CleanTrack`, bundle ID is `nz.co.jnok.cleantrack`, owner is `jnok`, and project ID matches the stable identity above.

5. From `apps/mobile`, verify live EAS identity and the remote counter:

```bash
npx --yes eas-cli@25.3.0 whoami
npx --yes eas-cli@25.3.0 project:info
npx --yes eas-cli@25.3.0 build:version:get --platform ios --profile production --non-interactive
```

Use a newer supported CLI only after checking that the commands and JSON fields used below remain available.

## Signing setup

For an already configured project, prefer non-interactive builds. If EAS reports missing credentials, run `eas credentials --platform ios` interactively:

- select the `production` profile;
- sign in through the local Apple/EAS prompt without exposing secrets;
- reuse a valid existing distribution certificate when appropriate;
- create a provisioning profile specifically for `nz.co.jnok.cleantrack`;
- confirm EAS reports all credentials ready.

A build attempt may consume a remote build number before failing credential setup. Record that as an unused gap; do not rewrite Apple history to remove it.

## Build and submit the exact artifact

Start the build without auto-submit so its identity can be checked first:

```bash
APP_VARIANT=production npx --yes eas-cli@25.3.0 build \
  --platform ios \
  --profile production \
  --non-interactive \
  --no-wait \
  --json
```

Record the build ID, app version, build number, Git commit, bundle ID, profile, and fingerprint. Poll that exact ID until `FINISHED`:

```bash
npx --yes eas-cli@25.3.0 build:view BUILD_ID --json
```

Do not submit a build that failed, came from a different revision, resolved a non-production bundle ID, or used the wrong profile.

Submit the exact finished build. The environment prefix is mandatory:

```bash
APP_VARIANT=production npx --yes eas-cli@25.3.0 submit \
  --platform ios \
  --profile production \
  --id BUILD_ID
```

During first-time setup, ensure the production App Store Connect record is selected or created and record its ASC ID. Reuse the team-scoped App Store Connect API key already held by EAS when valid. Poll the returned submission ID until `FINISHED`:

```bash
npx --yes eas-cli@25.3.0 submit:view SUBMISSION_ID --json
```

## Verify TestFlight, not only upload

Read Apple state through the production identity:

```bash
APP_VARIANT=production npx --yes eas-cli@25.3.0 submit:status \
  --platform ios \
  --profile production \
  --json \
  --non-interactive
```

For the exact version/build, distinguish:

- EAS build `FINISHED`: `.ipa` exists.
- EAS submission `FINISHED`: upload completed.
- Apple `processingState: VALID`: Apple accepted and processed it.
- `internalState: IN_BETA_TESTING`: available for configured internal TestFlight testers.
- `externalState: READY_FOR_BETA_SUBMISSION`: not approved for external testers.

Internal availability does not prove installation or launch on a device. If device QA was not performed, say so. The production channel in `eas.json` does not enable OTA delivery while `expo-updates` is absent; do not imply otherwise.

## Handoff

Report the exact revision, version/build, bundle ID, EAS project/build/submission IDs, ASC app ID, Apple processing/internal/external states, verification results, and clean/dirty repository status. Call out unused build-number gaps, generated App Store display names, accidental records, or unverified device testing. State security, payroll, migration, and code-change impact.
