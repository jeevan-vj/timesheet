import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIdFactory, isFactoryRunId } from './run-id.mjs';
import {
  isInProgressState,
  isTerminalState,
  projectLabels,
  assertTransition,
} from './state-machine.mjs';
import { appendEvent, createEvent, nowIso, reconstructState, SCHEMA_VERSION } from './events.mjs';
import { classifyFactorySignal, createFailureRecord } from './failures.mjs';
import { decideRecovery } from './recovery.mjs';
import {
  decodeControlPlane,
  extractRunIdMarker,
  findStatusComment,
  renderStatusMarkdown,
  statusMarker,
} from './status-comment.mjs';

export { SCHEMA_VERSION } from './events.mjs';
export { projectLabels } from './state-machine.mjs';
export { decideRecovery } from './recovery.mjs';
export { classifyFactorySignal } from './failures.mjs';
export { renderStatusMarkdown, findStatusComment, statusMarker, runIdMarker, encodeControlPlane } from './status-comment.mjs';

export const TRUSTED_BOT_LOGIN = 'github-actions[bot]';
export const AGENT_ID_RE = /factory-agent-id:(bc-[A-Za-z0-9-]+)/;

export function isTrustedFactoryComment(comment) {
  return comment?.user?.login === TRUSTED_BOT_LOGIN && comment?.user?.type === 'Bot';
}

export function extractTrustedAgentId(comments) {
  let found = null;
  for (const comment of (comments ?? []).filter(isTrustedFactoryComment)) {
    const match = String(comment.body ?? '').match(AGENT_ID_RE);
    if (match) found = match[1];
  }
  return found;
}

export const DEFAULT_STALE_RUN_MS = 24 * 60 * 60 * 1000;

const ACTIVE_RUN_STATUSES = new Set(['QUEUED', 'CREATING', 'RUNNING']);
const TERMINAL_RUN_STATUSES = new Set(['FINISHED', 'ERROR', 'FAILED', 'CANCELLED', 'CANCELED', 'EXPIRED']);
const TERMINAL_AGENT_STATUSES = new Set(['IDLE', 'ARCHIVED', 'ERROR', 'FINISHED']);
const RUNNING_AGENT_STATUSES = new Set(['ACTIVE', 'RUNNING', 'CREATING']);

function upperStatus(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function classifyHarnessLiveness(agent) {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) {
    return { known: false, running: false, terminal: false, status: null, runStatus: null };
  }
  const status = upperStatus(agent.status);
  const runStatus = upperStatus(agent.runStatus ?? agent.run?.status);
  if (!status && !runStatus) {
    return { known: false, running: false, terminal: false, status: null, runStatus: null };
  }
  const running = ACTIVE_RUN_STATUSES.has(runStatus) || (!runStatus && RUNNING_AGENT_STATUSES.has(status));
  const terminal = !running && (TERMINAL_RUN_STATUSES.has(runStatus) || TERMINAL_AGENT_STATUSES.has(status));
  return {
    known: true,
    running,
    terminal,
    status: status || null,
    runStatus: runStatus || null,
  };
}

export function factoryRunActivityMs(run, agent) {
  const stamps = [run?.updated_at];
  if (agent && typeof agent === 'object' && !Array.isArray(agent)) {
    stamps.push(agent.updatedAt, agent.runUpdatedAt, agent.run?.updatedAt);
  }
  const parsed = stamps.map((value) => Date.parse(value)).filter((value) => Number.isFinite(value));
  if (parsed.length === 0) return null;
  return Math.max(...parsed);
}

export function isFactoryRunStale(run, agent, nowMs, thresholdMs = DEFAULT_STALE_RUN_MS) {
  if (!run || Number.isInteger(run.github?.pull_request)) return false;
  if (!Number.isFinite(thresholdMs) || thresholdMs < 0) return false;
  if (!Number.isFinite(nowMs)) return false;
  const activity = factoryRunActivityMs(run, agent);
  if (activity == null) return false;
  return nowMs - activity >= thresholdMs;
}

