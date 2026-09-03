# Factory E2E evidence

A factory PR head is **not verified** until a trusted GitHub Actions run has exercised that exact SHA against a running local app and produced machine-checkable evidence. Unit tests, typecheck, build, lint, agent prose, and “the UI looks correct” comments do not substitute for this gate.

## Trust boundary

| Role | Workflow / module | Trust |
|------|-------------------|--------|
| Deterministic gate | `Factory PR Gate` / job `Factory deterministic gate` | Unchanged: frozen install, tests, typecheck, build, risk classification. Checks out the PR. |
| Evidence producer | `Factory E2E Evidence` / job `Factory E2E evidence` | `pull_request` workflow, same pattern as the deterministic gate. Builds and starts the **exact PR head**, runs Playwright, uploads artifacts. |
| Evidence consumer | `Factory Trusted Controller` + `.factory/evaluate-e2e-evidence.mjs` | Checks out **default-branch `.factory` only**. Downloads artifacts for the live head, **recomputes** the verdict, and ignores a producer `overallVerdict`. |
| Repair | `Factory Repair Loop` | No checkout. An E2E non-success on the live head dispatches the existing durable-agent repair path (`kind=e2e`). |

PR-authored files, comments, and agent summaries are never proof. Changing `.github/**` or `.factory/**` remains **protected** and still requires human approval even when E2E evidence passes.

Evidence is platform-bound by:

- GitHub Actions check `Factory E2E evidence` on the live head SHA;
- artifact name `factory-e2e-evidence-<full-sha>`;
- report fields `repository`, `prNumber`, and `headSha`;
- default-branch schema/plan/policy evaluation.

## Lifecycle

```
PR head advances
  → Factory deterministic gate (must still pass)
  → Factory E2E evidence (browser run against that exact SHA)
       success + consumer pass → review / risk / merge evaluation
       missing, cancelled, failed, stale, or malformed → not verified
       non-success producer → repair (max two dispatched cycles, then factory:needs-human)
  → any new commit invalidates prior screenshots, traces, reports, and statuses
```

Unknown or ambiguous evidence is a failure. There is no evidence-bypass label or merge fallback.

## Schema (`schemaVersion: "1"`)

See `.factory/schemas/e2e-evidence.schema.json`. Required fields:

- `schemaVersion`, `repository`, `prNumber`, `headSha`
- `run.workflow` / `workflowRunId` / `job` / `event`
- `timestamp`, `app.baseUrl`, `app.environment` (no secrets)
- `scenarios[]` with `id`, `status`, screenshot refs
- `artifacts.trace` / `console` / `network` / `screenshots`
- `console` errors/warnings summary, `network.failures`
- `checks`, `overallVerdict`, `reasonCodes`

The consumer does **not** trust `overallVerdict`. It re-reads raw `console.json` and `network.json` plus screenshot/trace bytes.

## Default verification plan

`.factory/e2e/plan.json` is the catalog (protected). Homepage-only smoke is insufficient. Default scenarios:

1. `health-ok` — local `/api/health` is 200 with `status: ok` (does not require a production `release` SHA)
2. `owner-signup` — synthetic owner creates an account and reaches `/dashboard`
3. `empty-week-dashboard` — authenticated week view shows **No shifts this week**

Additional scenario IDs are not accepted from PR comments. Product PRs still run this owner path against the PR-head app; issue-specific contracts do not replace the gate.

## Console and network policy

`.factory/e2e/policy.json` is fail-closed with an empty allowlist.

- Any console `error` or `warning` fails the gate.
- Any failed request or HTTP status ≥ 400 fails the gate.
- Missing capture files fail as `missing_console` / `missing_network`.

## Artifact retention and sanitization

- Artifacts retain **14 days**.
- Uploads are GitHub Actions artifacts only (not PR comments).
- `console.json` / `network.json` strip `Cookie`, `Set-Cookie`, `Authorization`, and secret query params.
- Traces may still contain DOM snapshots of the **synthetic** owner session. Never point this harness at production or real contractor/payroll data.
- Local output directory `factory-e2e-output/` is gitignored.

## Local / debug

Requires a built app and Playwright Chromium.

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm build
printf 'BETTER_AUTH_SECRET=local-development-secret-change-me-123456789\nBETTER_AUTH_URL=http://127.0.0.1:8787\nAUTH_TRUSTED_ORIGINS=http://127.0.0.1:8787\n' > .dev.vars
pnpm exec wrangler d1 migrations apply cleantrack-timesheet --local --config wrangler.jsonc --persist-to .wrangler/e2e-state
pnpm exec wrangler dev --config dist/server/wrangler.json --ip 127.0.0.1 --port 8787 --persist-to .wrangler/e2e-state \
  --var "BETTER_AUTH_URL:http://127.0.0.1:8787" \
  --var "AUTH_TRUSTED_ORIGINS:http://127.0.0.1:8787" \
  --var "RELEASE_SHA:factory-e2e"
# other terminal:
FACTORY_E2E_REPOSITORY=local/dev FACTORY_E2E_PR=1 FACTORY_E2E_HEAD_SHA="$(git rev-parse HEAD)" \
  node .factory/e2e/harness.mjs --base-url http://127.0.0.1:8787 --out factory-e2e-output
node .factory/evaluate-e2e-evidence.mjs \
  --repository local/dev --pr 1 --head-sha "$(git rev-parse HEAD)" \
  --artifact-dir factory-e2e-output --run-conclusion success --run-head-sha "$(git rev-parse HEAD)"
```

Production smoke (`.github/scripts/production-smoke.mjs`) remains health-only and is not this gate.
