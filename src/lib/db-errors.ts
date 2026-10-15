const UNIQUE_CONSTRAINT_FAILED = /UNIQUE constraint failed/i;
const MAX_ERROR_CAUSE_DEPTH = 5;

function messageOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null && "message" in value && typeof value.message === "string") {
    return value.message;
  }
  return undefined;
}

function causeOf(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("cause" in value)) return undefined;
  return value.cause;
}

export function isUniqueConstraintError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    const message = messageOf(current);
    if (message !== undefined && UNIQUE_CONSTRAINT_FAILED.test(message)) return true;
    const cause = causeOf(current);
    if (cause === undefined) return false;
    current = cause;
  }
  return false;
}
