export const SCHEMA_VERSION = '1';

export const FACTORY_STATES = Object.freeze([
  'CREATED',
  'PLANNING',
  'IMPLEMENTING',
  'VERIFYING',
  'REVIEWING',
  'READY_FOR_HUMAN_APPROVAL',
  'COMPLETED',
  'FAILED',
  'REPAIR_REQUIRED',
  'BLOCKED',
  'CANCELLED',
]);

export const TERMINAL_STATES = Object.freeze(['COMPLETED', 'CANCELLED', 'FAILED']);
export const IN_PROGRESS_STATES = Object.freeze(['PLANNING', 'IMPLEMENTING', 'VERIFYING', 'REVIEWING', 'REPAIR_REQUIRED']);

export const ALLOWED_TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(['PLANNING', 'CANCELLED', 'FAILED', 'BLOCKED']),
  PLANNING: Object.freeze(['IMPLEMENTING', 'FAILED', 'REPAIR_REQUIRED', 'BLOCKED', 'CANCELLED']),
  IMPLEMENTING: Object.freeze(['VERIFYING', 'READY_FOR_HUMAN_APPROVAL', 'REPAIR_REQUIRED', 'FAILED', 'BLOCKED', 'CANCELLED']),
  VERIFYING: Object.freeze(['REVIEWING', 'READY_FOR_HUMAN_APPROVAL', 'REPAIR_REQUIRED', 'FAILED', 'BLOCKED', 'CANCELLED']),
  REVIEWING: Object.freeze(['READY_FOR_HUMAN_APPROVAL', 'VERIFYING', 'REPAIR_REQUIRED', 'FAILED', 'BLOCKED', 'CANCELLED']),
  READY_FOR_HUMAN_APPROVAL: Object.freeze(['COMPLETED', 'VERIFYING', 'REPAIR_REQUIRED', 'BLOCKED', 'CANCELLED', 'FAILED']),
  REPAIR_REQUIRED: Object.freeze(['IMPLEMENTING', 'VERIFYING', 'PLANNING', 'READY_FOR_HUMAN_APPROVAL', 'FAILED', 'BLOCKED', 'CANCELLED']),
  BLOCKED: Object.freeze(['REPAIR_REQUIRED', 'CANCELLED', 'FAILED', 'PLANNING', 'IMPLEMENTING']),
  FAILED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  COMPLETED: Object.freeze([]),
});

export function isFactoryState(value) {
  return FACTORY_STATES.includes(value);
}

export function isTerminalState(value) {
  return TERMINAL_STATES.includes(value);
}

export function isInProgressState(value) {
  return IN_PROGRESS_STATES.includes(value);
}

export function canTransition(from, to) {
  if (!isFactoryState(from) || !isFactoryState(to)) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`invalid factory transition ${from} -> ${to}`);
  }
  return to;
}

export function projectLabels(state) {
  if (!isFactoryState(state)) throw new Error('invalid factory state');
  switch (state) {
    case 'CREATED':
    case 'PLANNING':
      return { add: ['factory:delegated'], remove: ['factory:ready'] };
    case 'IMPLEMENTING':
    case 'VERIFYING':
    case 'REVIEWING':
    case 'REPAIR_REQUIRED':
      return { add: ['factory:delegated', 'factory:implementing'], remove: ['factory:ready'] };
    case 'READY_FOR_HUMAN_APPROVAL':
    case 'BLOCKED':
    case 'FAILED':
    case 'CANCELLED':
      return { add: ['factory:delegated', 'factory:needs-human'], remove: ['factory:ready', 'factory:implementing'] };
    case 'COMPLETED':
      return { add: ['factory:delegated', 'factory:complete'], remove: ['factory:ready', 'factory:implementing', 'factory:needs-human'] };
    default:
      throw new Error('invalid factory state');
  }
}