function recordedAgentId(run, comments) {
  return run?.agent_id || extractTrustedAgentId(comments) || null;
}

function agentForRun(run, comments, agent) {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) return null;
  const recorded = recordedAgentId(run, comments);
  if (agent.id && recorded && agent.id !== recorded) return null;
  return agent;
}

function supersedeReason(liveness, stale) {
  if (liveness.running && !stale) return null;
  if (liveness.runStatus === 'ERROR' || liveness.runStatus === 'FAILED' || liveness.status === 'ERROR') return 'agent_errored';
  if (liveness.terminal) return 'agent_finished';
  if (stale) return 'stale_run';
  return null;
}

function cloneRun(run) {
  return structuredClone(run);
}

function lastEventId(run) {
  return run.events.at(-1)?.event_id ?? null;
}

export function deriveMetrics(run) {
  const events = run.events ?? [];
  const started = events[0]?.timestamp ?? run.created_at;
  const ended = events.at(-1)?.timestamp ?? run.updated_at;
  const stateDurationsMs = {};
  let current = null;
  let currentAt = null;
  for (const event of events) {
    if (event.event_type === 'run.created' || event.event_type === 'state.transitioned') {
      if (current && currentAt) {
        stateDurationsMs[current] = (stateDurationsMs[current] ?? 0) + (Date.parse(event.timestamp) - Date.parse(currentAt));
      }
      current = event.state;
      currentAt = event.timestamp;
    }
  }
  if (current && currentAt && ended) {
    stateDurationsMs[current] = (stateDurationsMs[current] ?? 0) + Math.max(0, Date.parse(ended) - Date.parse(currentAt));
  }
  const failuresByCategory = {};
  for (const event of events.filter((item) => item.event_type === 'failure.detected')) {
    const category = event.metadata?.failure?.category ?? 'UNKNOWN_FAILURE';
    failuresByCategory[category] = (failuresByCategory[category] ?? 0) + 1;
  }
  const harness = {};
  for (const event of events.filter((item) => item.event_type === 'agent.attempt.completed')) {
    const name = event.actor?.harness ?? 'other';
    harness[name] ??= { started: 0, completed: 0, failed: 0 };
    harness[name].completed += 1;
    if (event.metadata?.ok === false) harness[name].failed += 1;
  }
  for (const event of events.filter((item) => item.event_type === 'agent.attempt.started')) {
    const name = event.actor?.harness ?? 'other';
    harness[name] ??= { started: 0, completed: 0, failed: 0 };
    harness[name].started += 1;
  }
  return {
    schema_version: SCHEMA_VERSION,
    factory_run_id: run.factory_run_id,
    run_duration_ms: Math.max(0, Date.parse(ended) - Date.parse(started)),
    state_durations_ms: stateDurationsMs,
    retry_count: events.filter((item) => item.event_type === 'retry.started').length,
    repair_loop_count: events.filter((item) => item.event_type === 'repair.started').length,
    failures_by_category: failuresByCategory,
    harness_outcomes: harness,
    human_approval_wait_ms: stateDurationsMs.READY_FOR_HUMAN_APPROVAL ?? 0,
    verification_failure_count: failuresByCategory.VERIFICATION_FAILURE ?? 0,
  };
}

function defaultActor(actor, harness) {
  return {
    type: actor?.type || 'workflow',
    name: actor?.name || 'Factory control plane',
    harness: actor?.harness || harness || 'other',
  };
}

function appendNamedEvent(run, { event_type, state = run.state, metadata = {}, actor, github, ids, now, correlation_id }) {
  const event = createEvent({
    event_id: ids.eventId(),
    factory_run_id: run.factory_run_id,
    correlation_id: correlation_id || run.correlation_id,
    causation_id: lastEventId(run),
    timestamp: nowIso(now),
    event_type,
    state,
    actor: defaultActor(actor || run.actor, run.actor_harness),
    github: github || run.github,
    metadata,
  });
  run.events = appendEvent(run.events, event);
  run.updated_at = event.timestamp;
  return event;
}

