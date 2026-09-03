import { isFactoryCorrelationId, isFactoryEventId, isFactoryRunId } from './run-id.mjs';
import { assertTransition, isFactoryState } from './state-machine.mjs';

export const SCHEMA_VERSION = '1';

export const ACTOR_TYPES = Object.freeze(['agent', 'workflow', 'human', 'system']);
export const HARNESSES = Object.freeze(['codex', 'cursor', 'claude', 'other']);

export const EVENT_TYPES = Object.freeze([
  'run.created',
  'planning.started',
  'planning.completed',
  'implementation.started',
  'implementation.completed',
  'agent.selected',
  'agent.attempt.started',
  'agent.attempt.completed',
  'state.transitioned',
  'verification.started',
  'verification.completed',
  'evidence.produced',
  'evidence.invalidated',
  'review.started',
  'review.completed',
  'failure.detected',
  'recovery.decided',
  'retry.started',
  'repair.started',
  'human.approval.requested',
  'human.approval.received',
  'human.approval.rejected',
  'run.completed',
  'run.cancelled',
  'run.blocked',
  'github.associated',
  'status.updated',
]);

const EVENT_KEYS = Object.freeze([
  'schema_version',
  'event_id',
  'factory_run_id',
  'correlation_id',
  'causation_id',
  'timestamp',
  'event_type',
  'state',
  'actor',
  'github',
  'metadata',
]);

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function nowIso(now = () => new Date()) {
  return new Date(now()).toISOString();
}

export function stableSerialize(value) {
  return JSON.stringify(value);
}

function assertActor(actor) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) throw new Error('invalid actor');
  if (!ACTOR_TYPES.includes(actor.type)) throw new Error('invalid actor.type');
  if (typeof actor.name !== 'string' || actor.name.length < 1) throw new Error('invalid actor.name');
  if (!HARNESSES.includes(actor.harness)) throw new Error('invalid actor.harness');
  for (const key of Object.keys(actor)) {
    if (!['type', 'name', 'harness'].includes(key)) throw new Error(`unexpected actor field ${key}`);
  }
}

function assertGithub(github) {
  if (!github || typeof github !== 'object' || Array.isArray(github)) throw new Error('invalid github');
  if (typeof github.repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(github.repository)) {
    throw new Error('invalid github.repository');
  }
  for (const key of ['issue', 'pull_request']) {
    const value = github[key];
    if (value != null && (!Number.isInteger(value) || value < 1)) throw new Error(`invalid github.${key}`);
  }
  if (github.commit_sha != null && !/^[0-9a-f]{40}$/.test(github.commit_sha)) throw new Error('invalid github.commit_sha');
  for (const key of Object.keys(github)) {
    if (!['repository', 'issue', 'pull_request', 'commit_sha'].includes(key)) throw new Error(`unexpected github field ${key}`);
  }
}

export function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('invalid event');
  for (const key of Object.keys(event)) {
    if (!EVENT_KEYS.includes(key)) throw new Error(`unexpected event field ${key}`);
  }
  for (const key of EVENT_KEYS) {
    if (!(key in event)) throw new Error(`missing event field ${key}`);
  }
  if (event.schema_version !== SCHEMA_VERSION) throw new Error('unsupported event schema_version');
  if (!isFactoryEventId(event.event_id)) throw new Error('invalid event_id');
  if (!isFactoryRunId(event.factory_run_id)) throw new Error('invalid factory_run_id');
  if (!isFactoryCorrelationId(event.correlation_id)) throw new Error('invalid correlation_id');
  if (event.causation_id != null && event.causation_id !== '' && !isFactoryEventId(event.causation_id)) {
    throw new Error('invalid causation_id');
  }
  if (typeof event.timestamp !== 'string' || !ISO_UTC_RE.test(event.timestamp)) throw new Error('invalid timestamp');
  if (!EVENT_TYPES.includes(event.event_type)) throw new Error('invalid event_type');
  if (!isFactoryState(event.state)) throw new Error('invalid event state');
  assertActor(event.actor);
  assertGithub(event.github);
  if (!event.metadata || typeof event.metadata !== 'object' || Array.isArray(event.metadata)) {
    throw new Error('invalid metadata');
  }
  return event;
}

export function createEvent(input) {
  const event = {
    schema_version: SCHEMA_VERSION,
    event_id: input.event_id,
    factory_run_id: input.factory_run_id,
    correlation_id: input.correlation_id,
    causation_id: input.causation_id ?? null,
    timestamp: input.timestamp ?? nowIso(),
    event_type: input.event_type,
    state: input.state,
    actor: {
      type: input.actor.type,
      name: input.actor.name,
      harness: input.actor.harness,
    },
    github: {
      repository: input.github.repository,
      issue: input.github.issue ?? null,
      pull_request: input.github.pull_request ?? null,
      commit_sha: input.github.commit_sha ?? null,
    },
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? { ...input.metadata } : {},
  };
  validateEvent(event);
  return Object.freeze(event);
}

export function assertAppendOnly(previousEvents, nextEvents) {
  if (!Array.isArray(previousEvents) || !Array.isArray(nextEvents)) throw new Error('event log must be an array');
  if (nextEvents.length < previousEvents.length) throw new Error('event log is not append-only');
  for (let i = 0; i < previousEvents.length; i += 1) {
    if (stableSerialize(previousEvents[i]) !== stableSerialize(nextEvents[i])) {
      throw new Error('historical factory events cannot be mutated');
    }
  }
}

export function appendEvent(events, event) {
  const current = Array.isArray(events) ? events : [];
  const nextEvent = validateEvent(event);
  const existing = current.find((item) => item.event_id === nextEvent.event_id);
  if (existing) {
    if (stableSerialize(existing) !== stableSerialize(nextEvent)) {
      throw new Error('duplicate event_id with different payload');
    }
    return current;
  }
  const next = [...current, Object.freeze({ ...nextEvent, actor: { ...nextEvent.actor }, github: { ...nextEvent.github }, metadata: { ...nextEvent.metadata } })];
  assertAppendOnly(current, next);
  return next;
}

export function reconstructState(events) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('event log is empty');
  events.forEach(validateEvent);
  if (events[0].event_type !== 'run.created' || events[0].state !== 'CREATED') {
    throw new Error('event log must start with run.created');
  }
  const runId = events[0].factory_run_id;
  let state = 'CREATED';
  const history = ['CREATED'];
  for (let i = 1; i < events.length; i += 1) {
    const event = events[i];
    if (event.factory_run_id !== runId) throw new Error('event factory_run_id mismatch');
    if (event.event_type === 'state.transitioned') {
      const from = event.metadata?.from;
      const to = event.metadata?.to ?? event.state;
      if (from !== state) throw new Error('state history is not reconstructable');
      assertTransition(from, to);
      if (event.state !== to) throw new Error('transition event state must be the target state');
      state = to;
      history.push(state);
    } else if (event.state !== state) {
      throw new Error(`event ${event.event_id} does not match canonical state`);
    }
  }
  return { factory_run_id: runId, state, history };
}
