---
name: cleantrack-ios-testflight
description: Build, submit, and verify CleanTrack iOS production releases through Expo EAS and TestFlight. Use for store builds, signing setup, submission, or release-status checks. expo-updates is live; do not publish an OTA or dispatch force-update without explicit approval. Do not use for public App Store promotion.
---

# CleanTrack iOS TestFlight

Ship the intended source revision to internal TestFlight and report the furthest state actually verified. A successful EAS build, queued submission, or Apple upload is not by itself TestFlight availability.

## Authorization and invariants

- Require explicit user authorization before starting a billable EAS build or mutating Apple Developer/App Store Connect state. This skill does not provide that authorization.
- Do not promote to the public App Store, add external testers, create invitations, or expand beta distribution unless separately requested.
- Preserve the existing EAS project, Apple team, bundle identifier, entitlements, signing certificate, and App Store Connect app record. Do not revoke or replace shared credentials merely to simplify setup.
- Never print Apple passwords, tokens, private keys, session cookies, or credential file contents.
- Treat historical build numbers, credentials, submission IDs, and TestFlight state as stale. Query live state each time.
- OTA publishes are a separate approval. See OTA policy before any update command.

## Stable production identity

Verify these values from current configuration and EAS before release:

- App directory: `apps/mobile`
- Expo project: `@jnok/cleantrack`
- EAS project ID: `2ac1a147-bf37-4ee6-9274-d896f7bd87a9`
- Production bundle ID: `nz.co.jnok.cleantrack`
- App Store Connect app ID: `6827417051`
- Build/submit profile: `production`
- Production iOS runtime (fingerprint): `670b454382962443d6d68cf014905b1e42fbbdf5`

`apps/mobile/src/variant.mjs` defaults to `development` when `APP_VARIANT` is absent. The production build profile supplies the variable only to EAS Build; it is not automatically supplied while a local submit or status command evaluates the app config. Therefore prefix every local production config, submit, and App Store status command with `APP_VARIANT=production`. `pnpm -F mobile build:production` sets that variable for the EAS build it spawns.

If output mentions `CleanTrack (Dev)` or `nz.co.jnok.cleantrack.dev`, stop before confirming any mutation. Never submit the production artifact to that record. Do not delete or alter an unintended App Store Connect record without explicit authorization.

## Preflight