export function createFactoryRun({
  repository,
  issue,
  provider = 'cursor',
  actor,
  ids = createIdFactory(),
  now = () => new Date(),
} = {}) {
  const factory_run_id = ids.runId();
  if (!isFactoryRunId(factory_run_id)) throw new Error('invalid factory_run_id');
  const harness = provider === 'codex' ? 'codex' : provider === 'cursor' ? 'cursor' : 'other';
  const timestamp = nowIso(now);
  const github = { repository, issue: issue ?? null, pull_request: null, commit_sha: null };
  const runActor = defaultActor(actor, harness);
  const created = createEvent({
    event_id: ids.eventId(),
    factory_run_id,
    correlation_id: ids.correlationId(),
    causation_id: null,
    timestamp,
    event_type: 'run.created',
    state: 'CREATED',
    actor: runActor,
    github,
    metadata: { provider },
  });
  const run = {
    schema_version: SCHEMA_VERSION,
    factory_run_id,
    correlation_id: created.correlation_id,
    created_at: timestamp,
    updated_at: timestamp,
    state: 'CREATED',
    github,
    actor: runActor,
    actor_harness: harness,
    agent_id: null,
    repair_attempts: 0,
    latest_failure: null,
    latest_recovery: null,
    events: [created],
  };
  return run;
}

export function applyTransition(run, toState, { event_type = 'state.transitioned', metadata = {}, actor, github, ids = createIdFactory(), now = () => new Date() } = {}) {
  assertTransition(run.state, toState);
  const next = cloneRun(run);
  const from = next.state;
  next.state = toState;
  appendNamedEvent(next, {
    event_type: 'state.transitioned',
    state: toState,
    metadata: { from, to: toState },
    actor,
    github,
    ids,
    now,
  });
  if (event_type !== 'state.transitioned') {
    appendNamedEvent(next, {
      event_type,
      state: toState,
      metadata: { from, to: toState, ...metadata },
      actor,
      github,
      ids,
      now,
    });
  }
  reconstructState(next.events);
  return next;
}

function transitionIfNeeded(run, toState, opts) {
  if (!toState || toState === run.state) return run;
  return applyTransition(run, toState, opts);
}

export function recordFailureAndRecovery(run, failureInput, {
  actor,
  github,
  ids = createIdFactory(),
  now = () => new Date(),
  risk = null,
  repairAttempts = run.repair_attempts,
} = {}) {
  const next = cloneRun(run);
  const failure = createFailureRecord({
    ...failureInput,
    factory_run_id: run.factory_run_id,
    correlation_id: failureInput.correlation_id || run.correlation_id,
  });
  appendNamedEvent(next, {
    event_type: 'failure.detected',
    metadata: { failure },
    actor,
    github,
    ids,
    now,
  });
  const decision = decideRecovery({
    state: next.state,
    failure,
    repairAttempts,
    risk,
  });
  appendNamedEvent(next, {
    event_type: 'recovery.decided',
    metadata: { failure, recovery: decision },
    actor,
    github,
    ids,
    now,
  });
  next.latest_failure = failure;
  next.latest_recovery = decision;
  if (decision.invalidateEvidence) {
    appendNamedEvent(next, {
      event_type: 'evidence.invalidated',
      metadata: { reason: decision.reason, policy: decision.policy },
      actor,
      github,
      ids,
      now,
    });
  }
  const afterDecision = transitionIfNeeded(next, decision.nextState, { actor, github, ids, now });
  if (decision.action === 'REPAIR' || decision.action === 'REBASE_REPAIR') {
    appendNamedEvent(afterDecision, { event_type: 'repair.started', metadata: { recovery: decision }, actor, github, ids, now });
  }
  if (decision.action === 'WAIT_AND_RETRY' || decision.action === 'RERUN_VERIFICATION') {
    appendNamedEvent(afterDecision, { event_type: 'retry.started', metadata: { recovery: decision }, actor, github, ids, now });
  }
  if (decision.action === 'REQUEST_HUMAN_APPROVAL') {
    appendNamedEvent(afterDecision, { event_type: 'human.approval.requested', metadata: { recovery: decision }, actor, github, ids, now });
  }
  if (afterDecision.state === 'BLOCKED') {
    appendNamedEvent(afterDecision, { event_type: 'run.blocked', metadata: { recovery: decision }, actor, github, ids, now });
  }
  reconstructState(afterDecision.events);
  return { run: afterDecision, failure, recovery: decision };
}

