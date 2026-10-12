# Factory activation

1. Create a GitHub repository from this workspace and connect it in Cursor Dashboard → Integrations / Cloud Agents.
2. Create a key at <https://cursor.com/dashboard/api> and add it as the GitHub repository secret `CURSOR_API_KEY`.
3. Keep the Cursor environment minimal: Node 22, pnpm 10, repository access, and build/test tooling only.
4. Do not add Cloudflare credentials, production D1 access, `BETTER_AUTH_SECRET`, broad PATs, or personal session tokens to Cursor.
5. Configure a `main` ruleset requiring `CI / verify`, `Factory deterministic gate`, `Factory E2E evidence`, resolved conversations, and Code Owner review. The E2E check is complementary; it does not replace the deterministic gate. Protected control-plane changes still need human approval when evidence passes.
6. Open a **Factory task** issue. The template applies `factory:ready` (no `@cursor` mention). GitHub Actions dispatches the orchestrator via the Agents API with `autoCreatePR=true` and persists a canonical Factory Run ID plus status comment (see [control-plane.md](control-plane.md)). Re-apply `factory:ready` or use `workflow_dispatch` to retry intake after `factory:needs-human`.
7. Configure Cursor Automations from `.factory/automations/` for independent review. The trusted GitHub repair workflow routes CI failures and trusted P0-P2 review feedback back to the durable orchestrator, waits instead of cancelling when that agent is busy, and requests a fresh `@codex review` after a repaired head passes the gate. Keep `@cursor` on PRs for optional human refine; factory intake must stay label/API-driven to avoid double sessions.

Repository variables:

- `AUTONOMOUS_PRODUCTION=false` initially.

Autonomous merge is intentionally limited to low-risk changes. Medium, high, and protected changes always require human approval.

The first merge adding this factory is a protected control-plane change and must be reviewed and merged by a human.

Agent behavior inside a factory run is [.factory/POTATO.md](POTATO.md). Preview deploys are configured in [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) and stay off until the preview secrets and variables exist.
