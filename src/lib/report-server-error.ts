import { env } from "cloudflare:workers";

const LEAK_LINE = /Failed query:|params:|D1_ERROR|SQLITE_/;

type ScrubbedFailure = {
  name: string;
  message: string;
  stack: string;
};

function dropLeakLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !LEAK_LINE.test(line))
    .join("\n");
}

function freshStack(message: string): string {
  return dropLeakLines(new Error(message).stack ?? message);
}

function isQueryFailure(error: unknown): boolean {
  if (typeof error === "string") return LEAK_LINE.test(error);
  if (typeof error !== "object" || error === null) return false;
  if ("params" in error || "query" in error) return true;
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return LEAK_LINE.test(message);
}

function scrubFailure(error: unknown): ScrubbedFailure {
  if (isQueryFailure(error)) {
    const name = error instanceof Error && error.name ? error.name : "QueryError";
    return { name, message: "query_failed", stack: freshStack("query_failed") };
  }
  if (!(error instanceof Error)) {
    return { name: "NonError", message: "unexpected_throw", stack: freshStack("unexpected_throw") };
  }
  const name = error.name || "Error";
  return {
    name,
    message: dropLeakLines(error.message),
    stack: dropLeakLines(error.stack ?? freshStack(name)),
  };
}

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "unknown";
  }
}

function readSentryDsn(): string | undefined {
  const raw = (env as { SENTRY_DSN?: string }).SENTRY_DSN;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sentryTarget(dsn: string): { url: string; key: string } | null {
  try {
    const parsed = new URL(dsn);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const key = decodeURIComponent(parsed.username);
    if (!key || /[\r\n\s:]/.test(key)) return null;
    const projectId = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (!projectId || !/^\d+$/.test(projectId)) return null;
    return { url: `${parsed.protocol}//${parsed.host}/api/${projectId}/envelope/`, key };
  } catch {
    return null;
  }
}

async function captureException(scrubbed: ScrubbedFailure, correlationId: string): Promise<void> {
  const dsn = readSentryDsn();
  if (!dsn) return;
  const target = sentryTarget(dsn);
  if (!target) return;
  const eventId = correlationId.replaceAll("-", "");
  const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() });
  const item = JSON.stringify({ type: "event" });
  const event = JSON.stringify({
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: "error",
    release: env.RELEASE_SHA,
    exception: {
      values: [
        {
          type: scrubbed.name,
          value: scrubbed.message,
          stacktrace: {
            frames: scrubbed.stack
              .split("\n")
              .filter((line) => line.length > 0)
              .map((line) => ({ function: line })),
          },
        },
      ],
    },
    tags: { correlationId },
  });
  await fetch(target.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=cleantrack/0.1, sentry_key=${target.key}`,
    },
    body: `${header}\n${item}\n${event}\n`,
  });
}

function writeServerLog(payload: Record<string, string | number>): void {
  console.error(JSON.stringify(payload));
}

export async function reportServerError(error: unknown, request: Request, correlationId: string): Promise<void> {
  const scrubbed = scrubFailure(error);
  writeServerLog({
    route: requestPath(request),
    method: request.method,
    correlationId,
    name: scrubbed.name,
    message: scrubbed.message,
    stack: scrubbed.stack,
    release: env.RELEASE_SHA,
  });
  try {
    await captureException(scrubbed, correlationId);
  } catch {
    // Capture must not change the API response.
  }
}

export const OPERATIONAL_EVENT_KEYS = ["event", "kind", "httpStatus"] as const;
export type OperationalEventName = "email_not_configured" | "email_send_failed";
export type OperationalKind = "invitation";

export function operationalEventPayload(
  name: OperationalEventName,
  fields: { kind: OperationalKind; httpStatus?: number },
): Record<string, string | number> {
  const payload: Record<string, string | number> = { event: name, kind: fields.kind };
  if (typeof fields.httpStatus === "number") payload.httpStatus = fields.httpStatus;
  return payload;
}

export function reportOperationalEvent(
  name: OperationalEventName,
  fields: { kind: OperationalKind; httpStatus?: number },
): void {
  writeServerLog(operationalEventPayload(name, fields));
}
