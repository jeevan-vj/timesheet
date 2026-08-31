# Factory activation

1. Create a GitHub repository from this workspace and connect it in Cursor Dashboard → Integrations / Cloud Agents.
2. Create a key at <https://cursor.com/dashboard/api> and add it as the GitHub repository secret `CURSOR_API_KEY`.
3. Keep the Cursor environment minimal: Node 22, pnpm 10, repository access, and build/test tooling only.
4. Do not add Cloudflare credentials, production D1 access, `BETTER_AUTH_SECRET`, broad PATs, or personal session tokens to Cursor.
5. Configure a `main` ruleset requiring `CI / verify`, `Factory deterministic gate`, resolved conversations, and Code Owner review.
6. Open a **Factory task** issue. The template begins with `@cursor`; GitHub Actions dispatches the agent with `autoCreatePR=true`.
7. Configure Cursor Automations from `.factory/automations/` if you want independent review and repair loops.

Repository variables:

- `FACTORY_ALLOW_HIGH_RISK_AUTOMERGE=false` initially.
- `AUTONOMOUS_PRODUCTION=false` initially.

The first merge adding this factory is a protected control-plane change and must be reviewed and merged by a human.
