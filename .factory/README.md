# CleanTrack Software Factory

State machine: `issue -> implement -> verify -> PR -> independent review -> merge`.

Owner-created issues containing `@cursor` dispatch a Cursor Cloud Agent when `CURSOR_API_KEY` is configured. `@codex` remains a supported fallback handoff. GitHub Actions, not an agent, owns verification and merge gating.

Safety boundaries:

- Cloud agents receive repository access and build tooling, never production, Cloudflare, D1, auth, or GitHub admin credentials.
- Every PR runs frozen install, tests, typecheck, build, and deterministic risk classification.
- Auth, payroll logic, database, migrations, and deployment are high risk and require human approval by default.
- `AGENTS.md`, `.github/**`, and `.factory/**` are protected and never autonomously merged.

See [SETUP.md](SETUP.md) to activate the factory.
