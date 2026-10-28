# Maestro

Flows target the dev-variant app, `nz.co.jnok.cleantrack.dev`. `APP_ID` defaults to that bundle in `.maestro/config.yaml` and in each flow (`${APP_ID || "nz.co.jnok.cleantrack.dev"}`). Override with `-e APP_ID=...`.

Use a local or disposable synthetic account only. Never sign in with a real contractor account. Sign-in writes a session. Do not put personal details, rates, phone numbers, or addresses in screenshots or recordings.

Production (`nz.co.jnok.cleantrack`, the TestFlight app) is allowed only for a launch-only smoke with no sign-in:

```bash
maestro test -e APP_ID=nz.co.jnok.cleantrack .maestro/launch-sign-in.yaml
```

A signed-in production run needs Jeevan's approval of a named synthetic account. Do not point a signed-in flow at production without that approval.

| Flow | Asserts |
| --- | --- |
| `launch-sign-in.yaml` | Signed-out `sign-in-screen`. No account and no writes. |
| `signed-in-contractor.yaml` | `contractor-home`, `contractor-week`, `contractor-pay`, `contractor-account` |
| `signed-in-owner.yaml` | `owner-today`, `owner-week`, `owner-team`, `owner-payroll`, `owner-account` |
| `signed-in-no-workspace.yaml` | `no-workspace` |

Pass `MAESTRO_EMAIL` and `MAESTRO_PASSWORD` through the environment. Do not pass them with `-e`: that stores them in shell history and the process list. Maestro reads those `MAESTRO_*` variables from the environment. Load them from a mode `0600` file that is not committed:

```bash
install -m 0600 /dev/null "$HOME/.config/cleantrack-maestro.env"
# Write MAESTRO_EMAIL and MAESTRO_PASSWORD into that file, then:
set -a
. "$HOME/.config/cleantrack-maestro.env"
set +a
maestro test .maestro/launch-sign-in.yaml
maestro test .maestro/signed-in-contractor.yaml
```

`APP_ID` is not a secret. `-e APP_ID=...` is only for the bundle override above.
