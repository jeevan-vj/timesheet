# CleanTrack mobile

Expo app for contractors. Local scripts set `APP_VARIANT=development` so a dev-client keeps the `.dev` bundle id:

```bash
pnpm -F mobile start
```

## Store submit

`eas submit` loads `app.config.ts` before it reads the submit profile, and a submit profile has no `env` field. Build-profile `env` is not applied. With `APP_VARIANT` unset, the config resolves the store bundle id `nz.co.jnok.cleantrack` (development and preview stay explicit).

`submit.production` also pins that bundle id and the App Store Connect app:

- `ios.bundleIdentifier`: `nz.co.jnok.cleantrack`
- `ios.ascAppId`: `6827417051`

`eas submit --profile production` does not need `APP_VARIANT` exported in the shell. Development and preview builds still set `APP_VARIANT` on their build profiles.
