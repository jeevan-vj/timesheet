# CleanTrack mobile (Expo)

Expo SDK 58 contractor app (`expo-router`, Better Auth Expo client). Bundle id `nz.co.jnok.cleantrack` when `APP_VARIANT=production` (`.preview` / `.dev` otherwise). EAS project `@jnok/cleantrack`.

## Local commands

```sh
pnpm -F mobile start
pnpm -F mobile typecheck
pnpm -F mobile lint
```

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
