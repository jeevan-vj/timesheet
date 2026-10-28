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

Pass credentials as env vars, not in these files:

```bash
maestro test .maestro/launch-sign-in.yaml
maestro test -e MAESTRO_EMAIL=... -e MAESTRO_PASSWORD=... .maestro/signed-in-contractor.yaml
```
