# Potato loop on the CleanTrack factory

This is the working agreement for agents in this repo. It sits on the factory that already owns intake, runs, repair, and merge. Do not add a second state machine.

## Where the practices come from

Lauren Tan ([@poteto](https://x.com/poteto)), who works on Grok Bot at SpaceXAI and publishes as "potato", describes the loop in public posts and in the open [pstack](https://github.com/cursor/plugins/blob/main/pstack/README.md) plugin (`/poteto-mode`). A 72-hour Grok Bot build stream is written up, with captions, as [Grok Bot — The 72-Hour Field Guide](https://grokbot-cn.ljtian.com/grok-bot-guide-by-spacex-engineers.pdf). Her talk "How I shipped 2000 PRs last month" is transcribed from the YouTube captions at [prepublish.ai/youtube-transcript/NjoZoUm85x0](https://prepublish.ai/youtube-transcript/NjoZoUm85x0).

Practices below are the ones those sources actually describe. This repo implements a small slice of them. It does not vendor pstack.

## Practices

1. **Verification is the product.** Tan's talk and the 6 Oct 2026 thread ([status/2107529149355319657](https://x.com/poteto/status/2107529149355319657)) treat a verification skill as the thing that makes autonomy safe. Agents run the real app, click through it, and attach screenshots or video. A green build is not that proof. She replied that agents "run your code in their own VM and take videos and screenshots. those artifacts are what i primarily review" ([status/2107529532144234937](https://x.com/poteto/status/2107529532144234937)).

2. **One implementer, a separate verifier.** The field guide's factory loop is: break the plan into small changes, one cloud agent per change, then a different pass that runs the app and tries to break it. The author of a change does not get to declare it done.

3. **A reusable verification tool, plus a feature map.** The talk describes two parts: a CLI the agent runs every time (not a fresh script per session), and a feature map that says how a person reaches each behavior. Guessing at the UI is the failure mode the map exists to stop.

4. **Proof goes in the PR.** The field guide's playbook rule is screenshots or video for UI, and a measured signal for non-UI changes.

5. **Reproduce before you fix.** For a bug, run the app and show the current behavior before editing.

6. **Autonomy scales with blast radius.** The same guide records Tan pulling back from full autopilot once the game was live, and a bad automated SQL change taking production down. pstack's README says "throughput without quality is not a goal i aspire to." This repo already encodes that: low-risk diffs can merge after the deterministic gate and current-head E2E evidence; payroll, auth, migrations, and control-plane files stay human-gated.

7. **Make the right path the easy path.** The talk's order, when an agent keeps making the same mistake: make the bad pattern impossible in the code, else add a lint, else write a rule. Comments that explain a workaround are called out as something agents copy. `pnpm lint` fails on `console.*`, `TODO` / `FIXME` / `HACK`, and "workaround" in `src/`.

8. **Write the principle, not the incident.** The field guide's correction to an over-specific bot description was to restate the rule so it survives the next task. Factory instructions stay general.

9. **Small PRs, one branch, one owner.** pstack's opening-a-PR playbook and this factory agree: one scoped change, one PR, evidence in the body.

## What an agent does here

1. Read `AGENTS.md`, `SPEC.md`, `SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, this file, and `.factory/feature-map.json`.
2. State the outcome, acceptance criteria, and non-goals before editing. Factory issues still enter through the `factory:ready` template. Do not mention `@cursor` on the issue.
3. Implement the smallest slice. Add or extend a test first when the behavior is payroll, authorization, or a new derivation.
4. Run `pnpm verify`. That is lint, test, typecheck, and build. Do not invent a one-off check script.
5. For a UI change, run the app and walk the feature map entry. Save screenshots.
6. Open one PR. Include the plan, `pnpm verify` results, security and payroll impact, migration notes, and the screenshots for UI.
7. Stop for a human when the diff touches a high-risk or protected path in `.factory/risk-policy.json`. Passing checks do not waive that gate.

The verifier agent remains read-only. It uses the feature map and `pnpm verify`, and it does not accept "the build passed" as evidence that a screen works.