export function startHappyPath(run, { provider = 'cursor', actor, ids = createIdFactory(), now = () => new Date() } = {}) {
  let next = applyTransition(run, 'PLANNING', { event_type: 'planning.started', actor, ids, now });
  appendNamedEvent(next, { event_type: 'planning.completed', actor, ids, now });
  next = applyTransition(next, 'IMPLEMENTING', { event_type: 'implementation.started', actor, ids, now });
  appendNamedEvent(next, {
    event_type: 'agent.selected',
    metadata: { provider },
    actor: { ...defaultActor(actor, next.actor_harness), harness: provider === 'codex' ? 'codex' : next.actor_harness },
    ids,
    now,
  });
  appendNamedEvent(next, { event_type: 'agent.attempt.started', metadata: { provider }, actor, ids, now });
  return next;
}

export function associateGithub(run, githubPatch, { actor, ids = createIdFactory(), now = () => new Date() } = {}) {
  const next = cloneRun(run);
  next.github = {
    repository: githubPatch.repository ?? next.github.repository,
    issue: githubPatch.issue ?? next.github.issue,
    pull_request: githubPatch.pull_request ?? next.github.pull_request,
    commit_sha: githubPatch.commit_sha ?? next.github.commit_sha,
  };
  if (githubPatch.agent_id) next.agent_id = githubPatch.agent_id;
  appendNamedEvent(next, {
    event_type: 'github.associated',
    metadata: {
      agent_id: githubPatch.agent_id ?? null,
      cursor_run_id: githubPatch.cursor_run_id ?? null,
      cursor_run_id_is_not_factory_run_id: true,
    },
    actor,
    github: next.github,
    ids,
    now,
  });
  return next;
}

export function loadRunSnapshot(snapshot) {
  if (!snapshot || snapshot.schema_version !== SCHEMA_VERSION) throw new Error('unsupported factory run schema');
  if (!isFactoryRunId(snapshot.factory_run_id)) throw new Error('invalid factory_run_id');
  const reconstructed = reconstructState(snapshot.events);
  if (reconstructed.state !== snapshot.state) throw new Error('stored state does not match event log');
  if (reconstructed.factory_run_id !== snapshot.factory_run_id) throw new Error('run id mismatch');
  return snapshot;
}

export function parseTrustedControlPlane(comments) {
  const trusted = (comments ?? []).filter(isTrustedFactoryComment);
  const payloads = [];
  for (const comment of trusted) {
    try {
      const decoded = decodeControlPlane(comment.body);
      if (decoded) payloads.push({ comment, run: loadRunSnapshot(decoded) });
    } catch (error) {
      if (String(comment.body ?? '').includes('factory-control-plane:v1')) {
        return { ok: false, code: 'MALFORMED_CONTROL_PLANE', error: error.message };
      }
    }
  }
  if (payloads.length === 0) {
    const markerId = trusted.map((comment) => extractRunIdMarker(comment.body)).filter(Boolean).at(-1);
    if (markerId) return { ok: false, code: 'MALFORMED_CONTROL_PLANE', error: 'run marker without payload' };
    return { ok: false, code: 'MISSING_RUN' };
  }
  return { ok: true, run: payloads.at(-1).run, comment: payloads.at(-1).comment };
}

