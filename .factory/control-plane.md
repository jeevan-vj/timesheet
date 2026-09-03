# Factory control plane (Phase 1)

Canonical, harness-agnostic factory observability. GitHub labels, Actions job status, PR status, and comments are **projections or integrations**, not the source of truth.

This is a **HIGH-RISK** control-plane change. Human approval is required before merge and before treating the model as live authority. There is **no dashboard**.

See also [README.md](README.md), [SETUP.md](SETUP.md), and [e2e-evidence.md](e2e-evidence.md).

## Factory Run ID

Every factory task mints an immutable `factory_run_id` (`frun-` + UUID) at lifecycle start. It is **not** a Cursor agent id (`bc-…`), Cursor `latestRunId`, or GitHub Actions `run_id`.

The id is persisted in a trusted `github-actions[bot]` status comment (not the owner-editable issue body, not product D1) and propagated into:

- intake and repair prompts (`Factory-Run-ID:`)
- structured events, failure records, and recovery decisions
- the human-readable Factory Status comment
- derived metrics

Repair, verification, and review on the same task reuse the same run id. A new id is minted only for an explicit new lifecycle (`workflow_dispatch` force after cancelling a non-terminal run, or intake after a terminal run).

## State machine

Authoritative states:

```
CREATED → PLANNING → IMPLEMENTING → VERIFYING → REVIEWING → READY_FOR_HUMAN_APPROVAL → COMPLETED
```

Side/terminal states: `FAILED`, `REPAIR_REQUIRED`, `BLOCKED`, `CANCELLED`.

Invalid transitions fail closed (no state write). Every successful transition emits `state.transitioned`. Folding the append-only event log reconstructs current state.

Label projections (not authority):

| Canonical state | Labels (additive projection) |
| --- | --- |
| `CREATED` / `PLANNING` | `factory:delegated` |
| `IMPLEMENTING` / `VERIFYING` / `REVIEWING` / `REPAIR_REQUIRED` | `factory:delegated`, `factory:implementing` |
| `READY_FOR_HUMAN_APPROVAL` / `BLOCKED` / `FAILED` / `CANCELLED` | `factory:delegated`, `factory:needs-human` |
| `COMPLETED` | `factory:delegated`, `factory:complete` |

`factory:needs-human` is a single UX label for several canonical states.

## Event log

Versioned envelope (`schema_version: "1"`): `event_id`, `factory_run_id`, `correlation_id`, `causation_id`, `timestamp` (ISO-8601 UTC), `event_type`, `state`, `actor`, `github`, `metadata`.

The log is append-only. Duplicate `event_id` delivery is idempotent. Corrections are later events. Untrusted (non-bot) comments are ignored; malformed payloads fail closed.

Schemas live in `.factory/schemas/factory-*.schema.json`.

## Failures and recovery

Failures use a closed taxonomy (`PLANNING_FAILURE`, `IMPLEMENTATION_FAILURE`, `BUILD_FAILURE`, `TEST_FAILURE`, `VERIFICATION_FAILURE`, `EVIDENCE_MISSING`, `EVIDENCE_STALE`, `REVIEW_FAILURE`, `MERGE_CONFLICT`, `INFRASTRUCTURE_FAILURE`, `HARNESS_FAILURE`, `AUTH_OR_PERMISSION_FAILURE`, `RATE_LIMIT_OR_QUOTA`, `TIMEOUT`, `POLICY_OR_GUARDRAIL_FAILURE`, `UNKNOWN_FAILURE`).

Records include `category`, `code`, `message` (secrets redacted), `retryable`, `source`, ids, timestamp, and references.

Deterministic recovery (`decideRecovery`) is a pure function. Representative rules:

| Failure | Decision |
| --- | --- |
| Retryable build/test/implementation/review/verification | `REPAIR` → `REPAIR_REQUIRED` if dispatched repairs `< 2`, else `BLOCKED` |
| Stale evidence | `RERUN_VERIFICATION` (does not consume a repair cycle) |
| Missing evidence / consumer reject | `BLOCK_FOR_HUMAN` |
| Auth, harness, policy | Block or `READY_FOR_HUMAN_APPROVAL` |
| Unknown / unmapped / unsafe transition | `FAIL_CLOSED` |

Non-low risk never auto-merges.

## Status comment

One canonical comment per run, created once and updated in place (`PATCH` by comment id / `<!-- factory-status:frun-… -->` marker). It is a human-readable projection of canonical state plus a machine payload. It does not replace repair markers or the human-gate comment.

## Rollout

- Product D1, payroll, and owner scoping are unchanged. No migration.
- In-flight issues with a Cursor agent id but **no** parseable factory run **fail closed** (no backfill).
- A `BLOCKED` run with **no** harness agent (for example missing `CURSOR_API_KEY`) is resumed on the same Factory Run ID when `factory:ready` is re-applied. `workflow_dispatch` force cancels the old run, patches its status comment to `CANCELLED`, and mints a new run.
- Until this lands on the default branch, `workflow_run` repair/controller still execute the previous default-branch workflows.
- Activation requires human merge of this protected change.

## Modules

| Module | Role |
| --- | --- |
| `run-id.mjs` | Generate/validate ids |
| `state-machine.mjs` | States, transitions, label projections |
| `events.mjs` | Envelope, append-only log, reconstruct |
| `failures.mjs` | Taxonomy and classification |
| `recovery.mjs` | Pure recovery policy |
| `status-comment.mjs` | Markdown projection + payload encode/decode |
| `control-plane.mjs` | Intake/repair/controller facade and CLI |
