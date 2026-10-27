# CleanTrack mobile (Expo)

Expo SDK 58 contractor app (`expo-router`, Better Auth Expo client). Bundle id `nz.co.jnok.cleantrack` when `APP_VARIANT=production` (`.preview` / `.dev` otherwise). EAS project `@jnok/cleantrack`. Local scripts set `APP_VARIANT=development` so a dev-client keeps the `.dev` bundle id.

## Local commands

```sh
pnpm -F mobile start
pnpm -F mobile typecheck
pnpm -F mobile lint
```

The API origin and bundle id live in `src/api-config.mjs` and `src/variant.mjs`. Payroll and validation come from `@cleantrack/core`.

## Checks

From the repository root:

```
pnpm --filter mobile typecheck
pnpm --filter mobile lint
pnpm --filter mobile test
```

`npx expo-doctor` runs in this directory. CI runs those four commands on every pull request.

## Store submit

`eas submit` loads `app.config.ts` before it reads the submit profile, and a submit profile has no `env` field. Build-profile `env` is not applied. With `APP_VARIANT` unset, the config resolves the store bundle id `nz.co.jnok.cleantrack` (development and preview stay explicit).

`submit.production` also pins that bundle id and the App Store Connect app:

- `ios.bundleIdentifier`: `nz.co.jnok.cleantrack`
- `ios.ascAppId`: `6827417051`

`eas submit --profile production` does not need `APP_VARIANT` exported in the shell. Development and preview builds still set `APP_VARIANT` on their build profiles.

## EAS Update (OTA)

`expo-updates` ships JavaScript and asset changes to binaries that already include it. `runtimeVersion.policy` is `fingerprint`, so a native change (new native module, permission, SDK upgrade, or other native app-config change) gets a new runtime and is **not** offered to older binaries. Those changes need a new EAS Build.

Channels are set on the EAS build profiles in `eas.json` (not `updates.requestHeaders`), so the channel does not change the fingerprint between build and publish:

| Build profile | Channel | Publish script |
| --- | --- | --- |
| `development` | `development` | (dev clients; prefer `expo start`) |
| `preview` | `preview` | `pnpm -F mobile update:preview` |
| `production` | `production` | `pnpm -F mobile update:production` |

### Publish an update

From `apps/mobile` (or via `pnpm -F mobile …` from the repo root). **Do not publish without Jeevan's explicit approval.**

```sh
pnpm -F mobile update:preview -- --message "fix home copy"
pnpm -F mobile update:production -- --message "fix pay screen"
```

Each script sets `APP_VARIANT` to match the target profile (`preview` or `production`) so `app.config.ts` resolves the same name / bundle id as the build. It also passes `--environment` so EAS loads that environment's variables into the update bundle.

**Important:** `eas.json` build `env` is applied by EAS Build, not by `eas update`. The scripts set `APP_VARIANT` explicitly. Other `EXPO_PUBLIC_*` values must live in the matching EAS environment (Dashboard → Project → Environment variables), or they fall back to app-config defaults (API URL → production Worker).

After publish, force-quit and reopen the release build up to twice so the update downloads and applies. Default startup behavior is `checkAutomatically: ON_LOAD` with `fallbackToCacheTimeout: 0` (cold-start does not wait on the update server).

### OTA-safe vs new build

| Change | OTA? |
| --- | --- |
| JS / TS, styles, most assets, copy | Yes |
| New or upgraded native module, Expo SDK bump | No — new build |
| Native permissions / `infoPlist` / plugins that affect native | No — new build |
| Bundle id / app name / `APP_VARIANT` wiring | No — new build (fingerprint) |

Existing TestFlight / store builds that were compiled **before** this PR (no `expo-updates` / no `updates.url`) cannot receive OTA. Ship a new production build after merge, then OTA works for that binary and later matching fingerprints.

### Rollback