export function planStatusUpsert(comments, run) {
  const markdown = renderStatusMarkdown(run);
  const existing = findStatusComment(comments.filter(isTrustedFactoryComment), run.factory_run_id);
  return {
    body: markdown,
    comment_id: existing?.id ?? null,
    create: !existing,
    marker: statusMarker(run.factory_run_id),
  };
}

function resultFor(run, extras = {}) {
  const upsert = extras.comments ? planStatusUpsert(extras.comments, run) : { body: renderStatusMarkdown(run), comment_id: null, create: true };
  return {
    ok: true,
    schema_version: SCHEMA_VERSION,
    run,
    factory_run_id: run.factory_run_id,
    correlation_id: run.correlation_id,
    state: run.state,
    labels: projectLabels(run.state),
    status_markdown: upsert.body,
    status_comment_id: upsert.comment_id,
    create_status_comment: upsert.create,
    metrics: deriveMetrics(run),
    ...extras.result,
  };
}

function supersedeFactoryRun(existing, input, { actor, ids, now, comments, reason, liveness, agentId }) {
  let created = createFactoryRun({
    repository: input.repository,
    issue: input.issue,
    provider: input.provider,
    actor,
    ids,
    now,
  });
  created = startHappyPath(created, { provider: input.provider, actor, ids, now });
  const superseded = applyTransition(existing, 'CANCELLED', {
    event_type: 'run.superseded',
    metadata: {
      reason,
      trigger: input.relabelled ? 'factory:ready' : 'intake',
      agent_id: agentId,
      agent_status: liveness.status,
      run_status: liveness.runStatus,
      successor_factory_run_id: created.factory_run_id,
    },
    actor,
    ids,
    now,
  });
  const previousStatus = planStatusUpsert(comments, superseded);
  return resultFor(created, {
    comments,
    result: {
      action: 'supersede',
      reason,
      previous_run: superseded,
      previous_status_markdown: previousStatus.body,
      previous_status_comment_id: previousStatus.comment_id,
    },
  });
}