1. Read `AGENTS.md`, `SPEC.md`, `SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, and release-relevant tests/docs.
2. Fetch the requested upstream and record the remote, branch, exact commit, and working-tree state. Do not overwrite unrelated changes. Release from a clean checkout of the commit being released. `apps/mobile/scripts/check-release.mjs` refuses a tracked tree that differs from `HEAD`, and it requires `HEAD` to be on `origin/main` (on GitHub Actions, the `main` checkout at `GITHUB_SHA`).
3. From the repository root, run:

```bash
export COREPACK_HOME=~/.cache/node/corepack
pnpm install --frozen-lockfile
pnpm verify
pnpm verify:mobile
```

If pnpm is available only through Corepack, keep `COREPACK_HOME=~/.cache/node/corepack` and expose a temporary Corepack shim rather than changing project dependencies. Run `npx --yes expo-doctor@latest` from `apps/mobile`.

4. Resolve production config before touching Apple state:

```bash
APP_VARIANT=production pnpm --filter mobile exec expo config --type public --json
```

Confirm the resolved name is `CleanTrack`, bundle ID is `nz.co.jnok.cleantrack`, owner is `jnok`, and project ID matches the stable identity above.

5. Put pinned `eas-cli@25.3.0` on `PATH`. This is the same pin `.github/workflows/mobile-release.yml` installs. Do not use a floating `npx eas-cli` for the release.

```bash
npm install --prefix "$HOME/.cache/cleantrack-eas-cli" --ignore-scripts eas-cli@25.3.0
export PATH="$HOME/.cache/cleantrack-eas-cli/node_modules/.bin:$PATH"
eas --version
```

`eas --version` must report `25.3.0`. On GitHub Actions the workflow installs that package under `$RUNNER_TEMP/eas-cli` and prepends its `node_modules/.bin` to `PATH`.

6. Verify live EAS identity and the remote counter:

```bash
APP_VARIANT=production eas whoami
APP_VARIANT=production eas project:info
APP_VARIANT=production eas build:version:get --platform ios --profile production --non-interactive
```

## Fingerprint preflight

From `apps/mobile`, generate the iOS fingerprint with the same command the mobile-release decide job runs. Write the JSON outside the checkout so the tree stays clean. This command is local. It does not publish an update. Do not use `eas fingerprint:generate`; that uploads a fingerprint record.

```bash
fingerprint="$(mktemp)"
(
  cd apps/mobile
  APP_VARIANT=production ./node_modules/.bin/expo-updates fingerprint:generate --platform ios > "$fingerprint"
)
node apps/mobile/scripts/plan-release.mjs --print-hash "$fingerprint"
rm -f "$fingerprint"
```

The printed hash must be `670b454382962443d6d68cf014905b1e42fbbdf5`. That is the current production runtime (`runtimeVersion` policy `fingerprint` in `apps/mobile/app.config.ts`). If the hash differs, stop. Do not build, submit, or publish unless Jeevan has explicitly approved that new runtime. A different runtime is not OTA-compatible with the installed production binary.

## Signing setup

For an already configured project, prefer non-interactive builds. If EAS reports missing credentials, run `eas credentials --platform ios` interactively:

- select the `production` profile;
- sign in through the local Apple/EAS prompt without exposing secrets;
- reuse a valid existing distribution certificate when appropriate;
- create a provisioning profile specifically for `nz.co.jnok.cleantrack`;
- confirm EAS reports all credentials ready.

A build attempt may consume a remote build number before failing credential setup. Record that as an unused gap; do not rewrite Apple history to remove it.

## Build and submit the exact artifact

Canonical release command, from the repository root of the clean checkout, with `COREPACK_HOME` set and `eas-cli@25.3.0` on `PATH`:

```bash
COREPACK_HOME=~/.cache/node/corepack pnpm -F mobile build:production -- --auto-submit --non-interactive --no-wait
```

`apps/mobile/scripts/build-production.mjs` runs `checkRelease()` before EAS, then `eas build --platform ios --profile production` with the extra arguments. `--auto-submit` is the proven release path: the release guard and the fingerprint preflight run first, and EAS submits that build when it finishes. Do not start a release with a direct `eas build`.

Record the build ID from the EAS output. Poll that exact ID until `FINISHED`:

```bash
eas build:view BUILD_ID --json
```

Do not start a second submit for a build that used `--auto-submit`. Do not treat a failed build, a different revision, a non-production bundle ID, or the wrong profile as releasable.

Manual submit is only a fallback when that build was started without `--auto-submit`. After it is `FINISHED`, submit the same id:

```bash
APP_VARIANT=production eas submit --platform ios --profile production --id BUILD_ID
```

Poll a submission ID until `FINISHED` when one was returned:

```bash
eas submit:view SUBMISSION_ID --json
```

## Verify TestFlight, not only upload

Read Apple state through the production identity:

```bash
APP_VARIANT=production eas submit:status \
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

Internal availability does not prove installation or launch on a device. If device QA was not performed, say so.

## OTA policy

`expo-updates` is installed (`apps/mobile/package.json`, `update:production` runs `eas update --channel production`). `runtimeVersion` is fingerprint-based (`apps/mobile/app.config.ts`). The current production iOS runtime is `670b454382962443d6d68cf014905b1e42fbbdf5`. An update is offered only to binaries with that same runtime.

Never run `eas update`, `pnpm -F mobile update:production`, or a `mobile-release.yml` `force-update` dispatch without Jeevan's explicit approval.

`.github/workflows/mobile-release.yml` auto-publishes an OTA on a push to `main` when the decide job selects `path == update` (the fingerprint matches an existing production binary). The publish job runs `pnpm -F mobile update:production` as soon as `EXPO_TOKEN` exists on the `mobile-production` GitHub environment. Before that token is added, `mobile-production` must require Jeevan as a reviewer. Do not add `EXPO_TOKEN` until that protection is saved.

This skill does not run those publish commands.

## Handoff

Report the exact revision, version/build, bundle ID, fingerprint, EAS project/build/submission IDs, ASC app ID, Apple processing/internal/external states, verification results, and clean/dirty repository status. Call out unused build-number gaps, generated App Store display names, accidental records, or unverified device testing. State security, payroll, migration, and code-change impact. State whether an OTA was published (it must not be, unless Jeevan explicitly approved one).