```sh
# Re-point the channel at a previous update group
npx eas-cli@latest update:republish --group <previous-update-group-id> --non-interactive

# Or roll the channel back to the binary's embedded bundle
npx eas-cli@latest update:roll-back-to-embedded --channel production --message "Roll back to embedded" --non-interactive
```

Use `--channel preview` for preview. `expo-updates` also falls back if a new update crashes on launch; that is not a substitute for publishing a rollback while the bad update remains current.

The GitHub Actions production workflow publishes with `update:production` and rolls an OTA back with these same commands. Rolling back an update does not remove a TestFlight build.

`eas update` does not run `eas-build-pre-install`. `update:preview` and `update:production` are publishes, not builds, and they are not required to be on `origin/main`.

## Production build

Production builds are refused unless tracked files match `HEAD` and `HEAD` is contained in `origin/main`. Untracked files do not fail the check. The check is `scripts/check-release.mjs`. EAS runs it as the `eas-build-pre-install` hook. On an EAS build (`EAS_BUILD=true`), an empty or unknown profile fails closed. `development` and `preview` skip the git check. A local run with no profile also skips it.

Run it locally before a production build:

```
git fetch origin main
git checkout main
git pull --ff-only
EAS_BUILD_PROFILE=production node apps/mobile/scripts/check-release.mjs
```

The script fetches `origin/main`. A shallow clone is deepened with `git fetch --unshallow origin main` before `git merge-base --is-ancestor HEAD origin/main`. If `origin/main` cannot be fetched, or the shallow history cannot be deepened, the production profile fails. Tracked changes are `git diff --quiet HEAD`. A feature-branch commit or a dirty tracked tree fails the production profile. A local upload that strips `.git` fails closed.

From `apps/mobile`, after the check passes:

