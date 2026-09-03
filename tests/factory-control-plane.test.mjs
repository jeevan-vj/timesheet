import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createIdFactory, generateFactoryRunId, isFactoryRunId } from '../.factory/run-id.mjs';
import { ALLOWED_TRANSITIONS, FACTORY_STATES, assertTransition, canTransition, projectLabels } from '../.factory/state-machine.mjs';
import { EVENT_TYPES, appendEvent, assertAppendOnly, createEvent, reconstructState, validateEvent } from '../.factory/events.mjs';
import { FAILURE_CATEGORIES, classifyFactorySignal, createFailureRecord } from '../.factory/failures.mjs';
import { decideRecovery } from '../.factory/recovery.mjs';
import { decodeControlPlane, renderStatusMarkdown, statusMarker } from '../.factory/status-comment.mjs';
import {
  applyControllerSignal,
  applyIntakeFailure,
  applyRepairSignal,
  associateGithub,
  advanceFactoryRun,
  createFactoryRun,
  deriveMetrics,
  extractTrustedAgentId,
  intakeFactoryRun,
  parseTrustedControlPlane,
  startHappyPath,
} from '../.factory/control-plane.mjs';

let idSeq = 0;
function sequentialIds() {
  return createIdFactory(() => {
    idSeq += 1;
    return `00000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`;
  });
}

function botComment(body, id = 11) {
  return { id, user: { login: 'github-actions[bot]', type: 'Bot' }, body };
}

function actor() {
  return { type: 'workflow', name: 'Factory Intake', harness: 'cursor' };
}