export function intakeFactoryRun(input) {
  const comments = input.comments ?? [];
  const parsed = parseTrustedControlPlane(comments);
  const agentId = extractTrustedAgentId(comments);
  const actor = defaultActor(input.actor, input.provider === 'codex' ? 'codex' : 'cursor');
  const ids = input.ids || createIdFactory();
  const now = input.now || (() => new Date());

  if (parsed.code === 'MALFORMED_CONTROL_PLANE') {
    return { ok: false, action: 'fail_closed', code: 'MALFORMED_CONTROL_PLANE', error: parsed.error };
  }

  if (parsed.ok && !input.force) {
    if (parsed.run.state === 'BLOCKED' && !parsed.run.agent_id && !agentId) {
      const resumed = applyTransition(parsed.run, 'IMPLEMENTING', {
        event_type: 'implementation.started',
        metadata: { reason: 'resume_blocked_without_agent' },
        actor,
        ids,
        now,
      });
      appendNamedEvent(resumed, { event_type: 'agent.attempt.started', metadata: { provider: input.provider }, actor, ids, now });
      return resultFor(resumed, { comments, result: { action: 'dispatch', reason: 'resume_blocked' } });
    }
    if (parsed.run.state === 'READY_FOR_HUMAN_APPROVAL') {
      return resultFor(parsed.run, { comments, result: { action: 'skip', reason: 'human_gate' } });
    }
    if (isInProgressState(parsed.run.state) || parsed.run.state === 'BLOCKED') {
      const observed = input.provider === 'codex' ? null : agentForRun(parsed.run, comments, input.agent);
      const liveness = classifyHarnessLiveness(observed);
      const thresholdMs = Number.isFinite(input.staleAfterMs) ? input.staleAfterMs : DEFAULT_STALE_RUN_MS;
      const stale = input.provider === 'codex'
        ? false
        : isFactoryRunStale(parsed.run, observed, Date.parse(nowIso(now)), thresholdMs);
      const hasPullRequest = Number.isInteger(parsed.run.github?.pull_request);
      const reason = hasPullRequest ? null : supersedeReason(liveness, stale);
      if (reason) {
        return supersedeFactoryRun(parsed.run, input, {
          actor,
          ids,
          now,
          comments,
          reason,
          liveness,
          agentId: recordedAgentId(parsed.run, comments),
        });
      }
      return resultFor(parsed.run, {
        comments,
        result: { action: 'skip', reason: liveness.running ? 'agent_running' : 'active_run' },
      });
    }
  }

  if (parsed.ok && !isTerminalState(parsed.run.state) && input.force) {
    const cancelled = applyTransition(parsed.run, 'CANCELLED', {
      event_type: 'run.cancelled',
      metadata: { reason: 'workflow_dispatch_force' },
      actor,
      ids,
      now,
    });
    const previousStatus = planStatusUpsert(comments, cancelled);
    let created = createFactoryRun({
      repository: input.repository,
      issue: input.issue,
      provider: input.provider,
      actor,
      ids,
      now,
    });
    created = startHappyPath(created, { provider: input.provider, actor, ids, now });
    return resultFor(created, {
      comments,
      result: {
        action: 'cancel_and_recreate',
        reason: 'force_new_run',
        previous_run: cancelled,
        previous_status_markdown: previousStatus.body,
        previous_status_comment_id: previousStatus.comment_id,
      },
    });
  }

  if (!parsed.ok && agentId) {
    return {
      ok: false,
      action: 'fail_closed',
      code: 'IN_FLIGHT_MISSING_RUN',
      error: 'In-flight factory issue has a harness agent but no canonical run id',
      agent_id: agentId,
    };
  }

  let created = createFactoryRun({
    repository: input.repository,
    issue: input.issue,
    provider: input.provider,
    actor,
    ids,
    now,
  });
  created = startHappyPath(created, { provider: input.provider, actor, ids, now });
  return resultFor(created, { comments, result: { action: 'dispatch', reason: parsed.ok ? 'terminal_restart' : 'new_run' } });
}

export function applyRepairSignal(input) {
  const parsed = parseTrustedControlPlane(input.comments ?? []);
  const ids = input.ids || createIdFactory();
  const now = input.now || (() => new Date());
  const actor = defaultActor(input.actor, 'cursor');
  if (!parsed.ok) {
    return { ok: false, action: 'fail_closed', code: parsed.code || 'MISSING_RUN', dispatch: false };
  }
  const github = {
    ...parsed.run.github,
    pull_request: input.pull_request ?? parsed.run.github.pull_request,
    commit_sha: input.head_sha ?? parsed.run.github.commit_sha,
  };
  let run = parsed.run;
  if (github.pull_request !== parsed.run.github.pull_request || github.commit_sha !== parsed.run.github.commit_sha) {
    run = associateGithub(run, github, { actor, ids, now });
  }
  const failure = classifyFactorySignal({
    kind: input.kind,
    source: input.source,
    message: input.message,
    factory_run_id: run.factory_run_id,
    correlation_id: run.correlation_id,
    references: input.references ?? [],
  });
  const recorded = recordFailureAndRecovery(run, failure, {
    actor,
    github,
    ids,
    now,
    repairAttempts: Number.isInteger(input.repair_attempts) ? input.repair_attempts : run.repair_attempts,
  });
  const recovery = recorded.recovery;
  const dispatch = recovery.action === 'REPAIR' || recovery.action === 'REBASE_REPAIR';
  if (dispatch && recovery.consumeRepairAttempt) recorded.run.repair_attempts += 1;
  return resultFor(recorded.run, {
    comments: input.comments,
    result: {
      action: dispatch ? 'repair' : recovery.action === 'FAIL_CLOSED' || recovery.action === 'BLOCK_FOR_HUMAN' || recovery.action === 'REQUEST_HUMAN_APPROVAL' ? 'fail_closed' : 'no_dispatch',
      dispatch,
      recovery,
      failure: recorded.failure,
    },
  });
}

