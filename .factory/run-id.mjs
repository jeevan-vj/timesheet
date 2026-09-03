import { randomUUID } from 'node:crypto';

export const FACTORY_RUN_ID_RE = /^frun-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FACTORY_EVENT_ID_RE = /^fevt-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FACTORY_CORRELATION_ID_RE = /^fcor-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createIdFactory(randomUUIDImpl = randomUUID) {
  return {
    runId: () => `frun-${randomUUIDImpl()}`,
    eventId: () => `fevt-${randomUUIDImpl()}`,
    correlationId: () => `fcor-${randomUUIDImpl()}`,
  };
}

export const defaultIds = createIdFactory();

export function generateFactoryRunId(ids = defaultIds) {
  const value = ids.runId();
  if (!isFactoryRunId(value)) throw new Error('generated factory run id failed validation');
  return value;
}

export function isFactoryRunId(value) {
  if (typeof value !== 'string') return false;
  if (/^bc-[A-Za-z0-9-]+$/.test(value)) return false;
  if (/^\d+$/.test(value)) return false;
  return FACTORY_RUN_ID_RE.test(value);
}

export function isFactoryEventId(value) {
  return typeof value === 'string' && FACTORY_EVENT_ID_RE.test(value);
}

export function isFactoryCorrelationId(value) {
  return typeof value === 'string' && FACTORY_CORRELATION_ID_RE.test(value);
}

export function assertFactoryRunId(value) {
  if (!isFactoryRunId(value)) throw new Error('invalid factory_run_id');
  return value;
}
