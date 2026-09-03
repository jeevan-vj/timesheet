import { isFactoryRunId } from './run-id.mjs';
import { isFactoryState } from './state-machine.mjs';

export const SCHEMA_VERSION = '1';
export const STATUS_MARKER_PREFIX = '<!-- factory-status:';
export const RUN_ID_MARKER_PREFIX = '<!-- factory-run-id:';
export const CONTROL_PLANE_START = '<!-- factory-control-plane:v1 -->';
export const CONTROL_PLANE_END = '<!-- /factory-control-plane:v1 -->';
export const COMMENT_SIZE_LIMIT = 65_000;

const PROGRESS_STEPS = Object.freeze([
  { id: 'planning', label: 'Planning', states: ['PLANNING'] },
  { id: 'implementation', label: 'Implementation', states: ['IMPLEMENTING', 'REPAIR_REQUIRED'] },
  { id: 'verification', label: 'Verification', states: ['VERIFYING'] },
  { id: 'review', label: 'Review', states: ['REVIEWING'] },
  { id: 'approval', label: 'Human approval', states: ['READY_FOR_HUMAN_APPROVAL'] },
]);

const STEP_ORDER = Object.freeze(['CREATED', 'PLANNING', 'IMPLEMENTING', 'VERIFYING', 'REVIEWING', 'READY_FOR_HUMAN_APPROVAL', 'COMPLETED']);

export function statusMarker(runId) {
  return `${STATUS_MARKER_PREFIX}${runId} -->`;
}

export function runIdMarker(runId) {
  return `${RUN_ID_MARKER_PREFIX}${runId} -->`;
}

export function encodeControlPlane(snapshot) {
  const json = JSON.stringify(snapshot);
  const encoded = Buffer.from(json, 'utf8').toString('base64');
  return `${CONTROL_PLANE_START}\n<!-- ${encoded} -->\n${CONTROL_PLANE_END}`;
}

export function decodeControlPlane(body) {
  const text = String(body ?? '');
  const start = text.indexOf(CONTROL_PLANE_START);
  const end = text.indexOf(CONTROL_PLANE_END);
  if (start < 0 || end < 0 || end <= start) return null;
  const region = text.slice(start + CONTROL_PLANE_START.length, end);
  const match = region.match(/<!--\s*([A-Za-z0-9+/]+=*)\s*-->/);
  if (!match) throw new Error('malformed factory control-plane payload');
  try {
    return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
  } catch {
    throw new Error('malformed factory control-plane payload');
  }
}

function stepIcon(state, stepStates, stepIndex) {
  if (state === 'COMPLETED') return '✅';
  const currentIndex = STEP_ORDER.indexOf(state);
  const firstStepState = stepStates[0];
  const stepPos = STEP_ORDER.indexOf(firstStepState);
  if (state === 'REPAIR_REQUIRED' && stepStates.includes('IMPLEMENTING')) return '🔄';
  if (stepStates.includes(state)) return '🔄';
  if (currentIndex >= 0 && stepPos >= 0 && currentIndex > stepPos) return '✅';
  if (['FAILED', 'BLOCKED', 'CANCELLED'].includes(state) && currentIndex < 0) {
    return stepIndex === 0 ? '⏳' : '⏳';
  }
  return '⏳';
}

function currentActivity(run) {
  if (run.latest_recovery?.action && ['REPAIR', 'REBASE_REPAIR', 'RERUN_VERIFICATION', 'WAIT_AND_RETRY'].includes(run.latest_recovery.action)) {
    return `Recovery action \`${run.latest_recovery.action}\` via \`${run.latest_recovery.policy}\`.`;
  }
  switch (run.state) {
    case 'CREATED':
      return 'Factory run created; planning has not started.';
    case 'PLANNING':
      return 'Planning the implementation contract.';
    case 'IMPLEMENTING':
      return 'Harness/agent implementation is in progress.';
    case 'VERIFYING':
      return run.github?.commit_sha
        ? `Running evidence-driven verification against \`${run.github.commit_sha}\`.`
        : 'Running evidence-driven verification.';
    case 'REVIEWING':
      return 'Independent review is in progress.';
    case 'READY_FOR_HUMAN_APPROVAL':
      return 'Canonical state is ready for human approval. Automated merge is blocked.';
    case 'REPAIR_REQUIRED':
      return 'Deterministic recovery selected a repair path.';
    case 'BLOCKED':
      return 'Factory is blocked and waiting for human intervention.';
    case 'FAILED':
      return 'Factory run failed closed.';
    case 'CANCELLED':
      return 'Factory run was cancelled.';
    case 'COMPLETED':
      return 'Factory run completed.';
    default:
      return 'Status unavailable.';
  }
}

function failureSection(run) {
  const failure = run.latest_failure;
  const recovery = run.latest_recovery;
  if (!failure) return 'No active failure.';
  const action = recovery?.action ? ` Selected recovery: \`${recovery.action}\` (\`${recovery.policy}\`).` : '';
  return `\`${failure.category}\` (\`${failure.code}\`).${action}`;
}

export function renderStatusMarkdown(run) {
  if (!isFactoryRunId(run.factory_run_id) || !isFactoryState(run.state)) throw new Error('invalid factory status snapshot');
  const harness = run.actor_harness || run.events?.find((event) => event.event_type === 'agent.selected')?.actor?.harness || 'other';
  const lines = [
    '## 🏭 Factory Run Status',
    '',
    `**Run:** \`${run.factory_run_id}\``,
    `**State:** \`${run.state}\``,
    `**Harness:** \`${harness}\``,
    `**Started:** \`${run.created_at}\``,
    `**Last updated:** \`${run.updated_at}\``,
    '',
    '### Progress',
    ...PROGRESS_STEPS.map((step, index) => `- ${stepIcon(run.state, step.states, index)} ${step.label}`),
    '',
    '### Current activity',
    currentActivity(run),
    '',
    '### Failure / recovery',
    failureSection(run),
    '',
    '### Correlation',
    `\`${run.correlation_id}\``,
    '',
    statusMarker(run.factory_run_id),
    runIdMarker(run.factory_run_id),
    encodeControlPlane(run),
  ];
  const body = `${lines.join('\n')}\n`;
  if (body.length > COMMENT_SIZE_LIMIT) throw new Error('factory status comment exceeds GitHub size limit');
  return body;
}

export function findStatusComment(comments, runId) {
  const marker = statusMarker(runId);
  const matches = (Array.isArray(comments) ? comments : []).filter((comment) => String(comment?.body ?? '').includes(marker));
  return matches.at(-1) ?? null;
}

export function extractRunIdMarker(body) {
  const match = String(body ?? '').match(/<!-- factory-run-id:(frun-[0-9a-fA-F-]+) -->/);
  return match?.[1] ?? null;
}
