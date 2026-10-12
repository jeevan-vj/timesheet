# CleanTrack Software Factory

State machine: `issue -> orchestrate -> spec -> specialist implementation -> behavior verification -> PR -> deterministic gate -> E2E evidence -> independent review -> merge`.

How an agent behaves inside that machine is [POTATO.md](POTATO.md): a reusable `pnpm verify` command, the [feature map](feature-map.json), proof from the running app, and autonomy limited by `.factory/risk-policy.json`. Do not add a parallel intake path.

Canonical factory state is owned by the [control plane](control-plane.md): an immutable Factory Run ID, explicit state machine, append-only event log, structured failures, and deterministic recovery. GitHub labels (`factory:ready`, `factory:delegated`, `factory:implementing`, `factory:needs-human`, `factory:complete`) are projections, not authority.

One durable cloud orchestrator owns one issue, one branch, and one PR. It first asks a read-only spec agent for a task contract, then routes the approved work to the database, API, and frontend specialists that are actually needed. Editing specialists run sequentially in the shared checkout. A read-only verifier checks the integrated acceptance criteria and sends blocking findings back through the orchestrator for at most two repair cycles.

Owner-created issues labeled `factory:ready` dispatch a Cursor Cloud Agent via the Agents API when `CURSOR_API_KEY` is configured. Do not put `@cursor` in factory issue bodies — that would also trigger the native GitHub↔Cursor mention path and spawn a second non-factory session. Use `@cursor` on the resulting PR only for human refine. `@codex` on an issue comment remains a supported fallback handoff. GitHub Actions, not an agent, owns verification and merge gating.

Safety boundaries:

- Cloud agents receive repository access and build tooling, never production, Cloudflare, D1, auth, or GitHub admin credentials.
- Every PR runs frozen install, tests, typecheck, build, deterministic risk classification, and an evidence-driven E2E gate against the exact PR head.
- Only low-risk PRs are eligible for autonomous merge after **both** the deterministic gate and current-head E2E evidence pass. API, service, dependency, auth, payroll, database, migration, deployment, and control-plane changes require human approval. Passing E2E evidence does not waive that human gate.
- `AGENTS.md`, `.github/**`, and `.factory/**` are protected and never autonomously merged.

When CI fails, E2E evidence fails, or the trusted independent reviewer reports P0-P2 findings (including findings submitted as a `COMMENTED` review), the repair workflow sends a follow-up run to the same durable Cursor agent and existing branch. If that durable agent is already running, the workflow waits for it to finish, stops if the PR head changes, and then queues the repair without cancelling the active run. Only successfully dispatched repairs count toward the two-cycle limit. Any new commit invalidates prior E2E evidence; browser verification must rerun against the repaired head.

After a repaired head passes the deterministic gate **and** current-head E2E evidence, the controller replies to the original blocking threads and requests a fresh independent `@codex review`. Old blocking threads remain open until a trusted, non-blocking review covers the new head. The controller then resolves the superseded threads and removes a transient `factory:needs-human` label; high-risk and protected changes immediately restore the human gate. Missing durable-agent state, a failed follow-up after waiting, or two dispatched repair cycles escalates to `factory:needs-human`.

See [SETUP.md](SETUP.md) to activate the factory and [e2e-evidence.md](e2e-evidence.md) for the evidence schema, trust boundary, and local debug workflow.