describe('factory control plane', () => {
  it('mints unique immutable factory run ids and rejects harness/GitHub ids', () => {
    const ids = sequentialIds();
    const a = generateFactoryRunId(ids);
    const b = generateFactoryRunId(ids);
    expect(a).toMatch(/^frun-/);
    expect(a).not.toEqual(b);
    expect(isFactoryRunId(a)).toBe(true);
    expect(isFactoryRunId('bc-62f6c02f-9cb6-4a3e-b4e6-59bfc95bfc4a')).toBe(false);
    expect(isFactoryRunId('1234567890')).toBe(false);
    expect(isFactoryRunId('run-test')).toBe(false);
  });

  it('allows only the canonical transition matrix and fails closed otherwise', () => {
    expect(canTransition('CREATED', 'PLANNING')).toBe(true);
    expect(canTransition('IMPLEMENTING', 'VERIFYING')).toBe(true);
    expect(canTransition('REVIEWING', 'READY_FOR_HUMAN_APPROVAL')).toBe(true);
    expect(canTransition('READY_FOR_HUMAN_APPROVAL', 'COMPLETED')).toBe(true);
    expect(canTransition('IMPLEMENTING', 'COMPLETED')).toBe(false);
    expect(canTransition('COMPLETED', 'IMPLEMENTING')).toBe(false);
    expect(canTransition('FAILED', 'PLANNING')).toBe(false);
    expect(() => assertTransition('VERIFYING', 'COMPLETED')).toThrow(/invalid factory transition/);
    for (const from of FACTORY_STATES) {
      for (const to of FACTORY_STATES) {
        expect(canTransition(from, to)).toBe(ALLOWED_TRANSITIONS[from].includes(to));
      }
    }
  });

  it('reconstructs state from an append-only event log and rejects mutation or extra fields', () => {
    const ids = sequentialIds();
    let run = createFactoryRun({ repository: 'jeevan-vj/timesheet', issue: 40, actor: actor(), ids });
    run = startHappyPath(run, { actor: actor(), ids, provider: 'cursor' });
    const folded = reconstructState(run.events);
    expect(folded.state).toBe('IMPLEMENTING');
    expect(folded.history[0]).toBe('CREATED');
    expect(run.events[0].event_type).toBe('run.created');
    expect(run.events[1].causation_id).toBe(run.events[0].event_id);
    expect(run.events.every((event) => EVENT_TYPES.includes(event.event_type))).toBe(true);

    expect(() => validateEvent({ ...run.events[0], extra: true })).toThrow(/unexpected event field/);
    expect(() => createEvent({ ...run.events[0], timestamp: 'not-a-date' })).toThrow(/invalid timestamp/);

    const mutated = structuredClone(run.events);
    mutated[0] = { ...mutated[0], metadata: { ...mutated[0].metadata, tampered: true } };
    expect(() => assertAppendOnly(run.events, mutated)).toThrow(/append-only|cannot be mutated/);
    expect(() => appendEvent(run.events, { ...run.events[0], metadata: { tampered: true } })).toThrow(/duplicate event_id/);
    expect(appendEvent(run.events, run.events[0])).toEqual(run.events);
  });

  it('classifies failures and makes deterministic recovery decisions without a live harness', () => {
    const ids = sequentialIds();
    const run = startHappyPath(createFactoryRun({ repository: 'jeevan-vj/timesheet', issue: 40, ids, actor: actor() }), { ids, actor: actor() });
    const ctx = { factory_run_id: run.factory_run_id, correlation_id: run.correlation_id };

    expect(FAILURE_CATEGORIES).toHaveLength(16);
    expect(classifyFactorySignal({ ...ctx, kind: 'unknown-kind' }).category).toBe('UNKNOWN_FAILURE');
    expect(classifyFactorySignal({ ...ctx, kind: 'unknown-kind' }).retryable).toBe(false);

    const testFailure = classifyFactorySignal({ ...ctx, kind: 'ci' });
    expect(testFailure.category).toBe('TEST_FAILURE');
    expect(testFailure.retryable).toBe(true);
    expect(decideRecovery({ state: 'IMPLEMENTING', failure: testFailure, repairAttempts: 0 }).action).toBe('REPAIR');
    expect(decideRecovery({ state: 'IMPLEMENTING', failure: testFailure, repairAttempts: 2 }).action).toBe('BLOCK_FOR_HUMAN');

    const stale = classifyFactorySignal({ ...ctx, kind: 'e2e_stale' });
    expect(decideRecovery({ state: 'VERIFYING', failure: stale, repairAttempts: 0 })).toMatchObject({
      action: 'RERUN_VERIFICATION',
      nextState: null,
      consumeRepairAttempt: false,
    });

    const missing = classifyFactorySignal({ ...ctx, kind: 'e2e_consumer' });
    expect(decideRecovery({ state: 'VERIFYING', failure: missing }).action).toBe('BLOCK_FOR_HUMAN');

    const unknown = createFailureRecord({ ...ctx, category: 'NOT_A_CATEGORY', retryable: true, source: 'test' });
    expect(unknown.category).toBe('UNKNOWN_FAILURE');
    expect(unknown.retryable).toBe(false);
    expect(decideRecovery({ state: 'IMPLEMENTING', failure: unknown }).action).toBe('FAIL_CLOSED');
    expect(decideRecovery({
      state: 'IMPLEMENTING',
      failure: classifyFactorySignal({ ...ctx, kind: 'merge_conflict' }),
      repairAttempts: 0,
    }).action).toBe('REBASE_REPAIR');

    expect(decideRecovery({ state: 'IMPLEMENTING', failure: classifyFactorySignal({ ...ctx, kind: 'policy' }), risk: 'protected' }).action).toBe('REQUEST_HUMAN_APPROVAL');
    expect(decideRecovery({ state: 'COMPLETED', failure: testFailure }).action).toBe('FAIL_CLOSED');
    expect(createFailureRecord({ ...ctx, category: 'TEST_FAILURE', message: 'Bearer secret-token', source: 'test', retryable: true, code: 'x' }).message).toBe('redacted factory failure');
  });

  it('creates one status comment identity and projects canonical state rather than labels', () => {
    const ids = sequentialIds();
    const run = startHappyPath(createFactoryRun({ repository: 'jeevan-vj/timesheet', issue: 40, ids, actor: actor() }), { ids, actor: actor() });
    const markdown = renderStatusMarkdown(run);
    expect(markdown).toContain(`**Run:** \`${run.factory_run_id}\``);
    expect(markdown).toContain('**State:** `IMPLEMENTING`');
    expect(markdown).toContain(statusMarker(run.factory_run_id));
    expect(markdown).toContain(run.correlation_id);
    expect(decodeControlPlane(markdown).factory_run_id).toBe(run.factory_run_id);
    expect(projectLabels('IMPLEMENTING').add).toContain('factory:implementing');
    expect(projectLabels('READY_FOR_HUMAN_APPROVAL').add).toContain('factory:needs-human');
    expect(projectLabels('BLOCKED').add).toContain('factory:needs-human');
    expect(projectLabels('FAILED').add).toContain('factory:needs-human');
  });

  it('fails closed for in-flight issues that have a harness agent but no run id', () => {
    const comments = [botComment('Cursor Cloud Agent API-verified\n\n<!-- factory-agent-id:bc-existing -->')];
    expect(extractTrustedAgentId(comments)).toBe('bc-existing');
    const missing = intakeFactoryRun({
      comments,
      repository: 'jeevan-vj/timesheet',
      issue: 40,
      provider: 'cursor',
      actor: actor(),
    });
    expect(missing).toMatchObject({ ok: false, action: 'fail_closed', code: 'IN_FLIGHT_MISSING_RUN' });
    expect(parseTrustedControlPlane(comments).code).toBe('MISSING_RUN');
    expect(applyRepairSignal({ comments, kind: 'ci' }).dispatch).toBe(false);
    expect(applyControllerSignal({ comments, risk: 'low', merged: true }).merge).toBe(false);
  });

  it('ignores untrusted comments and issue-body run ids', () => {
    const ids = sequentialIds();
    const run = startHappyPath(createFactoryRun({ repository: 'jeevan-vj/timesheet', issue: 40, ids, actor: actor() }), { ids, actor: actor() });
    const forged = {
      id: 99,
      user: { login: 'attacker', type: 'User' },
      body: renderStatusMarkdown(run),
    };
    expect(parseTrustedControlPlane([forged]).code).toBe('MISSING_RUN');
    expect(parseTrustedControlPlane([botComment(renderStatusMarkdown(run))]).ok).toBe(true);
  });

  it('reuses an active run and only mints a new id after cancel-on-force or a terminal restart', () => {
    const first = intakeFactoryRun({
      comments: [],
      repository: 'jeevan-vj/timesheet',
      issue: 40,
      provider: 'cursor',
      actor: actor(),
      ids: sequentialIds(),
    });
    expect(first.action).toBe('dispatch');
    expect(first.run.state).toBe('IMPLEMENTING');
    const persisted = [botComment(first.status_markdown)];
    const skipped = intakeFactoryRun({
      comments: persisted,
      repository: 'jeevan-vj/timesheet',
      issue: 40,
      provider: 'cursor',
      actor: actor(),
      force: false,
      ids: sequentialIds(),
    });
    expect(skipped.action).toBe('skip');
    expect(skipped.factory_run_id).toBe(first.factory_run_id);

    const forced = intakeFactoryRun({
      comments: persisted,
      repository: 'jeevan-vj/timesheet',
      issue: 40,
      provider: 'cursor',
      actor: actor(),
      force: true,
      ids: sequentialIds(),
    });
    expect(forced.action).toBe('cancel_and_recreate');
    expect(forced.previous_run.state).toBe('CANCELLED');
    expect(forced.factory_run_id).not.toBe(first.factory_run_id);
  });

  it('routes repairable CI to repair, unknown failures closed, and protected risk to human approval', () => {
    const created = intakeFactoryRun({
      comments: [],
      repository: 'jeevan-vj/timesheet',
      issue: 40,
      provider: 'cursor',
      actor: actor(),
      ids: sequentialIds(),
    });
    const comments = [botComment(created.status_markdown)];
    const ci = applyRepairSignal({ comments, kind: 'ci', source: 'gate', head_sha: 'a'.repeat(40), pull_request: 12, ids: sequentialIds() });
    expect(ci.dispatch).toBe(true);
    expect(ci.recovery.action).toBe('REPAIR');
    expect(ci.run.state).toBe('REPAIR_REQUIRED');
    expect(ci.status_markdown).toContain('TEST_FAILURE');
    expect(ci.status_markdown).toContain('REPAIR');
    expect(findEvent(ci.run, 'recovery.decided')).toBeTruthy();

    const unknown = applyRepairSignal({ comments, kind: 'mystery', ids: sequentialIds() });
    expect(unknown.dispatch).toBe(false);
    expect(unknown.recovery.action).toBe('FAIL_CLOSED');
    expect(unknown.run.state).toBe('BLOCKED');

    const human = applyControllerSignal({ comments, risk: 'protected', head_sha: 'b'.repeat(40), pull_request: 12, ids: sequentialIds() });
    expect(human.merge).toBe(false);
    expect(human.run.state).toBe('READY_FOR_HUMAN_APPROVAL');
    expect(findEvent(human.run, 'human.approval.requested')).toBeTruthy();

    const completed = applyControllerSignal({
      comments: [botComment(created.status_markdown)],
      merged: true,
      risk: 'low',
      head_sha: 'd'.repeat(40),
      pull_request: 12,
      ids: sequentialIds(),
    });
    expect(completed.ok).toBe(true);
    expect(completed.run.state).toBe('COMPLETED');
  });

  it('resumes a BLOCKED run that has no harness agent instead of skipping factory:ready', () => {
    const created = intakeFactoryRun({
      comments: [],
      repository: 'jeevan-vj/timesheet',
      issue: 40,
      provider: 'cursor',
      actor: actor(),
      ids: sequentialIds(),
    });
    const blocked = applyIntakeFailure(created.run, 'dispatch_auth', { ids: sequentialIds(), actor: actor() });
    expect(blocked.state).toBe('BLOCKED');
    const resumed = intakeFactoryRun({
      comments: [botComment(renderStatusMarkdown(blocked))],
      repository: 'jeevan-vj/timesheet',
      issue: 40,
      provider: 'cursor',
      actor: actor(),
      force: false,
      ids: sequentialIds(),
    });
    expect(resumed.action).toBe('dispatch');
    expect(resumed.factory_run_id).toBe(blocked.factory_run_id);
    expect(resumed.run.state).toBe('IMPLEMENTING');
  });

  it('patches the cancelled status comment on force recreate and mints a new run comment', () => {
    const first = intakeFactoryRun({
      comments: [],
      repository: 'jeevan-vj/timesheet',
      issue: 40,
      provider: 'cursor',
      actor: actor(),
      ids: sequentialIds(),
    });
    const comments = [botComment(first.status_markdown, 42)];
    const forced = intakeFactoryRun({
      comments,
      repository: 'jeevan-vj/timesheet',
      issue: 40,
      provider: 'cursor',
      actor: actor(),
      force: true,
      ids: sequentialIds(),
    });
    expect(forced.action).toBe('cancel_and_recreate');
    expect(forced.previous_status_comment_id).toBe(42);
    expect(forced.previous_status_markdown).toContain('CANCELLED');
    expect(forced.previous_status_markdown).toContain(first.factory_run_id);
    expect(forced.create_status_comment).toBe(true);
    expect(forced.factory_run_id).not.toBe(first.factory_run_id);
  });

  it('advances verifying and reviewing as distinct phases before merge', () => {
    let t = 0;
    const now = () => new Date(Date.UTC(2026, 8, 3, 10, 0, t++));
    const created = intakeFactoryRun({
      comments: [],
      repository: 'jeevan-vj/timesheet',
      issue: 40,
      provider: 'cursor',
      actor: actor(),
      ids: sequentialIds(),
      now,
    });
    const verifying = advanceFactoryRun({
      comments: [botComment(created.status_markdown)],
      phase: 'verifying',
      head_sha: 'e'.repeat(40),
      pull_request: 12,
      ids: sequentialIds(),
      now,
    });
    expect(verifying.run.state).toBe('VERIFYING');
    expect(findEvent(verifying.run, 'verification.started')).toBeTruthy();
    const reviewing = advanceFactoryRun({
      comments: [botComment(verifying.status_markdown)],
      phase: 'reviewing',
      head_sha: 'e'.repeat(40),
      pull_request: 12,
      ids: sequentialIds(),
      now,
    });
    expect(reviewing.run.state).toBe('REVIEWING');
    expect(findEvent(reviewing.run, 'verification.completed')).toBeTruthy();
    expect(findEvent(reviewing.run, 'review.started')).toBeTruthy();
    const metrics = deriveMetrics(reviewing.run);
    expect(metrics.state_durations_ms.VERIFYING).toBeGreaterThan(0);
  });

  it('propagates github association and derived metrics timestamps/dimensions', () => {
    const ids = sequentialIds();
    let run = startHappyPath(createFactoryRun({ repository: 'jeevan-vj/timesheet', issue: 40, ids, actor: actor() }), { ids, actor: actor() });
    run = associateGithub(run, { pull_request: 41, commit_sha: 'c'.repeat(40), agent_id: 'bc-test' }, { ids, actor: actor() });
    expect(run.github.pull_request).toBe(41);
    expect(run.github.commit_sha).toHaveLength(40);
    expect(run.agent_id).toBe('bc-test');
    const metrics = deriveMetrics(run);
    expect(metrics.factory_run_id).toBe(run.factory_run_id);
    expect(metrics).toHaveProperty('run_duration_ms');
    expect(metrics).toHaveProperty('state_durations_ms');
    expect(metrics).toHaveProperty('retry_count');
    expect(metrics).toHaveProperty('repair_loop_count');
    expect(metrics).toHaveProperty('failures_by_category');
    expect(metrics).toHaveProperty('harness_outcomes');
  });

  it('keeps versioned schema contracts aligned with the runtime enums', () => {
    const eventSchema = JSON.parse(fs.readFileSync(new URL('../.factory/schemas/factory-event.schema.json', import.meta.url), 'utf8'));
    const failureSchema = JSON.parse(fs.readFileSync(new URL('../.factory/schemas/factory-failure.schema.json', import.meta.url), 'utf8'));
    expect(eventSchema.properties.schema_version.const).toBe('1');
    expect(eventSchema.properties.event_type.enum).toEqual([...EVENT_TYPES]);
    expect(failureSchema.properties.category.enum).toEqual([...FAILURE_CATEGORIES]);
    expect(eventSchema.additionalProperties).toBe(false);
    expect(failureSchema.additionalProperties).toBe(false);
  });
});

function findEvent(run, type) {
  return run.events.find((event) => event.event_type === type);
}
