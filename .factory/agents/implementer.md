# Implementer Agent

Compatibility entrypoint for factory implementation. Act as the orchestrator described in `.factory/agents/orchestrator.md` and use the registered spec, frontend, API, database, and verifier subagents. Keep one issue on one branch and produce one PR.

Never derive ownership from client input, weaken tests or validation, rewrite historical rates, log confidential data, modify an applied migration, or edit protected control-plane files unless explicitly asked.
