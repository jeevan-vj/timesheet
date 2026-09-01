# CleanTrack Software Factory

State machine: `issue -> orchestrate -> spec -> specialist implementation -> behavior verification -> PR -> independent review -> merge`.

One durable cloud orchestrator owns one issue, one branch, and one PR. It first asks a read-only spec agent for a task contract, then routes the approved work to the database, API, and frontend specialists that are actually needed. Editing specialists run sequentially in the shared checkout. A read-only verifier checks the integrated acceptance criteria and sends blocking findings back through the orchestrator for at most two repair cycles.

Owner-created issues labeled `factory:ready` dispatch a Cursor Cloud Agent via the Agents API when `CURSOR_API_KEY` is configured. Do not put `@cursor` in factory issue bodies — that would also trigger the native GitHub↔Cursor mention path and spawn a second non-factory session. Use `@cursor` on the resulting PR only for human refine. `@codex` on an issue comment remains a supported fallback handoff. GitHub Actions, not an agent, owns verification and merge gating.

Safety boundaries:

- Cloud agents receive repository access and build tooling, never production, Cloudflare, D1, auth, or GitHub admin credentials.
- Every PR runs frozen install, tests, typecheck, build, and deterministic risk classification.
- Only low-risk PRs are eligible for autonomous merge. API, service, dependency, auth, payroll, database, migration, deployment, and control-plane changes require human approval.
- `AGENTS.md`, `.github/**`, and `.factory/**` are protected and never autonomously merged.

When CI or the trusted independent reviewer requests changes, the repair workflow sends a follow-up run to the same durable Cursor agent and existing branch. The orchestrator routes confirmed findings to the responsible specialist, re-verifies, and pushes to the existing PR. Missing agent state, a busy/failed follow-up, or two unsuccessful repair cycles escalates to `factory:needs-human`.

See [SETUP.md](SETUP.md) to activate the factory.