export function applyControllerSignal(input) {
  const parsed = parseTrustedControlPlane(input.comments ?? []);
  if (!parsed.ok) {
    return { ok: false, action: 'fail_closed', code: parsed.code || 'MISSING_RUN', merge: false };
  }
  const ids = input.ids || createIdFactory();
  const now = input.now || (() => new Date());
  const actor = defaultActor(input.actor, parsed.run.actor_harness);
  let run = parsed.run;
  if (input.head_sha || input.pull_request) {
    run = associateGithub(run, {
      ...run.github,
      pull_request: input.pull_request ?? run.github.pull_request,
      commit_sha: input.head_sha ?? run.github.commit_sha,
    }, { actor, ids, now });
  }

  if (input.kind === 'e2e_consumer') {
    const recorded = recordFailureAndRecovery(run, classifyFactorySignal({
      kind: 'e2e_consumer',
      factory_run_id: run.factory_run_id,
      correlation_id: run.correlation_id,
      message: input.message,
      references: input.references ?? [],
    }), { actor, ids, now });
    return resultFor(recorded.run, { comments: input.comments, result: { action: 'fail_closed', merge: false, recovery: recorded.recovery } });
  }

  if (input.risk && input.risk !== 'low') {
    const recorded = recordFailureAndRecovery(run, classifyFactorySignal({
      kind: 'policy',
      category: 'POLICY_OR_GUARDRAIL_FAILURE',
      factory_run_id: run.factory_run_id,
      correlation_id: run.correlation_id,
      message: `Factory verification passed, but ${input.risk}-risk changes require human approval.`,
      source: 'controller',
      code: 'non_low_risk',
    }), { actor, ids, now, risk: input.risk });
    return resultFor(recorded.run, {
      comments: input.comments,
      result: { action: 'human_approval', merge: false, recovery: recorded.recovery },
    });
  }

  if (input.merged) {
    let next = run;
    if (next.state !== 'READY_FOR_HUMAN_APPROVAL' && next.state !== 'REVIEWING' && next.state !== 'VERIFYING' && next.state !== 'IMPLEMENTING') {
      return { ok: false, action: 'fail_closed', code: 'UNSAFE_COMPLETE', merge: false };
    }
    const towardComplete = ['VERIFYING', 'REVIEWING', 'READY_FOR_HUMAN_APPROVAL', 'COMPLETED'];
    for (const state of towardComplete) {
      if (next.state === 'COMPLETED') break;
      if (next.state === state) continue;
      if (state === 'COMPLETED') {
        next = applyTransition(next, 'COMPLETED', { event_type: 'run.completed', actor, ids, now });
      } else {
        try {
          next = applyTransition(next, state, { actor, ids, now });
        } catch {
          return { ok: false, action: 'fail_closed', code: 'UNSAFE_COMPLETE', merge: false };
        }
      }
    }
    return resultFor(next, { comments: input.comments, result: { action: 'completed', merge: true } });
  }

  return resultFor(run, { comments: input.comments, result: { action: 'continue', merge: input.risk === 'low' } });
}

export function applyIntakeFailure(run, kind, { actor, ids = createIdFactory(), now = () => new Date() } = {}) {
  return recordFailureAndRecovery(run, classifyFactorySignal({
    kind,
    factory_run_id: run.factory_run_id,
    correlation_id: run.correlation_id,
  }), { actor, ids, now }).run;
}

