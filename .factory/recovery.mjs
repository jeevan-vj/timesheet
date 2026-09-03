import { FAILURE_CATEGORIES } from './failures.mjs';
import { canTransition, isFactoryState, isTerminalState } from './state-machine.mjs';

export const SCHEMA_VERSION = '1';

export const RECOVERY_ACTIONS = Object.freeze([
  'REPAIR',
  'RERUN_VERIFICATION',
  'WAIT_AND_RETRY',
  'REBASE_REPAIR',
  'BLOCK_FOR_HUMAN',
  'REQUEST_HUMAN_APPROVAL',
  'FAIL_CLOSED',
]);

export const DEFAULT_RECOVERY_POLICY = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  maxRepairAttempts: 2,
});

const CATEGORY_POLICY = Object.freeze({
  TEST_FAILURE: { action: 'REPAIR', nextState: 'REPAIR_REQUIRED', exhausted: 'BLOCKED', consumeRepairAttempt: true },
  BUILD_FAILURE: { action: 'REPAIR', nextState: 'REPAIR_REQUIRED', exhausted: 'BLOCKED', consumeRepairAttempt: true },
  IMPLEMENTATION_FAILURE: { action: 'REPAIR', nextState: 'REPAIR_REQUIRED', exhausted: 'BLOCKED', consumeRepairAttempt: true },
  PLANNING_FAILURE: { action: 'REPAIR', nextState: 'REPAIR_REQUIRED', exhausted: 'BLOCKED', consumeRepairAttempt: true },
  REVIEW_FAILURE: { action: 'REPAIR', nextState: 'REPAIR_REQUIRED', exhausted: 'BLOCKED', consumeRepairAttempt: true, invalidateEvidence: true },
  VERIFICATION_FAILURE: { action: 'REPAIR', nextState: 'REPAIR_REQUIRED', exhausted: 'BLOCKED', consumeRepairAttempt: true },
  EVIDENCE_STALE: { action: 'RERUN_VERIFICATION', nextState: 'VERIFYING', consumeRepairAttempt: false },
  EVIDENCE_MISSING: { action: 'BLOCK_FOR_HUMAN', nextState: 'BLOCKED', consumeRepairAttempt: false },
  AUTH_OR_PERMISSION_FAILURE: { action: 'BLOCK_FOR_HUMAN', nextState: 'BLOCKED', consumeRepairAttempt: false },
  RATE_LIMIT_OR_QUOTA: { action: 'WAIT_AND_RETRY', nextState: 'BLOCKED', consumeRepairAttempt: false },
  TIMEOUT: { action: 'WAIT_AND_RETRY', nextState: 'BLOCKED', consumeRepairAttempt: false },
  HARNESS_FAILURE: { action: 'BLOCK_FOR_HUMAN', nextState: 'BLOCKED', consumeRepairAttempt: false },
  INFRASTRUCTURE_FAILURE: { action: 'WAIT_AND_RETRY', nextState: 'BLOCKED', consumeRepairAttempt: false },
  POLICY_OR_GUARDRAIL_FAILURE: { action: 'REQUEST_HUMAN_APPROVAL', nextState: 'READY_FOR_HUMAN_APPROVAL', consumeRepairAttempt: false },
  MERGE_CONFLICT: { action: 'REBASE_REPAIR', nextState: 'REPAIR_REQUIRED', exhausted: 'BLOCKED', consumeRepairAttempt: true },
  UNKNOWN_FAILURE: { action: 'FAIL_CLOSED', nextState: 'BLOCKED', consumeRepairAttempt: false },
});

function failClosed(reason, extras = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    action: 'FAIL_CLOSED',
    retryable: false,
    nextState: extras.nextState ?? null,
    consumeRepairAttempt: false,
    invalidateEvidence: false,
    policy: 'fail_closed',
    reason,
    ...extras,
  };
}

export function decideRecovery({
  state,
  failure,
  repairAttempts = 0,
  policy = DEFAULT_RECOVERY_POLICY,
  risk = null,
} = {}) {
  const maxAttempts = Number.isInteger(policy?.maxRepairAttempts) ? policy.maxRepairAttempts : DEFAULT_RECOVERY_POLICY.maxRepairAttempts;
  if (!isFactoryState(state) || isTerminalState(state)) {
    return failClosed('terminal_or_invalid_state');
  }
  if (!failure || !FAILURE_CATEGORIES.includes(failure.category)) {
    return failClosed('unclassified_failure');
  }
  if (risk && risk !== 'low') {
    const nextState = canTransition(state, 'READY_FOR_HUMAN_APPROVAL') ? 'READY_FOR_HUMAN_APPROVAL' : (state === 'READY_FOR_HUMAN_APPROVAL' ? 'READY_FOR_HUMAN_APPROVAL' : null);
    if (!nextState && state !== 'READY_FOR_HUMAN_APPROVAL') return failClosed('unsafe_human_gate_transition');
    return {
      schema_version: SCHEMA_VERSION,
      action: 'REQUEST_HUMAN_APPROVAL',
      retryable: false,
      nextState: state === 'READY_FOR_HUMAN_APPROVAL' ? null : nextState,
      consumeRepairAttempt: false,
      invalidateEvidence: false,
      policy: 'non_low_risk_human_gate',
      reason: 'protected_or_high_risk_requires_human',
    };
  }

  const mapped = CATEGORY_POLICY[failure.category];
  if (!mapped) return failClosed('unmapped_category');

  const attempts = Number.isInteger(repairAttempts) ? repairAttempts : 0;
  const retryable = failure.retryable === true && Boolean(mapped.consumeRepairAttempt);
  if (mapped.consumeRepairAttempt && (failure.retryable !== true || attempts >= maxAttempts)) {
    const exhaustedState = mapped.exhausted;
    if (!canTransition(state, exhaustedState) && state !== exhaustedState) return failClosed('unsafe_exhausted_transition');
    return {
      schema_version: SCHEMA_VERSION,
      action: 'BLOCK_FOR_HUMAN',
      retryable: false,
      nextState: state === exhaustedState ? null : exhaustedState,
      consumeRepairAttempt: false,
      invalidateEvidence: Boolean(mapped.invalidateEvidence),
      policy: `${failure.category}:repair_exhausted`,
      reason: 'repair_attempts_exhausted',
    };
  }

  let nextState = mapped.nextState;
  if (nextState === state) nextState = null;
  if (nextState && !canTransition(state, nextState)) {
    return failClosed('unsafe_recovery_transition', { policy: `${failure.category}:${mapped.action}` });
  }

  return {
    schema_version: SCHEMA_VERSION,
    action: mapped.action,
    retryable: retryable || failure.retryable === true && !mapped.consumeRepairAttempt,
    nextState,
    consumeRepairAttempt: Boolean(mapped.consumeRepairAttempt) && failure.retryable === true,
    invalidateEvidence: Boolean(mapped.invalidateEvidence),
    policy: `${failure.category}:${mapped.action}`,
    reason: 'category_policy',
  };
}
