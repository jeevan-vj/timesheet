import { isFactoryCorrelationId, isFactoryRunId } from './run-id.mjs';
import { nowIso } from './events.mjs';

export const SCHEMA_VERSION = '1';

export const FAILURE_CATEGORIES = Object.freeze([
  'PLANNING_FAILURE',
  'IMPLEMENTATION_FAILURE',
  'BUILD_FAILURE',
  'TEST_FAILURE',
  'VERIFICATION_FAILURE',
  'EVIDENCE_MISSING',
  'EVIDENCE_STALE',
  'REVIEW_FAILURE',
  'MERGE_CONFLICT',
  'INFRASTRUCTURE_FAILURE',
  'HARNESS_FAILURE',
  'AUTH_OR_PERMISSION_FAILURE',
  'RATE_LIMIT_OR_QUOTA',
  'TIMEOUT',
  'POLICY_OR_GUARDRAIL_FAILURE',
  'UNKNOWN_FAILURE',
]);

const FAILURE_KEYS = Object.freeze([
  'schema_version',
  'category',
  'code',
  'message',
  'retryable',
  'source',
  'factory_run_id',
  'correlation_id',
  'timestamp',
  'references',
]);

const SECRET_RE = /(api[_-]?key|token|password|secret|authorization|bearer\s+[a-z0-9._-]+)/i;

export function sanitizeFailureMessage(message) {
  const text = String(message ?? 'factory failure');
  if (SECRET_RE.test(text)) return 'redacted factory failure';
  return text.slice(0, 500);
}

export function validateFailure(failure) {
  if (!failure || typeof failure !== 'object' || Array.isArray(failure)) throw new Error('invalid failure');
  for (const key of Object.keys(failure)) {
    if (!FAILURE_KEYS.includes(key)) throw new Error(`unexpected failure field ${key}`);
  }
  for (const key of FAILURE_KEYS) {
    if (!(key in failure)) throw new Error(`missing failure field ${key}`);
  }
  if (failure.schema_version !== SCHEMA_VERSION) throw new Error('unsupported failure schema_version');
  if (!FAILURE_CATEGORIES.includes(failure.category)) throw new Error('invalid failure category');
  if (typeof failure.code !== 'string' || failure.code.length < 1) throw new Error('invalid failure code');
  if (typeof failure.message !== 'string' || failure.message.length < 1) throw new Error('invalid failure message');
  if (SECRET_RE.test(failure.message)) throw new Error('failure message must not contain secrets');
  if (typeof failure.retryable !== 'boolean') throw new Error('invalid retryable');
  if (typeof failure.source !== 'string' || failure.source.length < 1) throw new Error('invalid failure source');
  if (!isFactoryRunId(failure.factory_run_id)) throw new Error('invalid factory_run_id');
  if (!isFactoryCorrelationId(failure.correlation_id)) throw new Error('invalid correlation_id');
  if (typeof failure.timestamp !== 'string' || failure.timestamp.length < 1) throw new Error('invalid timestamp');
  if (!Array.isArray(failure.references) || failure.references.some((item) => typeof item !== 'string')) {
    throw new Error('invalid failure references');
  }
  return failure;
}

export function createFailureRecord(input) {
  const category = FAILURE_CATEGORIES.includes(input.category) ? input.category : 'UNKNOWN_FAILURE';
  const retryable = category === 'UNKNOWN_FAILURE' ? false : Boolean(input.retryable);
  const record = {
    schema_version: SCHEMA_VERSION,
    category,
    code: String(input.code || 'unknown_failure'),
    message: sanitizeFailureMessage(input.message),
    retryable,
    source: String(input.source || 'unknown'),
    factory_run_id: input.factory_run_id,
    correlation_id: input.correlation_id,
    timestamp: input.timestamp || nowIso(),
    references: Array.isArray(input.references) ? input.references.map((item) => String(item)) : [],
  };
  return validateFailure(record);
}

export function classifyFactorySignal(input = {}) {
  if (input.missingRun) {
    return createFailureRecord({
      ...input,
      category: 'POLICY_OR_GUARDRAIL_FAILURE',
      code: 'missing_factory_run',
      message: 'Canonical factory run is missing; refusing to advance.',
      retryable: false,
      source: input.source || 'control_plane',
    });
  }
  const kind = String(input.kind || '');
  if (kind === 'ci' || kind === 'gate') {
    return createFailureRecord({
      ...input,
      category: 'TEST_FAILURE',
      code: 'deterministic_gate_failed',
      message: input.message || 'Factory deterministic gate failed.',
      retryable: true,
      source: input.source || 'workflow',
    });
  }
  if (kind === 'e2e') {
    return createFailureRecord({
      ...input,
      category: 'VERIFICATION_FAILURE',
      code: 'e2e_gate_failed',
      message: input.message || 'Factory E2E evidence gate failed.',
      retryable: true,
      source: input.source || 'workflow',
    });
  }
  if (kind === 'e2e_consumer') {
    return createFailureRecord({
      ...input,
      category: 'EVIDENCE_MISSING',
      code: 'e2e_consumer_rejected',
      message: input.message || 'Trusted E2E evidence consumer rejected artifacts.',
      retryable: false,
      source: input.source || 'controller',
    });
  }
  if (kind === 'e2e_stale') {
    return createFailureRecord({
      ...input,
      category: 'EVIDENCE_STALE',
      code: 'e2e_stale_head',
      message: input.message || 'E2E evidence does not match the live head.',
      retryable: true,
      source: input.source || 'workflow',
    });
  }
  if (kind === 'review') {
    return createFailureRecord({
      ...input,
      category: 'REVIEW_FAILURE',
      code: 'trusted_review_blocking',
      message: input.message || 'Trusted review reported blocking findings.',
      retryable: true,
      source: input.source || 'review',
    });
  }
  if (kind === 'dispatch_auth') {
    return createFailureRecord({
      ...input,
      category: 'AUTH_OR_PERMISSION_FAILURE',
      code: 'cursor_api_key_missing',
      message: input.message || 'Harness credentials are unavailable.',
      retryable: false,
      source: input.source || 'intake',
    });
  }
  if (kind === 'policy') {
    return createFailureRecord({
      ...input,
      category: 'POLICY_OR_GUARDRAIL_FAILURE',
      code: input.code || 'policy_or_guardrail',
      message: input.message || 'Factory policy requires human approval.',
      retryable: false,
      source: input.source || 'controller',
    });
  }
  if (kind === 'dispatch_verify') {
    return createFailureRecord({
      ...input,
      category: 'HARNESS_FAILURE',
      code: 'cursor_agent_unverified',
      message: input.message || 'Harness dispatch could not be verified.',
      retryable: false,
      source: input.source || 'intake',
    });
  }
  if (kind === 'merge_conflict') {
    return createFailureRecord({
      ...input,
      category: 'MERGE_CONFLICT',
      code: 'merge_conflict',
      message: input.message || 'Merge conflict blocked the factory.',
      retryable: true,
      source: input.source || 'git',
    });
  }
  return createFailureRecord({
    ...input,
    category: 'UNKNOWN_FAILURE',
    code: input.code || 'unclassified_failure',
    message: input.message || 'Unclassified factory failure.',
    retryable: false,
    source: input.source || 'unknown',
  });
}