export function advanceFactoryRun(input) {
  const parsed = parseTrustedControlPlane(input.comments ?? []);
  if (!parsed.ok) return { ok: false, action: 'fail_closed', code: parsed.code || 'MISSING_RUN' };
  const ids = input.ids || createIdFactory();
  const now = input.now || (() => new Date());
  const actor = defaultActor(input.actor, parsed.run.actor_harness);
  let run = parsed.run;
  if (input.head_sha || input.pull_request) {
    run = associateGithub(run, {
      pull_request: input.pull_request ?? run.github.pull_request,
      commit_sha: input.head_sha ?? run.github.commit_sha,
    }, { actor, ids, now });
  }
  if (input.phase === 'verifying') {
    if (['VERIFYING', 'REVIEWING', 'READY_FOR_HUMAN_APPROVAL', 'COMPLETED'].includes(run.state)) {
      return resultFor(run, { comments: input.comments, result: { action: 'skip', reason: 'already_advanced' } });
    }
    if (run.state !== 'IMPLEMENTING') return { ok: false, action: 'fail_closed', code: 'UNSAFE_ADVANCE' };
    run = applyTransition(run, 'VERIFYING', { event_type: 'verification.started', actor, ids, now });
    return resultFor(run, { comments: input.comments, result: { action: 'advanced', phase: 'verifying' } });
  }
  if (input.phase === 'reviewing') {
    if (['REVIEWING', 'READY_FOR_HUMAN_APPROVAL', 'COMPLETED'].includes(run.state)) {
      return resultFor(run, { comments: input.comments, result: { action: 'skip', reason: 'already_advanced' } });
    }
    if (run.state === 'IMPLEMENTING') {
      run = applyTransition(run, 'VERIFYING', { event_type: 'verification.started', actor, ids, now });
    }
    if (run.state !== 'VERIFYING') return { ok: false, action: 'fail_closed', code: 'UNSAFE_ADVANCE' };
    const next = cloneRun(run);
    appendNamedEvent(next, { event_type: 'verification.completed', actor, ids, now });
    run = applyTransition(next, 'REVIEWING', { event_type: 'review.started', actor, ids, now });
    return resultFor(run, { comments: input.comments, result: { action: 'advanced', phase: 'reviewing' } });
  }
  return { ok: false, action: 'fail_closed', code: 'UNKNOWN_PHASE' };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const op = process.argv[2];
  const file = process.argv[3];
  let raw = '';
  if (file && file !== '-') {
    const fs = await import('node:fs');
    raw = fs.readFileSync(file, 'utf8');
  } else if (!process.stdin.isTTY) {
    raw = await readStdin();
  }
  const input = raw.trim() ? JSON.parse(raw) : {};
  let result;
  switch (op) {
    case 'intake':
      result = intakeFactoryRun(input);
      break;
    case 'repair-signal':
      result = applyRepairSignal(input);
      break;
    case 'controller-signal':
      result = applyControllerSignal(input);
      break;
    case 'parse':
      result = parseTrustedControlPlane(input.comments ?? input);
      break;
    case 'associate': {
      const parsed = parseTrustedControlPlane(input.comments ?? []);
      if (!parsed.ok) {
        result = { ok: false, action: 'fail_closed', code: parsed.code };
        break;
      }
      const run = associateGithub(parsed.run, {
        agent_id: input.agent_id,
        pull_request: input.pull_request,
        commit_sha: input.commit_sha,
        cursor_run_id: input.cursor_run_id,
        repository: input.repository,
        issue: input.issue,
      }, { actor: input.actor });
      result = resultFor(run, { comments: input.comments, result: { action: 'associated' } });
      break;
    }
    case 'advance':
      result = advanceFactoryRun(input);
      break;
    case 'intake-failure': {
      const parsed = parseTrustedControlPlane(input.comments ?? []);
      if (!parsed.ok) {
        result = { ok: false, action: 'fail_closed', code: parsed.code };
        break;
      }
      const run = applyIntakeFailure(parsed.run, input.kind, { actor: input.actor });
      result = resultFor(run, { comments: input.comments, result: { action: 'fail_closed', failure: run.latest_failure, recovery: run.latest_recovery } });
      break;
    }
    default:
      throw new Error(`unknown control-plane op ${op}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(modulePath)) {
  await main();
}