```
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

Use `--platform android` for the Play build. `eas.json` `build.production` is the store profile (`distribution: store`, `channel: production`, `autoIncrement: true`). Submit uses the pins in Store submit above.

## GitHub Actions production release

`.github/workflows/mobile-release.yml` releases iOS from `main`. The web Worker stays on `.github/workflows/release.yml`. Android is not built here.

### When it runs

- A push to `main` that changes `apps/mobile/**`, `packages/core/**`, `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`, or `.github/workflows/mobile-release.yml`.
- Actions → Mobile release → Run workflow, from `main`, with mode `auto`, `force-build`, or `force-update`.

The concurrency group is `cleantrack-mobile-production` with `cancel-in-progress: false`, so two mobile releases do not overlap. A newer push waits. It does not cancel a release that is already waiting for approval.

### Decision

The decide job is read-only. It does not use the `mobile-production` environment, and its summary is the record the reviewer sees.

1. Read `GET /repos/jeevan-vj/timesheet/environments/mobile-production` with the workflow token (`contents: read` only) and stop unless that environment has a required reviewer. The response body is deleted and is not printed.
2. Install dependencies and pin `eas-cli@25.3.0` with `npm install --ignore-scripts` (the same CLI version the TestFlight skill uses). `build:list --fingerprint-hash` is the filter that matches this runtime policy.
3. Generate the iOS fingerprint with `APP_VARIANT=production` and this project's `expo-updates fingerprint:generate`. That is the hash an EAS Build of profile `production` embeds. `eas fingerprint:generate` is not used here: it uploads a fingerprint record.
4. Generate the fingerprint again through `eas env:exec production`, which is the environment `update:production` loads. If the two hashes differ, the job stops. No OTA is published and no build starts, including `force-update`. `extra.apiUrl` is part of the fingerprint, so an `EXPO_PUBLIC_API_URL` that is not the build-profile value would publish an update the binary cannot receive.
5. List iOS production store builds on the `production` channel for statuses `finished`, `in-progress`, `in-queue`, and `new`:

   ```sh
   eas build:list --platform ios --build-profile production --channel production --distribution store --fingerprint-hash <hash> --status finished --limit 5 --json --non-interactive
   ```

   A finished build whose EAS artifact has expired still counts. The installed TestFlight binary can receive an OTA after the artifact is gone. Errored and canceled builds do not count. An in-progress build counts, so the workflow publishes an OTA instead of starting a second store build. A missing, empty, whitespace, or `unknown` hash does not match. When both fingerprint fields are absent, a runtime version equal to the fingerprint still matches. `unknown` in a fingerprint field does not fall through to that runtime version. Empty or whitespace platform, profile, channel, or distribution does not count.
6. `auto` with a matching build runs `pnpm -F mobile update:production`. Immediately before that publish, the job recomputes the production-environment fingerprint and refuses to publish if it is not the approved hash. `auto` with no match runs `eas build --platform ios --profile production --auto-submit --freeze-credentials --non-interactive` and waits for the build and the TestFlight submission.
7. `force-build` always builds and submits, and the remote build number still increments once. `force-update` publishes the OTA only when the two fingerprints match. If no binary has the fingerprint, the summary says the update will not reach devices until one exists.

Publish and build jobs check out that same commit. They refuse a dirty tracked tree. Production builds still run `eas-build-pre-install` → `scripts/check-release.mjs` on the EAS builder.

`expo/expo-github-action/continuous-deploy-fingerprint` is not used. Its own README marks it as not ready. The copy on `main` still queries `eas build:list` with `--runtime-version`, which does not select fingerprint-policy builds. It also publishes an update and can start a build in the same step, so the decision cannot be shown before approval. On pull requests it drops builds that expire within a day, so an installed binary whose artifact has expired can be treated as missing.

### Approval and secrets

Publish and build run in the GitHub environment `mobile-production`. The decide job calls `GET /repos/jeevan-vj/timesheet/environments/mobile-production` with the workflow's existing read token and refuses to continue unless that environment has at least one required reviewer. No extra token scope is added. Until the environment and reviewer exist, the workflow cannot publish or build. Create the environment and add Jeevan as a required reviewer before merging if the next push to `main` should be able to release.

Two Expo robots, not one shared token:

| Secret | Where | Robot | Used by |
| --- | --- | --- | --- |
| `EXPO_TOKEN_READ` | Repository secret | Viewer on `@jnok/cleantrack` | Decide job only: fingerprint and `build:list` |
| `EXPO_TOKEN` | Environment secret on `mobile-production` only | Can build, submit, and publish updates | Publish and build jobs only |

Do not store `EXPO_TOKEN` as a repository secret. If an earlier revision of this workflow asked for that, delete the repository secret and keep the publish token on the environment. Environment secrets override a repository secret of the same name, so a leftover repository `EXPO_TOKEN` would also be visible to the gated jobs. The decide job maps `EXPO_TOKEN_READ` onto `EXPO_TOKEN` for the CLI and never reads the publish token. `eas env:exec` and `eas build:list` both use the Viewer token. If EAS rejects that read, the job stops and does not fall back to `EXPO_TOKEN`. The workflow does not print either token and does not put them on a command line. A missing secret fails that job.

The EAS `production` environment must exist. iOS production credentials and App Store Connect app `6827417051` must already be on EAS. `--freeze-credentials` fails the job when a certificate is missing instead of creating a new one.

The checkout sets `persist-credentials: false`. The archive uploaded to EAS does not contain a GitHub token. This repository is public, so `check-release.mjs` can `git fetch origin main` on the builder.

### Build numbers

`eas.json` sets `cli.appVersionSource` to `remote` and `build.production.autoIncrement` to `true`. EAS increments the iOS build number on its counter once per production build. This workflow does not pass a build number and does not call `eas build:version:set`. The concurrency group keeps two Actions releases from incrementing at the same time.

### Rollback

Use the OTA commands in the Rollback section above (`eas update:republish` or `eas update:roll-back-to-embedded --channel production`). That points the production channel at an older update group, or back at the binary's embedded bundle. It does not remove a build from TestFlight. The build job waits up to 180 minutes. If Actions ends the job first, check the Expo dashboard before starting another one; the remote build may still be running.
